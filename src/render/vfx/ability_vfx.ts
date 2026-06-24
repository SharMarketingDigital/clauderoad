// Ability visual effects (GDD §G2) — particle VFX for the classes' abilities, built from the
// Kenney Particle Pack (CC0) textures curated into public/textures/particles/. Presentation
// ONLY: the renderer calls cast() when it detects an ability was used (derived from IWorld —
// the cooldown jump + the local target), and the sim is never touched. All randomness here is
// cosmetic jitter (Math.random), never the sim's deterministic Rng.
//
// This first slice wires the Mago's Bola de Fogo: a projectile that flies from the caster to
// the target with a fiery trail, then bursts on arrival. The system (textured additive sprites
// with per-particle life/scale/opacity) is generic, so later abilities add their own spawn
// recipe + an entry in ABILITY_EFFECT below.
import * as THREE from 'three';
import type { MasteryId } from '../../world_api';

// Curated Kenney textures (only what the wired effects need; add more as abilities land).
const TEXTURES = {
  fire: '/textures/particles/fire_01.png',
  spark: '/textures/particles/spark_01.png',
  smoke: '/textures/particles/smoke_02.png',
  flame: '/textures/particles/flame_04.png',
  magic: '/textures/particles/magic_05.png',
} as const;
type TexKey = keyof typeof TEXTURES;

// Which VFX effect each ability slot plays, by mastery — render-local data-as-code that mirrors
// the sim's action-bar slots WITHOUT importing sim content (keeps the IWorld seam intact). Only
// the Mago's Bola de Fogo (slot 1) is wired so far; the rest land in their own slices.
const ABILITY_EFFECT: Partial<Record<MasteryId, Record<number, string>>> = {
  mage: { 1: 'fireball' },
};

// Look up the VFX effect id for a (mastery, slot), or undefined when nothing is wired yet.
export function abilityEffect(mastery: MasteryId, slot: number): string | undefined {
  return ABILITY_EFFECT[mastery]?.[slot];
}

const FIREBALL_SPEED = 22; // world units/sec — the projectile's flight speed
const TRAIL_EVERY = 0.02; // seconds between trail emissions during flight

const rnd = (a: number, b: number): number => a + Math.random() * (b - a);
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const clamp = (v: number, lo: number, hi: number): number => (v < lo ? lo : v > hi ? hi : v);

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
  t: number; dur: number; // elapsed / total flight time
  emit: number; // countdown to the next trail emission
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

  // Spawn an ability effect from `from` to `to` (world points). No-op until the textures load
  // (they're tiny; the player must equip the Mago and reach a target first) or for unknown ids.
  cast(effect: string, from: THREE.Vector3, to: THREE.Vector3): void {
    if (!this.ready) return;
    if (effect === 'fireball') this.spawnFireball(from, to);
  }

  // Advance every live projectile (flight + trail + impact) and particle (drift + fade), and
  // cull the finished ones. Called once per render frame with the host delta.
  update(dt: number): void {
    for (let i = this.projectiles.length - 1; i >= 0; i--) {
      const pr = this.projectiles[i];
      pr.t += dt;
      const u = Math.min(1, pr.t / pr.dur);
      pr.core.position.lerpVectors(pr.from, pr.to, u);
      pr.core.scale.setScalar(0.9 + 0.08 * Math.sin(pr.t * 40)); // a subtle flicker
      pr.emit -= dt;
      if (pr.emit <= 0) {
        pr.emit = TRAIL_EVERY;
        this.spawnTrail(pr.core.position);
      }
      if (u >= 1) {
        this.spawnImpact(pr.to);
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

  private spawnFireball(from: THREE.Vector3, to: THREE.Vector3): void {
    this.spawnCastFlash(from); // a quick conjure flash at the staff
    const dur = clamp(from.distanceTo(to) / FIREBALL_SPEED, 0.15, 0.7);
    const core = this.makeSprite('fire', 0xffd28a, THREE.AdditiveBlending);
    core.scale.setScalar(0.9);
    core.position.copy(from);
    this.projectiles.push({ core, from: from.clone(), to: to.clone(), t: 0, dur, emit: 0 });
  }

  private spawnCastFlash(pos: THREE.Vector3): void {
    const flash = this.makeSprite('magic', 0xff8a44, THREE.AdditiveBlending);
    flash.position.copy(pos);
    this.particles.push({ sprite: flash, vx: 0, vy: 0, vz: 0, life: 0.22, maxLife: 0.22, s0: 0.3, s1: 1.1, o0: 0.9, o1: 0 });
  }

  private spawnTrail(pos: THREE.Vector3): void {
    const ember = this.makeSprite('spark', 0xffb24d, THREE.AdditiveBlending);
    ember.position.set(pos.x + rnd(-0.1, 0.1), pos.y + rnd(-0.1, 0.1), pos.z + rnd(-0.1, 0.1));
    this.particles.push({ sprite: ember, vx: rnd(-0.5, 0.5), vy: rnd(0.2, 0.9), vz: rnd(-0.5, 0.5), life: 0.35, maxLife: 0.35, s0: 0.35, s1: 0.05, o0: 0.9, o1: 0 });
    const smoke = this.makeSprite('smoke', 0x4a3526, THREE.NormalBlending);
    smoke.position.copy(pos);
    smoke.material.rotation = rnd(0, Math.PI * 2);
    this.particles.push({ sprite: smoke, vx: rnd(-0.2, 0.2), vy: rnd(0.3, 0.7), vz: rnd(-0.2, 0.2), life: 0.5, maxLife: 0.5, s0: 0.45, s1: 1.0, o0: 0.3, o1: 0 });
  }

  private spawnImpact(pos: THREE.Vector3): void {
    const burst = this.makeSprite('flame', 0xffffff, THREE.AdditiveBlending);
    burst.position.copy(pos);
    this.particles.push({ sprite: burst, vx: 0, vy: 0.4, vz: 0, life: 0.3, maxLife: 0.3, s0: 0.6, s1: 2.1, o0: 1, o1: 0 });
    for (let k = 0; k < 10; k++) {
      const a = (k / 10) * Math.PI * 2 + rnd(-0.3, 0.3);
      const speed = rnd(2, 4);
      const spark = this.makeSprite('spark', 0xffcc66, THREE.AdditiveBlending);
      spark.position.copy(pos);
      this.particles.push({ sprite: spark, vx: Math.cos(a) * speed, vy: rnd(0.6, 2.6), vz: Math.sin(a) * speed, life: 0.4, maxLife: 0.4, s0: 0.4, s1: 0.05, o0: 1, o1: 0 });
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
