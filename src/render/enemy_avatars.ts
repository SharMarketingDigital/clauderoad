// Animated 3D skeletons for the enemies — presentation only, never touches the
// sim. Each enemy gets its OWN skinned clone (SkeletonUtils.clone — a plain
// .clone() does not rebuild the skeleton) + its own AnimationMixer, driven from
// the same Rig_Medium clips the player uses (Idle when still, Walk when moving).
// Variety by model (Warrior/Rogue/Minion); Champion/Elite are bigger + tinted;
// the boss is a big purple mage. No melee-attack clip exists in the free Rig_Medium
// set, so a hit is a short procedural lunge (a forward pitch).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { EntityView } from '../world_api';

const AUTOFIT_HEIGHT = 1.8; // base skeleton height in world units (≈ the old capsule); tier scale multiplies this
const MODEL_FORWARD_Y = 0; // KayKit Rig_Medium faces +Z (sim facing=0). Flip to Math.PI if skeletons run backward.
const FADE = 0.18; // idle<->walk crossfade
const MOVE_WINDOW_MS = 180; // treat the enemy as "moving" for this long after its last position change
const LUNGE_SECS = 0.34; // attack-lunge duration
const LUNGE_AMP = 0.55; // attack-lunge forward pitch (radians)

const FILES: Record<string, string> = {
  warrior: '/models/skeletons/Skeleton_Warrior.glb',
  rogue: '/models/skeletons/Skeleton_Rogue.glb',
  minion: '/models/skeletons/Skeleton_Minion.glb',
  mage: '/models/skeletons/Skeleton_Mage.glb',
};
const COMMON = ['warrior', 'rogue', 'minion']; // common wolves rotate through these for variety

const TIER_SCALE: Record<string, number> = { normal: 1, champion: 1.35, elite: 1.7 };
const TIER_TINT: Record<string, number | undefined> = {
  normal: undefined, // natural bone colour
  champion: 0xe0a040, // burnished orange (matches the capsule tier read)
  elite: 0xc94fd0, // arcane violet
};
const BOSS_SCALE = 2.3;
const BOSS_TINT = 0x9b3bd0; // purple — "reads as boss"

interface Style {
  variant: string;
  scale: number;
  tint?: number;
}

// Pick the skeleton model + size + tint from the entity's boss/tier/id.
function styleFor(e: EntityView): Style {
  if (e.boss) return { variant: 'mage', scale: BOSS_SCALE, tint: BOSS_TINT };
  if (e.tier === 'elite') return { variant: 'warrior', scale: TIER_SCALE.elite, tint: TIER_TINT.elite };
  if (e.tier === 'champion') return { variant: 'warrior', scale: TIER_SCALE.champion, tint: TIER_TINT.champion };
  return { variant: COMMON[e.id % COMMON.length], scale: 1 };
}

// One enemy's animated skeleton.
class EnemyAvatar {
  readonly root = new THREE.Group();
  private inner: THREE.Object3D;
  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction;
  private walk: THREE.AnimationAction;
  private current: THREE.AnimationAction;
  private materials: THREE.Material[] = []; // per-instance clones, disposed on release
  private prevX: number;
  private prevZ: number;
  private lastMoveMs = 0;
  private lungeLeft = 0;

  constructor(template: THREE.Object3D, idleClip: THREE.AnimationClip, walkClip: THREE.AnimationClip, style: Style, x: number, z: number) {
    this.prevX = x;
    this.prevZ = z;
    const inner = cloneSkinned(template);
    // Clone materials per instance so the hit-flash + tint can't bleed onto other
    // enemies that share this model's material/texture.
    inner.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (mesh.isMesh && mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material = mesh.material.map((mm) => { const c = mm.clone(); this.materials.push(c); return c; });
        } else {
          const c = mesh.material.clone();
          this.materials.push(c);
          mesh.material = c;
        }
      }
      o.frustumCulled = false; // a skinned mesh's static bbox can be wrongly culled when animated
    });
    if (style.tint !== undefined) {
      for (const m of this.materials) {
        const sm = m as THREE.MeshStandardMaterial;
        if (sm.color) sm.color.setHex(style.tint);
      }
    }

    // Auto-fit to the world, seat the feet on the ground, face +Z.
    let box = new THREE.Box3().setFromObject(inner);
    const h = box.max.y - box.min.y || 1;
    inner.scale.setScalar((AUTOFIT_HEIGHT / h) * style.scale);
    box = new THREE.Box3().setFromObject(inner);
    inner.position.y = -box.min.y;
    inner.rotation.y = MODEL_FORWARD_Y;
    this.inner = inner;
    this.root.add(inner);

    this.mixer = new THREE.AnimationMixer(inner);
    this.idle = this.mixer.clipAction(idleClip);
    this.walk = this.mixer.clipAction(walkClip);
    this.idle.play();
    this.current = this.idle;

    // Status bead above the head, so the renderer's shared updateStatusMarker works.
    const bead = new THREE.Mesh(
      new THREE.SphereGeometry(0.22, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffffff }),
    );
    bead.position.y = box.max.y - box.min.y + 0.35;
    bead.visible = false;
    this.root.add(bead);
    this.root.userData.statusMarker = bead;
  }

  update(dt: number, x: number, z: number, nowMs: number): void {
    if (Math.hypot(x - this.prevX, z - this.prevZ) > 1e-3) {
      this.lastMoveMs = nowMs;
      this.prevX = x;
      this.prevZ = z;
    }
    const moving = nowMs - this.lastMoveMs < MOVE_WINDOW_MS;
    const want = moving ? this.walk : this.idle;
    if (want !== this.current) {
      want.reset().fadeIn(FADE).play();
      this.current.fadeOut(FADE);
      this.current = want;
    }
    this.mixer.update(dt);

    // Attack stand-in: a short forward pitch (lunge), layered on the clip pose.
    if (this.lungeLeft > 0) {
      const p = 1 - this.lungeLeft / LUNGE_SECS;
      this.inner.rotation.x = Math.sin(Math.PI * Math.min(1, p)) * LUNGE_AMP;
      this.lungeLeft -= dt;
      if (this.lungeLeft <= 0) this.inner.rotation.x = 0;
    }
  }

  triggerAttack(): void {
    this.lungeLeft = LUNGE_SECS;
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const m of this.materials) m.dispose(); // textures are shared with the template -> not disposed
  }
}

// Owns the loaded templates/clips and the live per-enemy avatars.
export class EnemyAvatars {
  ready = false;
  private templates = new Map<string, THREE.Object3D>();
  private idleClip?: THREE.AnimationClip;
  private walkClip?: THREE.AnimationClip;
  private avatars = new Map<number, EnemyAvatar>();

  constructor() {
    this.load().catch((err) => console.error('[EnemyAvatars] failed to load', err));
  }

  private async load(): Promise<void> {
    const loader = new GLTFLoader();
    const [warrior, rogue, minion, mage, general, movement] = await Promise.all([
      loader.loadAsync(FILES.warrior),
      loader.loadAsync(FILES.rogue),
      loader.loadAsync(FILES.minion),
      loader.loadAsync(FILES.mage),
      loader.loadAsync('/models/Rig_Medium_General.glb'), // already in public/models from the Knight slice
      loader.loadAsync('/models/Rig_Medium_MovementBasic.glb'),
    ]);
    this.templates.set('warrior', warrior.scene);
    this.templates.set('rogue', rogue.scene);
    this.templates.set('minion', minion.scene);
    this.templates.set('mage', mage.scene);
    const clips = [...general.animations, ...movement.animations];
    this.idleClip = clips.find((c) => c.name === 'Idle_A');
    this.walkClip = clips.find((c) => c.name === 'Walking_A'); // swap to 'Running_A' for a charging look
    this.ready = !!(this.idleClip && this.walkClip);
  }

  // Get (or create) the avatar root for an enemy. Null until templates are ready.
  rootFor(e: EntityView): THREE.Object3D | null {
    if (!this.ready || !this.idleClip || !this.walkClip) return null;
    let a = this.avatars.get(e.id);
    if (!a) {
      const style = styleFor(e);
      const tpl = this.templates.get(style.variant) ?? this.templates.get('warrior');
      if (!tpl) return null;
      a = new EnemyAvatar(tpl, this.idleClip, this.walkClip, style, e.x, e.z);
      this.avatars.set(e.id, a);
    }
    return a.root;
  }

  has(id: number): boolean {
    return this.avatars.has(id);
  }

  update(id: number, dt: number, x: number, z: number, nowMs: number): void {
    this.avatars.get(id)?.update(dt, x, z, nowMs);
  }

  triggerAttack(id: number): void {
    this.avatars.get(id)?.triggerAttack();
  }

  // Drop an enemy's avatar when it despawns (dispose its cloned materials). No-op
  // for ids that were never skeletons.
  release(id: number): void {
    const a = this.avatars.get(id);
    if (a) {
      a.dispose();
      this.avatars.delete(id);
    }
  }
}
