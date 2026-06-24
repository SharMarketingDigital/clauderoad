// Ability visual effects (GDD §G2) — particle VFX for the classes' abilities, built from the
// Kenney Particle Pack (CC0) textures curated into public/textures/particles/. Presentation
// ONLY: the renderer calls cast()/castSelf() when it detects an ability was used (derived from
// IWorld — the cooldown jump + an enemy-damage event), and the sim is never touched. All
// randomness here is cosmetic jitter (Math.random), never the sim's deterministic Rng.
//
// Behaviors are dispatched by effect id so each is isolated:
//   - projectile (Bola de Fogo, Lança de Gelo, tiros) — flies from caster to the impact point.
// Cone/aura/melee-impact behaviors are added by later G2 groups, reusing the same sprite pool.
import * as THREE from 'three';
import type { MasteryId } from '../../world_api';

// Curated Kenney textures (grayscale masks — tinted at runtime via the sprite material color).
const TEXTURES = {
  fire: '/textures/particles/fire_01.png',
  spark: '/textures/particles/spark_01.png',
  smoke: '/textures/particles/smoke_02.png',
  flame: '/textures/particles/flame_04.png',
  magic: '/textures/particles/magic_05.png',
  light: '/textures/particles/light_03.png', // soft glow — frost cores / flashes
  star: '/textures/particles/star_04.png', // sparkle — frost shards
  trace: '/textures/particles/trace_01.png', // streak — arrows
} as const;
type TexKey = keyof typeof TEXTURES;

// Damaging abilities: (mastery, slot) -> VFX effect id. Render-local data-as-code mirroring the
// sim's action-bar slots WITHOUT importing sim content (keeps the IWorld seam intact). Buffs live
// in a separate ABILITY_SELF_EFFECT table (added with the aura group).
const ABILITY_EFFECT: Partial<Record<MasteryId, Record<number, string>>> = {
  mage: { 1: 'fireball', 2: 'flamewave', 3: 'frostbolt' },
  bow: { 1: 'arrow', 2: 'multishot', 3: 'frostarrow' },
  spear: { 2: 'sweep' },
};

// Look up the damaging-effect id for a (mastery, slot), or undefined when nothing is wired.
export function abilityEffect(mastery: MasteryId, slot: number): string | undefined {
  return ABILITY_EFFECT[mastery]?.[slot];
}

// Abilities whose ANIMATION clip differs from the class auto-attack — the renderer plays this clip
// via PlayerAvatar.playClip on cast. Slots not listed fall back to the default attack clip.
const ABILITY_CLIP: Partial<Record<MasteryId, Record<number, string>>> = {
  mage: { 2: 'Ranged_Magic_Spellcasting' }, // Onda de Chamas — a sweeping cast
  spear: { 2: 'Melee_2H_Attack_Spin' }, // Varredura — an arcing spin
};

// Look up the ability's specific animation clip, or undefined to use the class's default attack.
export function abilityClip(mastery: MasteryId, slot: number): string | undefined {
  return ABILITY_CLIP[mastery]?.[slot];
}

const TRAIL_EVERY = 0.02; // seconds between trail emissions during flight
const MULTI_COUNT = 5; // arrows in a Tiro Múltiplo volley
const MULTI_SPREAD = 0.5; // total fan angle (radians) of the volley

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

type TrailKind = 'ember' | 'frost' | 'none';
type ImpactKind = 'fire' | 'frost' | 'spark';

// A projectile's look + behavior. coreColor tints the grayscale core texture.
interface ProjectileStyle {
  coreTex: TexKey; coreColor: number; coreScale: number;
  speed: number; // world units/sec
  trail: TrailKind;
  impact: ImpactKind;
  flash: number; // cast-flash color (0 = no flash, e.g. arrows)
}

const STYLES: Record<string, ProjectileStyle> = {
  fireball: { coreTex: 'fire', coreColor: 0xffd28a, coreScale: 0.9, speed: 22, trail: 'ember', impact: 'fire', flash: 0xff8a44 },
  frostbolt: { coreTex: 'light', coreColor: 0x8fdcff, coreScale: 0.85, speed: 24, trail: 'frost', impact: 'frost', flash: 0x6cc8ff },
  arrow: { coreTex: 'trace', coreColor: 0xffe6a0, coreScale: 0.7, speed: 40, trail: 'none', impact: 'spark', flash: 0 },
  frostarrow: { coreTex: 'trace', coreColor: 0x9fe6ff, coreScale: 0.7, speed: 40, trail: 'frost', impact: 'frost', flash: 0 },
};

// A cone/fan burst that expands forward (direction = to - from): a spread of particles flung into
// the frontal arc, each drifting out and fading. Reuses the particle pool (no continuous emitter).
interface ConeStyle {
  tex: TexKey; color: number; blending: THREE.Blending;
  count: number; arc: number; reach: number; life: number;
  s0: number; s1: number; o0: number; o1: number;
  embers: boolean; // a few forward sparks/embers for extra punch
}
const CONES: Record<string, ConeStyle> = {
  flamewave: { tex: 'flame', color: 0xffb347, blending: THREE.AdditiveBlending, count: 16, arc: 1.1, reach: 6, life: 0.45, s0: 0.5, s1: 1.7, o0: 1, o1: 0, embers: true },
  sweep: { tex: 'smoke', color: 0x9b8a6a, blending: THREE.NormalBlending, count: 14, arc: 1.5, reach: 3.6, life: 0.4, s0: 0.4, s1: 1.1, o0: 0.6, o1: 0, embers: false },
};

// A free-floating particle: a sprite that drifts, scales, and fades over its life.
interface Particle {
  sprite: THREE.Sprite;
  vx: number; vy: number; vz: number; // drift velocity (units/sec)
  life: number; maxLife: number; // seconds remaining / total
  s0: number; s1: number; // scale start -> end
  o0: number; o1: number; // opacity start -> end
}

// A flying projectile that emits a trail and bursts on arrival.
interface Projectile {
  core: THREE.Sprite;
  from: THREE.Vector3; to: THREE.Vector3;
  t: number; dur: number; emit: number;
  scale: number; // base sprite scale (a subtle flicker rides on top)
  trail: TrailKind; impact: ImpactKind;
}

export class AbilityVfx {
  private group = new THREE.Group();
  private textures = new Map<TexKey, THREE.Texture>();
  private ready = false;
  private particles: Particle[] = [];
  private projectiles: Projectile[] = [];

  constructor(scene: THREE.Scene) {
    scene.add(this.group);
    this.load().catch((err) => console.error('[AbilityVfx] failed to load textures', err));
  }

  private async load(): Promise<void> {
    const loader = new THREE.TextureLoader();
    const entries = Object.entries(TEXTURES) as [TexKey, string][];
    await Promise.all(entries.map(async ([key, url]) => {
      const tex = await loader.loadAsync(url);
      tex.colorSpace = THREE.SRGBColorSpace;
      this.textures.set(key, tex);
    }));
    this.ready = true;
  }

  // Spawn a damaging ability effect from `from` (caster) to `to` (impact point). No-op until the
  // textures load or for unknown ids. Dispatched by effect id so each behavior is isolated.
  cast(effect: string, from: THREE.Vector3, to: THREE.Vector3): void {
    if (!this.ready) return;
    switch (effect) {
      case 'fireball':
      case 'frostbolt':
      case 'arrow':
      case 'frostarrow':
        this.spawnProjectile(from, to, STYLES[effect]);
        break;
      case 'multishot':
        this.spawnVolley(from, to);
        break;
      case 'flamewave':
      case 'sweep':
        this.spawnCone(from, to, CONES[effect]);
        break;
    }
  }

  // Advance every live projectile (flight + trail + impact) and particle (drift + fade), and
  // cull the finished ones. Called once per render frame with the host delta.
  update(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t += dt;
      const u = Math.min(1, pr.t / pr.dur);
      pr.core.position.lerpVectors(pr.from, pr.to, u);
      pr.core.scale.setScalar(pr.scale + 0.06 * Math.sin(pr.t * 40)); // a subtle flicker
      pr.emit -= dt;
      if (pr.emit <= 0) {
        pr.emit = TRAIL_EVERY;
        this.spawnTrail(pr.core.position, pr.trail);
      }
      if (u >= 1) {
        this.spawnImpact(pr.to, pr.impact);
        this.kill(pr.core);
        this.projectiles.splice(i, 1);
      }
    }
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.kill(p.sprite);
        this.particles.splice(i, 1);
        continue;
      }
      const u = 1 - p.life / p.maxLife;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y += p.vy * dt;
      p.sprite.position.z += p.vz * dt;
      p.sprite.scale.setScalar(lerp(p.s0, p.s1, u));
      (p.sprite.material as THREE.SpriteMaterial).opacity = lerp(p.o0, p.o1, u);
    }
  }

  // ---- recipes ----

  private spawnProjectile(from: THREE.Vector3, to: THREE.Vector3, style: ProjectileStyle): void {
    if (style.flash) this.spawnCastFlash(from, style.flash);
    const dur = clamp(from.distanceTo(to) / style.speed, 0.12, 0.7);
    const core = this.makeSprite(style.coreTex, style.coreColor, THREE.AdditiveBlending);
    core.scale.setScalar(style.coreScale);
    core.position.copy(from);
    this.projectiles.push({ core, from: from.clone(), to: to.clone(), t: 0, dur, emit: 0, scale: style.coreScale, trail: style.trail, impact: style.impact });
  }

  // A fan of arrows (Tiro Múltiplo): MULTI_COUNT arrows spread around the from->to direction.
  private spawnVolley(from: THREE.Vector3, to: THREE.Vector3): void {
    const dx = to.x - from.x, dz = to.z - from.z;
    const base = Math.atan2(dz, dx);
    const dist = Math.hypot(dx, dz) || 1;
    const dy = to.y - from.y;
    for (let i = 0; i < MULTI_COUNT; i++) {
      const a = base + ((i / (MULTI_COUNT - 1)) - 0.5) * MULTI_SPREAD;
      const t = new THREE.Vector3(from.x + Math.cos(a) * dist, from.y + dy, from.z + Math.sin(a) * dist);
      this.spawnProjectile(from, t, STYLES.arrow);
    }
  }

  // A fan of particles flung into the frontal arc (direction = to - from). Reuses the particle pool.
  private spawnCone(from: THREE.Vector3, to: THREE.Vector3, style: ConeStyle): void {
    const base = Math.atan2(to.z - from.z, to.x - from.x);
    for (let i = 0; i < style.count; i++) {
      const a = base + (Math.random() - 0.5) * style.arc;
      const speed = rnd(style.reach * 0.6, style.reach);
      const start = rnd(0.4, 1.4); // begin a bit in front of the caster
      const spr = this.makeSprite(style.tex, style.color, style.blending);
      spr.position.set(from.x + Math.cos(a) * start, from.y + rnd(-0.2, 0.4), from.z + Math.sin(a) * start);
      spr.material.rotation = rnd(0, Math.PI * 2);
      this.particles.push({ sprite: spr, vx: Math.cos(a) * speed, vy: rnd(0, 0.5), vz: Math.sin(a) * speed, life: style.life, maxLife: style.life, s0: style.s0, s1: style.s1, o0: style.o0, o1: style.o1 });
    }
    if (style.embers) {
      for (let k = 0; k < 6; k++) {
        const a = base + (Math.random() - 0.5) * style.arc;
        const speed = rnd(style.reach * 0.7, style.reach * 1.1);
        const ember = this.makeSprite('spark', 0xffd28a, THREE.AdditiveBlending);
        ember.position.set(from.x + Math.cos(a) * 0.6, from.y + rnd(0, 0.4), from.z + Math.sin(a) * 0.6);
        this.particles.push({ sprite: ember, vx: Math.cos(a) * speed, vy: rnd(0.3, 1.2), vz: Math.sin(a) * speed, life: 0.4, maxLife: 0.4, s0: 0.3, s1: 0.05, o0: 0.9, o1: 0 });
      }
    }
  }

  private spawnCastFlash(pos: THREE.Vector3, color: number): void {
    const flash = this.makeSprite('magic', color, THREE.AdditiveBlending);
    flash.position.copy(pos);
    this.particles.push({ sprite: flash, vx: 0, vy: 0, vz: 0, life: 0.22, maxLife: 0.22, s0: 0.3, s1: 1.1, o0: 0.9, o1: 0 });
  }

  private spawnTrail(pos: THREE.Vector3, kind: TrailKind): void {
    if (kind === 'none') return;
    if (kind === 'ember') {
      const ember = this.makeSprite('spark', 0xffb24d, THREE.AdditiveBlending);
      ember.position.set(pos.x + rnd(-0.1, 0.1), pos.y + rnd(-0.1, 0.1), pos.z + rnd(-0.1, 0.1));
      this.particles.push({ sprite: ember, vx: rnd(-0.5, 0.5), vy: rnd(0.2, 0.9), vz: rnd(-0.5, 0.5), life: 0.35, maxLife: 0.35, s0: 0.35, s1: 0.05, o0: 0.9, o1: 0 });
      const smoke = this.makeSprite('smoke', 0x4a3526, THREE.NormalBlending);
      smoke.position.copy(pos);
      smoke.material.rotation = rnd(0, Math.PI * 2);
      this.particles.push({ sprite: smoke, vx: rnd(-0.2, 0.2), vy: rnd(0.3, 0.7), vz: rnd(-0.2, 0.2), life: 0.5, maxLife: 0.5, s0: 0.45, s1: 1.0, o0: 0.3, o1: 0 });
      return;
    }
    // 'frost' — cold sparkles drifting down, no smoke
    const shard = this.makeSprite('star', 0xbdefff, THREE.AdditiveBlending);
    shard.position.set(pos.x + rnd(-0.12, 0.12), pos.y + rnd(-0.12, 0.12), pos.z + rnd(-0.12, 0.12));
    this.particles.push({ sprite: shard, vx: rnd(-0.4, 0.4), vy: rnd(-0.6, 0.1), vz: rnd(-0.4, 0.4), life: 0.4, maxLife: 0.4, s0: 0.3, s1: 0.04, o0: 0.9, o1: 0 });
  }

  private spawnImpact(pos: THREE.Vector3, kind: ImpactKind): void {
    if (kind === 'fire') {
      const burst = this.makeSprite('flame', 0xffffff, THREE.AdditiveBlending);
      burst.position.copy(pos);
      this.particles.push({ sprite: burst, vx: 0, vy: 0.4, vz: 0, life: 0.3, maxLife: 0.3, s0: 0.6, s1: 2.1, o0: 1, o1: 0 });
      this.radialSparks(pos, 10, 0xffcc66, 2, 4);
      return;
    }
    if (kind === 'frost') {
      const flash = this.makeSprite('light', 0xaef0ff, THREE.AdditiveBlending);
      flash.position.copy(pos);
      this.particles.push({ sprite: flash, vx: 0, vy: 0.2, vz: 0, life: 0.28, maxLife: 0.28, s0: 0.5, s1: 1.8, o0: 1, o1: 0 });
      // icy shards fly outward (star sprites)
      for (let k = 0; k < 8; k++) {
        const a = (k / 8) * Math.PI * 2 + rnd(-0.3, 0.3);
        const speed = rnd(2, 3.5);
        const shard = this.makeSprite('star', 0xbdefff, THREE.AdditiveBlending);
        shard.position.copy(pos);
        this.particles.push({ sprite: shard, vx: Math.cos(a) * speed, vy: rnd(0.4, 1.8), vz: Math.sin(a) * speed, life: 0.4, maxLife: 0.4, s0: 0.4, s1: 0.05, o0: 1, o1: 0 });
      }
      return;
    }
    // 'spark' — a small physical hit puff (arrows)
    this.radialSparks(pos, 7, 0xfff0b0, 1.5, 3);
  }

  private radialSparks(pos: THREE.Vector3, count: number, color: number, minSpeed: number, maxSpeed: number): void {
    for (let k = 0; k < count; k++) {
      const a = (k / count) * Math.PI * 2 + rnd(-0.3, 0.3);
      const speed = rnd(minSpeed, maxSpeed);
      const spark = this.makeSprite('spark', color, THREE.AdditiveBlending);
      spark.position.copy(pos);
      this.particles.push({ sprite: spark, vx: Math.cos(a) * speed, vy: rnd(0.5, 2.2), vz: Math.sin(a) * speed, life: 0.4, maxLife: 0.4, s0: 0.4, s1: 0.05, o0: 1, o1: 0 });
    }
  }

  // ---- helpers ----

  private makeSprite(tex: TexKey, color: number, blending: THREE.Blending): THREE.Sprite {
    const mat = new THREE.SpriteMaterial({ map: this.textures.get(tex), color, transparent: true, depthWrite: false, blending });
    const s = new THREE.Sprite(mat);
    this.group.add(s);
    return s;
  }

  // Remove a sprite from the scene and free its per-instance material (the shared texture stays).
  private kill(sprite: THREE.Sprite): void {
    this.group.remove(sprite);
    (sprite.material as THREE.SpriteMaterial).dispose();
  }
}
