// Three.js renderer. It READS the world (via IWorld) and draws it.
// It must NEVER mutate the world or decide gameplay outcomes.
import * as THREE from 'three';
import type { IWorld, EntityKind, EntityView, MasteryId } from '../world_api';
import { PlayerAvatar } from './player_avatar';
import { PlayerAvatars } from './player_avatars';
import { EnemyAvatars } from './enemy_avatars';
import { NpcAvatar } from './npc_avatar';
import { populateForest } from './forest';
import { populateVillage } from './village';
import { setupEnvironment, terrainHeight, type Environment, type WeatherState } from './environment';

const FLASH_DURATION = 0.12; // seconds — a quick "I got hit" white flash

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
  private raycaster = new THREE.Raycaster();
  // One reusable selection marker, moved onto the targeted enemy each frame.
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

  // OTHER (remote) players' animated Knights — one loaded model, cloned per player.
  // Capsule is the fallback until the model loads. Read-only consumer of IWorld.
  private playerAvatars = new PlayerAvatars();

  // Enemies/boss as animated 3D skeletons (one mixer each). Loads async; capsule
  // is the fallback until ready. Read-only consumer of IWorld, like everything here.
  private enemyAvatars = new EnemyAvatars();
  private lastEnemyHitSeq = 0; // cursor: spot NEW damage events on the player (to lunge the attacker)

  // The vendor NPC as an animated 3D character (idle). Loads async; capsule fallback.
  private vendorAvatar = new NpcAvatar('/models/Mage.glb');

  // sky / sun+shadows / undulating ground / grass / fog (all tunable in environment.ts)
  private env: Environment;

  // third-person orbit camera state
  private camYaw = 0;
  private camPitch = 0.5;
  private camDist = 14;
  // saved player framing (pitch + distance) while a clip applies its own; the YAW
  // is deliberately left untouched so the movement reference never changes.
  private clipCamSaved: { pitch: number; dist: number } | null = null;

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
        if (typeof id === 'number') return id;
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
  render(world: IWorld, serverWeather: WeatherState | null = null): void {
    const nowMs = performance.now(); // host clock — fine here, never in src/sim
    const dt = this.lastRenderMs ? Math.min(0.1, (nowMs - this.lastRenderMs) / 1000) : 0;
    this.lastRenderMs = nowMs;

    this.syncLocalAvatarModel(world);
    this.sync(world);
    this.applyFlashes(dt);
    this.updatePlayerAvatar(world, dt);
    this.updatePlayerAvatars(world, dt);
    this.updateEnemyAvatars(world, dt);
    // Keep the sky centred on the player and the sun's shadow frustum on them.
    const pid = world.localPlayerId();
    const pp = pid != null ? world.entities().find((e) => e.id === pid) : undefined;
    const px = pp ? pp.x : 0;
    const pz = pp ? pp.z : 0;
    this.env.update(dt, px, pz, terrainHeight(px, pz), serverWeather);
    if (this.vendorAvatar.ready) this.vendorAvatar.update(dt); // keep the vendor's idle playing
    this.updateCamera(world);
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

    // Did we deal damage to our target this frame? (auto-attack OR an attack ability).
    const targetId = world.localTargetId();
    let dealt = false;
    let maxSeq = this.lastSeenSeq;
    for (const ev of world.recentEvents()) {
      if (ev.seq > maxSeq) maxSeq = ev.seq;
      if (ev.seq <= this.lastSeenSeq) continue;
      if (ev.kind === 'damage' && targetId != null && ev.targetId === targetId) dealt = true;
    }
    this.lastSeenSeq = maxSeq;

    // A cast that also dealt damage = an attack ability (Golpe Forte, Atordoamento) ->
    // always swing, heavier for Golpe Forte (slot 1). A cast with NO damage is a buff
    // (Postura) -> no swing for now. Otherwise a plain auto-attack swings (gated so a
    // bleed tick can't spam it mid-swing).
    if (castSlot !== 0 && dealt) {
      av.triggerAttack(castSlot === 1);
    } else if (dealt && !av.isSwinging()) {
      av.triggerAttack(false);
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
    if (e.kind === 'npc') return this.vendorAvatar.ready ? this.vendorAvatar.root : null; // the vendor
    return null;
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
        m = makeActor(e.kind, e.boss);
        // Champion/Elite wolves are drawn larger so the tier reads at a glance.
        if (e.kind === 'enemy' && !e.boss) m.scale.setScalar(TIER_SCALE[e.tier] ?? 1);
        m.userData.entityId = e.id; // so pick() can map a hit back to the entity
        this.scene.add(m);
        this.meshes.set(e.id, m);
      }
      m.position.set(e.x, terrainHeight(e.x, e.z), e.z); // sit on the (visual) terrain
      m.rotation.y = e.facing;
      updateGlow(m, e.weaponPlus);
      updateHostileTint(m, e);
      updateDeadFade(m, e);
      updateStatusMarker(m, e);
      if (e.id === targetId) targetView = e;
    }
    for (const [id, m] of this.meshes) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.meshes.delete(id);
        this.enemyAvatars.release(id); // dispose a skeleton avatar if this id was one
        this.playerAvatars.release(id); // dispose a remote Knight if this id was one
      }
    }
    // Park the selection ring under the current target (if any).
    if (targetView) {
      this.selectionRing.position.set(targetView.x, terrainHeight(targetView.x, targetView.z) + 0.06, targetView.z);
      this.selectionRing.scale.setScalar(targetView.boss ? 1.9 : (TIER_SCALE[targetView.tier] ?? 1)); // match boss/tier size
      this.selectionRing.visible = true;
    } else {
      this.selectionRing.visible = false;
    }
  }

  private updateCamera(world: IWorld): void {
    const id = world.localPlayerId();
    let px = 0;
    let pz = 0;
    if (id != null) {
      const p = world.entities().find((e) => e.id === id);
      if (p) {
        px = p.x;
        pz = p.z;
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
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

// A simple capsule-ish humanoid with a "nose" so facing is visible. A boss is
// drawn bigger and in a distinct menacing color so it reads as a boss.
function makeActor(kind: EntityKind, boss = false): THREE.Object3D {
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
