// Three.js renderer. It READS the world (via IWorld) and draws it.
// It must NEVER mutate the world or decide gameplay outcomes.
import * as THREE from 'three';
import type { IWorld, EntityKind, EntityView, MasteryId, Rarity, GroundLootView } from '../world_api';
import { PlayerAvatar } from './player_avatar';
import { PlayerAvatars } from './player_avatars';
import { EnemyAvatars } from './enemy_avatars';
import { NpcAvatar } from './npc_avatar';
import { populateForest } from './forest';
import { populateVillage } from './village';
import { setupEnvironment, terrainHeight, type Environment, type WeatherState } from './environment';
import { AbilityVfx, abilityEffect, abilityClip, abilitySelfEffect } from './vfx/ability_vfx';

const FLASH_DURATION = 0.12; // seconds — a quick "I got hit" white flash

// O1 interpolation: a one-tick positional jump larger than this (units^2) is treated as a
// teleport (e.g. the boss charge Investida) and snapped, not slid across the gap over ~50ms.
const INTERP_SNAP_DIST2 = 16; // (4 units)^2

// Shortest-path angular lerp (handles the -pi/pi wrap), mirroring the MP path in client_world.
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= Math.PI * 2;
  while (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

// O4 frustum cull: an actor whose generous bounding sphere is fully outside the camera frustum is
// hidden — skipping its draw AND its shadow-map contribution. Sized large so a partly-off-screen
// actor (a swing/weapon reaching in) is never wrongly hidden: oversize costs only a few edge draws,
// undersize would pop a visible actor.
const CULL_RADIUS = 6; // units — comfortably covers the tallest boss + reach + tier/boss scale
const CULL_CENTER_Y = 1.5; // sphere centre above the mesh base (bodies sit on the ground, ~2-4 tall)

// "Clipe do Commit" framing. IMPORTANT: a clip changes ONLY pitch + distance,
// NEVER the camera yaw. `yaw` is the reference input.ts uses to map WASD to world
// space, and it's what decides how world-space motion reads on screen — so rotating
// it to a cinematic angle made the (world-correct) bot look like it was walking the
// wrong way and jittering. Keeping the player's own yaw makes the clip purely visual.
const CLIP_CAM_PITCH = 0.55; // a touch higher than the default for nicer framing
const CLIP_CAM_DIST = 15; // pulled back slightly so more of the scene is in frame

export class Renderer {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private gl: THREE.WebGLRenderer;
  private meshes = new Map<number, THREE.Object3D>();
  private localId: number | null = null; // the local player's id (refreshed each render) — pick() skips its avatar
  private raycaster = new THREE.Raycaster();
  // One reusable selection marker, moved onto the CURRENT target each frame — a mob, a boss, or a
  // duel opponent (localTargetId can be a player in PvP, so the same ring marks a player target too).
  private selectionRing: THREE.Mesh;
  // Hit flashes: entity id -> seconds of white flash remaining. Driven by the
  // host clock (presentation only), decayed each frame.
  private flashes = new Map<number, number>();
  private lastRenderMs = 0;
  private projV = new THREE.Vector3(); // scratch for project()

  // The local player's animated 3D avatar, skinned to its class (Knight/Barbarian/Ranger/
  // Mage). Rebuilt when the class changes (the entry class-select); null + capsule until the
  // local player's mastery is known. All state below is presentation-derived from IWorld each
  // frame — the sim is never touched.
  private playerAvatar: PlayerAvatar | null = null;
  private playerAvatarMastery: MasteryId | null = null;
  // Avatars replaced by a class change, kept until the new one is ready so the old skin stays
  // visible during the swap; disposed (GPU resources freed) once the replacement is live.
  private outgoingAvatars: PlayerAvatar[] = [];
  private lastCd = new Map<number, number>(); // per ability slot: last cooldown — a jump up means it was just cast
  private lastSeenSeq = 0; // cursor over sim events, to spot NEW hits we dealt (own, separate from main.ts)
  private playerPrevX = 0;
  private playerPrevZ = 0;
  private playerLastMoveMs = 0; // host time of the player's last position change (for idle vs walk)

  // O1 — single-player position interpolation. The sim moves at 20Hz but we render at the
  // monitor's refresh, so without this the body snaps every ~8 frames at 165Hz (a 20Hz
  // stair-step). We keep each entity's previous + current sim position/facing and lerp between
  // them by `alpha` (the host's acc/DT, passed into render()). MP is a no-op: ClientWorld
  // already interpolates and uses the default alpha=1. Render-only — never touches the sim.
  private interp = new Map<number, { px: number; pz: number; pf: number; cx: number; cz: number; cf: number }>();
  private lastInterpTick = -1;
  private alpha = 1; // interpolation fraction toward the current tick, refreshed each render()
  private _ip = { x: 0, z: 0, facing: 0 }; // scratch returned by interpPos() — use immediately, never store

  // O4 — off-screen actor culling. Reused each frame; the sphere's centre is moved onto each mesh.
  private cullFrustum = new THREE.Frustum();
  private cullProj = new THREE.Matrix4();
  private cullSphere = new THREE.Sphere(new THREE.Vector3(), CULL_RADIUS);

  // OTHER (remote) players' animated Knights — one loaded model, cloned per player.
  // Capsule is the fallback until the model loads. Read-only consumer of IWorld.
  private playerAvatars = new PlayerAvatars();

  // Enemies/boss as animated 3D skeletons (one mixer each). Loads async; capsule
  // is the fallback until ready. Read-only consumer of IWorld, like everything here.
  private enemyAvatars = new EnemyAvatars();
  private lastEnemyHitSeq = 0; // cursor: spot NEW damage events on the player (to lunge the attacker)

  // Town NPCs (vendor + warehouse keeper) as animated 3D characters (idle). One NpcAvatar
  // per npc id, created lazily — so each NPC has its OWN model/root and renders at its OWN
  // position (a single shared avatar can't be in two places). Loads async; capsule fallback.
  private npcAvatars = new Map<number, NpcAvatar>();
  // GDD v0.5 (PK livre): a red ground ring under each PK-armed player (public — every client sees the
  // dangerous player). Keyed by entity id; created lazily, hidden/removed when they un-flag or leave.
  private pkRings = new Map<number, THREE.Mesh>();

  // sky / sun+shadows / undulating ground / grass / fog (all tunable in environment.ts)
  private env: Environment;

  // Ability particle VFX (GDD G2) — projectiles/impacts spawned when the renderer detects a
  // cast (derived from IWorld). Render-only; never touches the sim.
  private abilityVfx: AbilityVfx;

  // third-person orbit camera state
  private camYaw = 0;
  private camPitch = 0.5;
  private camDist = 14;
  // saved player framing (pitch + distance) while a clip applies its own; the YAW
  // is deliberately left untouched so the movement reference never changes.
  private clipCamSaved: { pitch: number; dist: number } | null = null;
  // Camera-shake impact feedback (purely cosmetic): a decaying positional jitter applied
  // to the camera after framing. `shake()` arms it; render() decays it; updateCamera() applies it.
  private shakeRemaining = 0;
  private shakeDuration = 0;
  private shakeMag = 0;

  constructor(canvas: HTMLCanvasElement) {
    // preserveDrawingBuffer lets the clip recorder copy this canvas into its 9:16
    // vertical crop: drawImage() of a WebGL canvas needs the buffer kept around.
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);

    // Atmosphere: gradient sky + clouds, sun with soft shadows, undulating
    // colour-varied ground, dense grass, distance fog. The sky/sun follow the
    // player each frame (see render()). All knobs live in environment.ts.
    this.env = setupEnvironment(this.scene, this.gl);
    this.abilityVfx = new AbilityVfx(this.scene);

    this.selectionRing = makeSelectionRing();
    this.scene.add(this.selectionRing);

    // Decorative scenery (async, fire-and-forget — the game runs while it loads;
    // failure just leaves it bare). Both are presentation-only with no collision.
    populateForest(this.scene).catch((err) => console.error('[forest] failed to load', err));
    populateVillage(this.scene).catch((err) => console.error('[village] failed to load', err));
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Raycast screen coordinates against entity meshes; returns the id of the
  // entity under the cursor, or null. Read-only — used for click-to-target.
  pick(clientX: number, clientY: number): number | null {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.meshes.values()], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        const id = o.userData.entityId;
        if (typeof id === 'number') {
          // In third person OUR OWN avatar sits between the camera and everything in front of us, so
          // the CLOSEST hit under the cursor is frequently ourselves — and set-target(self) is rejected
          // (canAttack excludes self), which is exactly why clicking a face-to-face duel opponent kept
          // failing. Skip our own avatar so the ray passes THROUGH it to whoever is behind.
          if (id !== this.localId) return id;
          break; // our avatar occluded this hit — fall through to the next (farther) one
        }
        o = o.parent;
      }
    }
    return null;
  }

  orbit(dYaw: number, dPitch: number): void {
    this.camYaw -= dYaw;
    this.camPitch = clamp(this.camPitch + dPitch, 0.15, 1.3);
  }

  zoom(d: number): void {
    this.camDist = clamp(this.camDist + d, 6, 32);
  }

  // ---- "Clipe do Commit" hooks (presentation only; never touch the sim) ----
  // Freeze/restore the day/night cycle so every clip in the series shares one light.
  setClipTime(t: number | null): void {
    this.env.setTimeOverride(t);
  }

  // Apply / restore the clip framing. Only PITCH + DISTANCE change — never yaw —
  // because input.ts derives movement direction from yaw and the on-screen reading
  // of motion follows it; changing it mid-clip would make the bot/player look like
  // they're walking the wrong way. So the clip camera stays purely visual.
  setClipCamera(on: boolean): void {
    if (on) {
      if (this.clipCamSaved) return;
      this.clipCamSaved = { pitch: this.camPitch, dist: this.camDist };
      this.camPitch = CLIP_CAM_PITCH;
      this.camDist = CLIP_CAM_DIST;
    } else if (this.clipCamSaved) {
      this.camPitch = this.clipCamSaved.pitch;
      this.camDist = this.clipCamSaved.dist;
      this.clipCamSaved = null;
    }
  }

  // The camera orbit angle AND the reference input.ts uses to map WASD to world
  // space. A clip never overrides yaw (see setClipCamera), so movement direction is
  // always independent of clip framing — the bot/player keep their normal heading.
  get yaw(): number {
    return this.camYaw;
  }

  // Start a quick white flash on an entity's model (e.g. when it takes a hit).
  flash(id: number): void {
    this.flashes.set(id, FLASH_DURATION);
  }

  // Arm a brief camera shake (impact feedback) — `magnitude` in world units (~0.05–0.2).
  // Cosmetic only: it perturbs the camera position, easing out to zero. A stronger shake
  // overrides a weaker ongoing one, but a weaker one never cuts a stronger one short.
  shake(magnitude: number, duration = 0.18): void {
    if (this.shakeRemaining > 0 && magnitude <= this.shakeMag) return;
    this.shakeMag = magnitude;
    this.shakeRemaining = duration;
    this.shakeDuration = duration;
  }

  // Project a world point to screen pixels (for DOM overlays like damage text).
  // `visible` is false when the point is behind the camera / outside the frustum.
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    this.projV.set(x, y, z).project(this.camera);
    return {
      x: (this.projV.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.projV.y * 0.5 + 0.5) * window.innerHeight,
      visible: this.projV.z > -1 && this.projV.z < 1,
    };
  }

  // `serverWeather` (multiplayer) drives the day/night + rain from the server so all
  // clients share the same sky; omit it offline to run the local cycle + R/T keys.
  render(world: IWorld, serverWeather: WeatherState | null = null, alpha = 1): void {
    const nowMs = performance.now(); // host clock — fine here, never in src/sim
    const dt = this.lastRenderMs ? Math.min(0.1, (nowMs - this.lastRenderMs) / 1000) : 0;
    this.lastRenderMs = nowMs;

    this.alpha = clamp(alpha, 0, 1);
    if (this.shakeRemaining > 0) this.shakeRemaining = Math.max(0, this.shakeRemaining - dt); // decay the camera shake
    this.advanceInterp(world); // O1: roll prev/cur position buffers when the sim has ticked
    this.localId = world.localPlayerId(); // remembered for pick(): never let our own avatar occlude a click

    this.syncLocalAvatarModel(world);
    this.sync(world);
    this.applyFlashes(dt);
    this.updatePlayerAvatar(world, dt);
    this.updatePlayerAvatars(world, dt);
    this.updateEnemyAvatars(world, dt);
    // Keep the sky centred on the player and the sun's shadow frustum on them.
    const pid = world.localPlayerId();
    const pp = pid != null ? world.entities().find((e) => e.id === pid) : undefined;
    const pAnchor = pp ? this.interpPos(pp.id, pp) : null; // smoothed player anchor (O1)
    const px = pAnchor ? pAnchor.x : 0;
    const pz = pAnchor ? pAnchor.z : 0;
    // Ability VFX last: buff auras follow the local player, so feed its live position.
    const casterPos = pp ? new THREE.Vector3(px, terrainHeight(px, pz) + 1.0, pz) : undefined;
    this.abilityVfx.update(dt, casterPos);
    this.env.update(dt, px, pz, terrainHeight(px, pz), serverWeather);
    for (const av of this.npcAvatars.values()) if (av.ready) av.update(dt); // keep each NPC's idle playing
    this.updateCamera(world);
    this.cullOffscreen(); // O4: hide actors fully off-screen (skips their colour + shadow pass)
    this.gl.render(this.scene, this.camera);
  }

  // Drive each enemy skeleton: idle vs walk by movement, and a short lunge when it
  // hits the player. Read-only — derives everything from IWorld.
  private updateEnemyAvatars(world: IWorld, dt: number): void {
    if (!this.enemyAvatars.ready) return;
    const nowMs = this.lastRenderMs;
    const ents = world.entities();

    // Attack read: a NEW damage event on the player -> lunge the nearest hostile
    // enemy in melee (the sim doesn't say which one hit, so pick the likeliest).
    const playerId = world.localPlayerId();
    let playerHit = false;
    let maxSeq = this.lastEnemyHitSeq;
    for (const ev of world.recentEvents()) {
      if (ev.seq > maxSeq) maxSeq = ev.seq;
      if (ev.seq <= this.lastEnemyHitSeq) continue;
      if (ev.kind === 'damage' && playerId != null && ev.targetId === playerId) playerHit = true;
    }
    this.lastEnemyHitSeq = maxSeq;
    if (playerHit && playerId != null) {
      const p = ents.find((e) => e.id === playerId);
      if (p) {
        let best = -1;
        let bestD = 16; // (~4 units)^2 — only melee-range attackers lunge
        for (const e of ents) {
          if (e.kind !== 'enemy' || !e.hostile || !this.enemyAvatars.has(e.id)) continue;
          const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2;
          if (d < bestD) { bestD = d; best = e.id; }
        }
        if (best !== -1) this.enemyAvatars.triggerAttack(best);
      }
    }

    for (const e of ents) {
      if (e.kind === 'enemy' && this.enemyAvatars.has(e.id)) {
        this.enemyAvatars.update(e.id, dt, e.x, e.z, nowMs);
      }
    }
  }

  // Pick the local player's body skin from its class (weapon mastery), (re)building the
  // PlayerAvatar when the class changes — e.g. the entry class-select swaps Sword -> Mago.
  // The swap rides the existing sync() path: the old avatar stays visible until the new one
  // finishes loading. Presentation only — reads IWorld, never mutates it.
  private syncLocalAvatarModel(world: IWorld): void {
    const id = world.localPlayerId();
    if (id == null) return;
    const p = world.entities().find((e) => e.id === id);
    if (!p) return;
    if (this.playerAvatarMastery !== p.mastery) {
      this.playerAvatarMastery = p.mastery;
      // Retire the current avatar (don't dispose yet — it stays on screen until the new one
      // finishes loading; sync() swaps the root). The new one starts loading immediately.
      if (this.playerAvatar) this.outgoingAvatars.push(this.playerAvatar);
      this.playerAvatar = new PlayerAvatar(p.mastery);
    }
    // Once the replacement is ready, sync() (later THIS frame) removes the old root from the
    // scene, so the retired avatars can be disposed — freeing their GPU resources.
    if (this.outgoingAvatars.length && this.playerAvatar?.ready) {
      for (const a of this.outgoingAvatars) a.dispose();
      this.outgoingAvatars = [];
    }
  }

  // Drive the player's animated avatar from world state (presentation only):
  // idle vs walk by movement, and a one-shot attack swing on auto-attack / Golpe
  // Forte. Everything here READS IWorld; it never mutates the sim.
  private updatePlayerAvatar(world: IWorld, dt: number): void {
    const av = this.playerAvatar;
    if (!av?.ready) return;
    const id = world.localPlayerId();
    if (id == null) return;
    const p = world.entities().find((e) => e.id === id);
    if (!p) return;

    // The player's position on the PREVIOUS frame — the dash origin for a charge (Investida
    // teleports in one tick, so prev->now is the whole dash path). Captured before the movement
    // check below overwrites playerPrevX/Z with the current position.
    const prevX = this.playerPrevX;
    const prevZ = this.playerPrevZ;

    // The sim only moves the player on a 20Hz tick, so position is static between
    // ticks; smooth over ~180ms so walking doesn't flicker back to idle.
    if (Math.hypot(p.x - this.playerPrevX, p.z - this.playerPrevZ) > 1e-3) {
      this.playerLastMoveMs = this.lastRenderMs;
      this.playerPrevX = p.x;
      this.playerPrevZ = p.z;
    }
    const moving = !p.dead && this.lastRenderMs - this.playerLastMoveMs < 180;

    // Abilities: a slot's cooldown jumping UP means it was just cast this frame.
    let castSlot = 0;
    for (const a of world.abilities()) {
      const prev = this.lastCd.get(a.slot) ?? 0;
      if (a.cooldownRemaining > prev + 0.05) castSlot = a.slot;
      this.lastCd.set(a.slot, a.cooldownRemaining);
    }

    // Did we land a hit on an ENEMY this frame? (auto-attack OR an attack ability.) This must NOT
    // key on the selected target: a killing blow makes the sim drop the target the SAME tick
    // (validateTarget clears it once the enemy is gone), so localTargetId() is already null when we
    // read it — which is why keying on it lost every one-shot cast. Instead, take any enemy-damage
    // event (targetId !== the local player) and use its x/z snapshot, which the SimEvent captures
    // BEFORE the enemy is removed, so it survives a one-shot. (Single-player: enemy-damage events
    // come only from the local player's own hits.)
    let hitEnemy = false;
    let hitX = 0;
    let hitZ = 0;
    let maxSeq = this.lastSeenSeq;
    for (const ev of world.recentEvents()) {
      if (ev.seq > maxSeq) maxSeq = ev.seq;
      if (ev.seq <= this.lastSeenSeq) continue;
      if (ev.kind === 'damage' && ev.targetId !== id) {
        hitEnemy = true;
        hitX = ev.x;
        hitZ = ev.z;
      }
    }
    this.lastSeenSeq = maxSeq;

    // Attack / ability animation. On a successful cast (castSlot != 0) play the ability's specific
    // clip when it has one (Onda de Chamas, Varredura, ...), else the class's default attack clip
    // ("heavy" for a slot-1 cast). A plain auto-attack swings on a landed hit (gated so a bleed
    // tick can't restart the clip mid-swing).
    if (castSlot !== 0) {
      const clip = abilityClip(p.mastery, castSlot);
      if (clip) av.playClip(clip);
      else av.triggerAttack(castSlot === 1);
    } else if (hitEnemy && !av.isSwinging()) {
      av.triggerAttack(false);
      // Auto-attack VFX (subtle): a mini-projectile for ranged, a small spark for melee. Same hit
      // anchor as the abilities (the damage event's x/z). Tied to the swing trigger + gated by
      // !isSwinging, so it can't spam (and a DoT tick at most rides one swing's worth).
      const from = new THREE.Vector3(p.x, terrainHeight(p.x, p.z) + 1.3, p.z);
      const to = new THREE.Vector3(hitX, terrainHeight(hitX, hitZ) + 1.0, hitZ);
      this.abilityVfx.autoAttack(p.mastery, from, to);
    }

    // Ability VFX (GDD G2). A self-cast BUFF fires on the cast alone, anchored on the caster (its
    // aura follows the player — see abilityVfx.update). A damaging ability fires on a landed hit,
    // anchored on the damage event's x/z snapshot (valid even when the blow kills the target).
    // Render-only — the sim already resolved the outcome; this just shows it.
    if (castSlot !== 0) {
      const self = abilitySelfEffect(p.mastery, castSlot);
      const dmg = abilityEffect(p.mastery, castSlot);
      if (self) {
        this.abilityVfx.castSelf(self.effect, self.duration);
      } else if (dmg && hitEnemy) {
        // Origin: normally the caster; for a charge (Investida) the dash origin (prev frame) so the
        // trail spans the whole dash path (the player has already teleported next to the target).
        const ox = dmg === 'charge' ? prevX : p.x;
        const oz = dmg === 'charge' ? prevZ : p.z;
        const from = new THREE.Vector3(ox, terrainHeight(ox, oz) + 1.3, oz);
        const to = new THREE.Vector3(hitX, terrainHeight(hitX, hitZ) + 1.0, hitZ);
        this.abilityVfx.cast(dmg, from, to);
      }
    }

    av.update(dt, moving);
  }

  // Drive each REMOTE player's Knight: idle vs walk from its interpolated position
  // (the same idle/walk smoothing the enemies use). The LOCAL player is handled by
  // updatePlayerAvatar; everything here READS IWorld and never mutates the sim.
  private updatePlayerAvatars(world: IWorld, dt: number): void {
    if (!this.playerAvatars.ready) return;
    const nowMs = this.lastRenderMs;
    const localId = world.localPlayerId();
    for (const e of world.entities()) {
      if (e.kind === 'player' && e.id !== localId && this.playerAvatars.has(e.id)) {
        this.playerAvatars.update(e.id, dt, e.x, e.z, nowMs);
      }
    }
  }

  private applyFlashes(dt: number): void {
    for (const [id, remaining] of this.flashes) {
      const m = this.meshes.get(id);
      const left = remaining - dt;
      if (!m || left <= 0) {
        if (m) setFlash(m, 0);
        this.flashes.delete(id);
        continue;
      }
      this.flashes.set(id, left);
      setFlash(m, left / FLASH_DURATION); // fade the white glow out
    }
  }

  // The 3D model that should represent an entity, once loaded: the Knight for the
  // player, a skeleton for enemies/boss. Null => not ready yet (use the capsule).
  private desiredRoot(e: EntityView, localId: number | null): THREE.Object3D | null {
    if (e.kind === 'player') {
      // The single PlayerAvatar is the LOCAL player's (it carries the attack swing).
      if (e.id === localId) return this.playerAvatar?.ready ? this.playerAvatar.root : null;
      // Every OTHER player gets its own cloned model for its class (one template per mastery).
      return this.playerAvatars.rootFor(e.id, e.x, e.z, e.mastery);
    }
    if (e.kind === 'enemy') return this.enemyAvatars.rootFor(e);
    if (e.kind === 'npc') {
      // One avatar per NPC id (vendor + warehouse), created on first sight.
      let av = this.npcAvatars.get(e.id);
      // Teleporter hubs (TP3) float a name tag so they read as travel points; vendor/warehouse pass none.
      if (!av) { av = new NpcAvatar('/models/Mage.glb', e.species === 'teleporter' ? e.name : undefined); this.npcAvatars.set(e.id, av); }
      return av.ready ? av.root : null;
    }
    return null;
  }

  // O1 — advance the per-entity prev/cur position buffers when the sim has ticked. Called once
  // at the top of render(); sync()/updateCamera then lerp prev->cur by `this.alpha`. The sim's
  // `tick` (read via IWorld) is the advance detector — never written here. Render-only.
  private advanceInterp(world: IWorld): void {
    if (world.tick === this.lastInterpTick) return;
    this.lastInterpTick = world.tick;
    const live = new Set<number>();
    for (const e of world.entities()) {
      live.add(e.id);
      const r = this.interp.get(e.id);
      if (!r) {
        // First sight: prev == cur so it snaps to its spawn position (no streak from the origin).
        this.interp.set(e.id, { px: e.x, pz: e.z, pf: e.facing, cx: e.x, cz: e.z, cf: e.facing });
        continue;
      }
      r.px = r.cx; r.pz = r.cz; r.pf = r.cf; // roll current -> previous
      r.cx = e.x; r.cz = e.z; r.cf = e.facing; // record the new sim state as current
      // A one-tick jump too large to be real movement (the boss charge teleport) snaps instead
      // of sliding the model across the gap.
      if ((r.cx - r.px) ** 2 + (r.cz - r.pz) ** 2 > INTERP_SNAP_DIST2) {
        r.px = r.cx; r.pz = r.cz; r.pf = r.cf;
      }
    }
    for (const id of this.interp.keys()) if (!live.has(id)) this.interp.delete(id); // prune gone ids
  }

  // Interpolated x/z/facing for an entity at the current alpha. Returns a SHARED scratch object
  // (use immediately, never store). Falls back to the raw view when there is no record or
  // alpha>=1 (the MP path, where ClientWorld already interpolates).
  private interpPos(id: number, e: EntityView): { x: number; z: number; facing: number } {
    const ip = this._ip;
    const r = this.interp.get(id);
    const a = this.alpha;
    if (!r || a >= 1) {
      ip.x = e.x; ip.z = e.z; ip.facing = e.facing;
      return ip;
    }
    ip.x = r.px + (r.cx - r.px) * a;
    ip.z = r.pz + (r.cz - r.pz) * a;
    ip.facing = lerpAngle(r.pf, r.cf, a);
    return ip;
  }

  private sync(world: IWorld): void {
    const seen = new Set<number>();
    const targetId = world.localTargetId();
    const localId = world.localPlayerId();
    let targetView: EntityView | undefined;
    for (const e of world.entities()) {
      seen.add(e.id);
      let m = this.meshes.get(e.id);
      // Player -> Knight avatar, common enemy/boss -> skeleton avatar, once each
      // model has loaded; until then (and for NPCs) the capsule is the fallback.
      // Swap on the first frame the model is ready.
      const root = this.desiredRoot(e, localId);
      if (root) {
        if (m !== root) {
          if (m) this.scene.remove(m);
          m = root;
          m.userData.entityId = e.id;
          this.scene.add(m);
          this.meshes.set(e.id, m);
        }
      } else if (!m) {
        m = makeActor(e.kind, e.boss, e.loot ?? null); // loot carries its contents -> rarity label/tint/glow (built once)
        // Champion/Elite wolves are drawn larger so the tier reads at a glance.
        if (e.kind === 'enemy' && !e.boss) m.scale.setScalar(TIER_SCALE[e.tier] ?? 1);
        m.userData.entityId = e.id; // so pick() can map a hit back to the entity
        this.scene.add(m);
        this.meshes.set(e.id, m);
      }
      const ip = this.interpPos(e.id, e); // O1: smooth the 20Hz sim position at render rate
      m.position.set(ip.x, terrainHeight(ip.x, ip.z), ip.z); // sit on the (visual) terrain
      m.rotation.y = ip.facing;
      updateGlow(m, e.weaponPlus);
      updateHostileTint(m, e);
      updateDeadFade(m, e);
      updateStatusMarker(m, e);
      this.updatePkRing(e); // GDD v0.5 (PK livre): red ring under a PK-armed player, visible to everyone
      if (e.id === targetId) targetView = e;
    }
    for (const [id, m] of this.meshes) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.meshes.delete(id);
        this.enemyAvatars.release(id); // dispose a skeleton avatar if this id was one
        this.playerAvatars.release(id); // dispose a remote Knight if this id was one
        const ring = this.pkRings.get(id); // and its PK ring, if it had one
        if (ring) { this.scene.remove(ring); this.pkRings.delete(id); }
      }
    }
    // Park the selection ring under the CURRENT target (ANY kind). localTargetId can be a player in
    // an active duel (PvP), so the same ring marks the opponent — it was never restricted to mobs.
    if (targetView) {
      const tp = this.interpPos(targetView.id, targetView); // ring follows the smoothed target (O1)
      this.selectionRing.position.set(tp.x, terrainHeight(tp.x, tp.z) + 0.06, tp.z);
      // Size: boss/tier for enemies; a player (duel opponent) gets the standard ring.
      const onPlayer = targetView.kind === 'player';
      // GDD v0.5 (PK livre): the ring turns RED when the target is a PK-armed player (you're locked on a
      // dangerous target), otherwise the classic gold.
      (this.selectionRing.material as THREE.MeshBasicMaterial).color.setHex(
        onPlayer && targetView.pkActive ? 0xff3b3b : 0xffe14d,
      );
      this.selectionRing.scale.setScalar(targetView.boss ? 1.9 : onPlayer ? 1 : (TIER_SCALE[targetView.tier] ?? 1));
      // A player's ground ring is easily hidden in a face-to-face melee duel — your own avatar and the
      // opponent's body sandwich the small disc — so draw the PLAYER ring ON TOP (no depth test) for
      // reliable selection feedback. Enemy/boss rings keep the normal depth-tested look.
      (this.selectionRing.material as THREE.MeshBasicMaterial).depthTest = !onPlayer;
      this.selectionRing.renderOrder = onPlayer ? 10 : 0;
      this.selectionRing.visible = true;
    } else {
      this.selectionRing.visible = false;
    }
  }

  // GDD v0.5 (PK livre): show/position a red ground ring under a PK-armed player (the public danger cue),
  // hide it when they un-flag. Driven purely by EntityView.pkActive (works offline AND online), so it
  // needs no input/sim coupling — just IWorld state. The local player sees its OWN ring while ALT is held.
  private updatePkRing(e: EntityView): void {
    const want = e.kind === 'player' && e.pkActive === true;
    let ring = this.pkRings.get(e.id);
    if (want && !ring) { ring = makePkRing(); this.scene.add(ring); this.pkRings.set(e.id, ring); }
    if (!ring) return;
    ring.visible = want;
    if (want) {
      const ip = this.interpPos(e.id, e); // sit under the smoothed position (O1)
      ring.position.set(ip.x, terrainHeight(ip.x, ip.z) + 0.05, ip.z);
    }
  }

  private updateCamera(world: IWorld): void {
    const id = world.localPlayerId();
    let px = 0;
    let pz = 0;
    if (id != null) {
      const p = world.entities().find((e) => e.id === id);
      if (p) {
        const ip = this.interpPos(p.id, p); // follow the smoothed player, not the 20Hz steps (O1)
        px = ip.x;
        pz = ip.z;
      }
    }
    const py = terrainHeight(px, pz); // follow the player up/down the hills
    const cy = Math.cos(this.camPitch);
    const sy = Math.sin(this.camPitch);
    this.camera.position.set(
      px + Math.sin(this.camYaw) * this.camDist * cy,
      py + 1.5 + this.camDist * sy,
      pz + Math.cos(this.camYaw) * this.camDist * cy,
    );
    this.camera.lookAt(px, py + 1.2, pz);
    // Impact shake: nudge the camera AFTER framing so the whole view jitters. Ease-out (t²)
    // so it settles smoothly. Math.random is fine here — pure decoration, never the sim's Rng.
    if (this.shakeRemaining > 0 && this.shakeDuration > 0) {
      const t = this.shakeRemaining / this.shakeDuration; // 1 -> 0
      const amp = this.shakeMag * t * t;
      this.camera.position.x += (Math.random() * 2 - 1) * amp;
      this.camera.position.y += (Math.random() * 2 - 1) * amp;
      this.camera.position.z += (Math.random() * 2 - 1) * amp;
    }
  }

  // Hide entity meshes whose sphere is fully outside the view frustum, so off-screen actors cost
  // nothing in the colour OR shadow pass. Runs after updateCamera() (so the frustum is THIS frame's)
  // and before gl.render, using each mesh's already-interpolated position. The inner skinned meshes
  // keep frustumCulled=false, so a VISIBLE actor is never self-culled mid-animation; we cull the
  // whole group here instead, with a generous radius so a partly-on-screen actor stays drawn.
  private cullOffscreen(): void {
    this.camera.updateMatrixWorld();
    this.camera.matrixWorldInverse.copy(this.camera.matrixWorld).invert();
    this.cullProj.multiplyMatrices(this.camera.projectionMatrix, this.camera.matrixWorldInverse);
    this.cullFrustum.setFromProjectionMatrix(this.cullProj);
    for (const m of this.meshes.values()) {
      this.cullSphere.center.set(m.position.x, m.position.y + CULL_CENTER_Y, m.position.z);
      m.visible = this.cullFrustum.intersectsSphere(this.cullSphere);
    }
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

// Rarity accent colors. The vivid hex (RARITY_COLOR) matches the inventory's CSS border colors
// (style.css [data-rarity]) and drives the 3D chest tint + glow; the lighter CSS strings (RARITY_TEXT)
// match the inventory's TEXT color and read better on the label's dark plate. Presentation only.
const RARITY_COLOR: Record<Rarity, number> = {
  normal: 0x8a93a3, // grey
  sos: 0x4aa3ff, // blue
  som: 0xb06cff, // purple
  sun: 0xf2c44a, // gold
};
const RARITY_TEXT: Record<Rarity, string> = {
  normal: '#cdd5e0', sos: '#bfe0ff', som: '#e6ccff', sun: '#ffe9a8',
};
// A faint per-rarity floor for the loot glow, so a rare drop pops even at +0 (then "+N" ramps it up).
const RARITY_GLOW_BASE: Record<Rarity, number> = { normal: 0.06, sos: 0.1, som: 0.14, sun: 0.2 };

// A pickup-able ground item (GDD v0.5 loot físico): a small gold chest resting on the ground. Distinct
// from the humanoid actors so loot reads at a glance; sync() tags it with the entity id so pick() (and
// thus a click -> pickup) resolves to it. When the drop's CONTENTS are known (`loot`), the chest is
// tinted + glows by rarity/+N and floats a rarity-colored name label — so you SEE what dropped and run
// for it (GDD: "você vê o loot cair, corre pra pegar"). `loot` null -> the plain gold chest fallback.
function makeLootMarker(loot: GroundLootView | null): THREE.Object3D {
  const g = new THREE.Group();
  const accent = loot ? RARITY_COLOR[loot.rarity] : 0x3a2600;
  const box = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.34, 0.5),
    new THREE.MeshStandardMaterial({
      color: 0xffcc44, // gold chest
      emissive: accent, // tinted by rarity so the drop's grade reads at a glance
      emissiveIntensity: loot ? 0.45 : 1, // subtle rarity tint vs. the original warm-dark default
      roughness: 0.5,
      metalness: 0.3,
    }),
  );
  box.position.y = 0.17; // resting on the ground
  box.castShadow = true;
  g.add(box);
  if (loot) {
    // a soft additive halo, rarity-colored, brighter with the item's "+N" (the GDD's +N glow, on the ground)
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(0.45, 16, 12),
      new THREE.MeshBasicMaterial({
        color: accent,
        transparent: true,
        opacity: Math.min(0.7, RARITY_GLOW_BASE[loot.rarity] + 0.045 * Math.min(loot.plus, 10)),
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.position.y = 0.22;
    g.add(glow);
    g.add(makeLootLabel(loot)); // the floating rarity-colored name (built once; contents never change)
  }
  return g;
}

// A floating loot label (canvas -> camera-facing sprite): the item name in its rarity color, with the
// "+N" and "xQty" when relevant, on a dark plate (depthTest off so it isn't hidden by the chest). Built
// ONCE per drop — a loot entity's stack is immutable (pickup deletes it), so there is no per-frame cost.
function makeLootLabel(loot: GroundLootView): THREE.Sprite {
  const plusTag = loot.plus > 0 ? ` +${loot.plus}` : '';
  const qtyTag = loot.qty > 1 ? ` x${loot.qty}` : '';
  const text = `${loot.name}${plusTag}${qtyTag}`;
  const font = 40, padX = 18, padY = 10;
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d')!;
  ctx.font = `bold ${font}px sans-serif`;
  canvas.width = Math.ceil(ctx.measureText(text).width) + padX * 2;
  canvas.height = font + padY * 2;
  ctx.font = `bold ${font}px sans-serif`; // resizing the canvas resets the context — set the font again
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = 'rgba(8,18,28,0.66)'; // dark plate for contrast against the world
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.fillStyle = RARITY_TEXT[loot.rarity]; // the item's rarity color (matches the inventory text)
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  const h = 0.4; // world units tall; width keeps the canvas aspect
  sprite.scale.set(h * (canvas.width / canvas.height), h, 1);
  sprite.position.y = 0.95; // float just above the chest
  sprite.renderOrder = 20; // draw over the world
  return sprite;
}

// GDD v0.5 (Pets): a small friendly companion that follows its owner — a soft teal critter, distinct
// from mobs (red) and players (blue) so it never reads as a threat. Cosmetic placeholder; swap for a
// CC0 pet model later. The little cone reads as a head/ear so its facing is visible.
function makePetMarker(): THREE.Object3D {
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.SphereGeometry(0.34, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0x46d6b0, emissive: 0x0d3a30, roughness: 0.6, metalness: 0.1 }),
  );
  body.position.y = 0.34;
  const ear = new THREE.Mesh(
    new THREE.ConeGeometry(0.13, 0.24, 10),
    new THREE.MeshStandardMaterial({ color: 0x46d6b0 }),
  );
  ear.position.set(0, 0.62, 0.18); // +Z is forward (matches facing)
  ear.rotation.x = 0.5;
  g.add(body, ear);
  body.castShadow = ear.castShadow = true;
  return g;
}

// A simple capsule-ish humanoid with a "nose" so facing is visible. A boss is
// drawn bigger and in a distinct menacing color so it reads as a boss.
function makeActor(kind: EntityKind, boss = false, loot: GroundLootView | null = null): THREE.Object3D {
  if (kind === 'loot') return makeLootMarker(loot); // GDD v0.5 loot físico: a chest on the ground, not a humanoid
  if (kind === 'pet') return makePetMarker(); // GDD v0.5 (Pets): a small friendly companion, not a humanoid
  const bodyColor =
    boss ? 0xa030d0 : kind === 'player' ? 0x3b82f6 : kind === 'npc' ? 0xe0b030 : 0xb23b3b;
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 1.7, 12),
    new THREE.MeshStandardMaterial({ color: bodyColor }),
  );
  body.position.y = 0.85;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xf0d9b5 }),
  );
  head.position.y = 1.95;
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a }),
  );
  nose.position.set(0, 1.0, 0.55); // +Z is "forward" (matches facing math)
  g.add(body, head, nose);
  body.castShadow = head.castShadow = nose.castShadow = true; // capsule fallback drops a shadow too
  g.userData.body = body; // so the per-frame hostile tint can recolor it
  // Status-effect marker: a small bead above the head, shown + colored by the
  // active status (basic material, so the hit-flash never touches it).
  const statusMarker = new THREE.Mesh(
    new THREE.SphereGeometry(0.22, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xffffff }),
  );
  statusMarker.position.y = 2.55;
  statusMarker.visible = false;
  g.userData.statusMarker = statusMarker;
  g.add(statusMarker);
  if (kind === 'player') {
    // Enhancement glow aura — hidden until the equipped weapon hits +3. A
    // MeshBasicMaterial (no emissive) so the hit-flash never touches it.
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffd86b,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.position.y = 1.0;
    glow.visible = false;
    g.userData.glow = glow;
    g.add(glow);
  }
  if (boss) g.scale.setScalar(1.9); // visibly larger than a common mob
  return g;
}

// Show/scale the enhancement glow by the equipped weapon's "+N": nothing below
// +3, then ramping in brightness/size up to +10. Presentation only.
function updateGlow(actor: THREE.Object3D, weaponPlus: number): void {
  const glow = actor.userData.glow as THREE.Mesh | undefined;
  if (!glow) return;
  if (weaponPlus < 3) {
    glow.visible = false;
    return;
  }
  const t = Math.min(1, (weaponPlus - 3) / 7); // 0 at +3 -> 1 at +10
  glow.visible = true;
  (glow.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.4 * t;
  glow.scale.setScalar(1 + 0.25 * t);
}

const ENEMY_COLOR = 0xb23b3b; // calm red (idle wolf)
const HOSTILE_COLOR = 0xff2a2a; // hotter red while aggroed on the player

// Tint a common enemy's body by whether it's currently hostile (chasing us), so
// you can see which wolves are on you. Recolors `color` (not emissive), so it
// never fights the white hit-flash. Boss/player are left to their own color.
function updateHostileTint(actor: THREE.Object3D, e: EntityView): void {
  if (e.kind !== 'enemy' || e.boss) return;
  const body = actor.userData.body as THREE.Mesh | undefined;
  if (!body) return;
  // Aggroed enemies flash the hostile color; idle ones show their tier color so
  // Champions/Elites read as distinct even at rest.
  const base = TIER_COLOR[e.tier] ?? ENEMY_COLOR;
  (body.material as THREE.MeshStandardMaterial).color.setHex(e.hostile ? HOSTILE_COLOR : base);
}

// Per-tier visuals (presentation-only; mirrors content/enemies ENEMY_TIERS).
const TIER_SCALE: Record<string, number> = { normal: 1, champion: 1.35, elite: 1.7 };
const TIER_COLOR: Record<string, number> = {
  normal: 0xb23b3b, // the common wolf red (== ENEMY_COLOR)
  champion: 0xd98a2b, // burnished orange
  elite: 0xc94fd0, // arcane violet — the rarest, nastiest tier
};

// Status-effect indicator colors (matches the StatusKind union).
const STATUS_COLORS: Record<string, number> = {
  stun: 0xffe14d, // yellow
  knockdown: 0xff8c00, // orange
  root: 0x8b5a2b, // brown
  slow: 0x4aa3ff, // blue
  dot: 0xff3030, // red (bleed)
  defense: 0x59d0b0, // teal — a protective buff (Postura Defensiva), not a threat
  crit: 0xff7a18, // burning orange — a fury/crit buff (Fúria)
};

// Status display priority: the bead shows the most "important" active effect
// (a stun/knockdown should always win over a slow/dot/buff), not whichever happens
// to sit at index 0 — so the colour doesn't depend on application/expiry order.
// The defense buff ranks last: a debuff on the same actor is always more urgent.
const STATUS_PRIORITY: Record<string, number> = {
  stun: 0, knockdown: 0, root: 1, slow: 2, dot: 3, defense: 4, crit: 5,
};

// Show/hide + color the per-entity status bead by its highest-priority status.
function updateStatusMarker(actor: THREE.Object3D, e: EntityView): void {
  const marker = actor.userData.statusMarker as THREE.Mesh | undefined;
  if (!marker) return;
  if (e.statuses.length === 0) {
    marker.visible = false;
    return;
  }
  let top = e.statuses[0];
  for (const k of e.statuses) {
    if ((STATUS_PRIORITY[k] ?? 9) < (STATUS_PRIORITY[top] ?? 9)) top = k;
  }
  marker.visible = true;
  (marker.material as THREE.MeshBasicMaterial).color.setHex(STATUS_COLORS[top] ?? 0xffffff);
}

// Fade a downed player to a translucent "spirit". Only touches the body/head/
// nose (MeshStandardMaterial); the glow aura (MeshBasicMaterial) is left alone.
function updateDeadFade(actor: THREE.Object3D, e: EntityView): void {
  if (e.kind !== 'player') return;
  actor.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (mat && mat.isMeshStandardMaterial) {
      mat.transparent = e.dead; // reset to opaque on revive (don't strand it in the transparent path)
      mat.opacity = e.dead ? 0.3 : 1;
    }
  });
}

// GDD v0.5 (PK livre): a red ground ring marking a PK-armed (dangerous) player, shown to EVERYONE under
// any player whose pkActive is set. Distinct from the gold selection ring (bigger, always red, additive-
// ish glow via transparency). Decorative only — never affects the sim.
function makePkRing(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.78, 1.12, 40),
    new THREE.MeshBasicMaterial({
      color: 0xff3b3b,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.72,
      depthWrite: false,
    }),
  );
  ring.rotation.x = -Math.PI / 2; // lay flat on the ground
  ring.renderOrder = 1;
  return ring;
}

// Flat ground ring used as the "selected target" marker (classic WoW/Silkroad
// look). Decorative only — never affects the sim.
function makeSelectionRing(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.95, 36),
    new THREE.MeshBasicMaterial({
      color: 0xffe14d,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    }),
  );
  ring.rotation.x = -Math.PI / 2; // lay flat on the ground
  ring.position.y = 0.06; // just above the ground plane
  ring.visible = false;
  return ring;
}

// Drive an actor's white hit-flash by tinting its materials' emissive. intensity
// 0 restores the normal (unlit-emissive) look. Each actor owns its materials
// (see makeActor), so this never bleeds onto other entities.
function setFlash(group: THREE.Object3D, intensity: number): void {
  group.traverse((o) => {
    const mat = (o as THREE.Mesh).material;
    if (mat && !Array.isArray(mat) && (mat as THREE.MeshStandardMaterial).emissive) {
      const m = mat as THREE.MeshStandardMaterial;
      m.emissive.setRGB(1, 1, 1);
      m.emissiveIntensity = intensity;
    }
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
