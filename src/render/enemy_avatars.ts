// Animated 3D skeletons for the enemies — presentation only, never touches the
// sim. Each enemy gets its OWN skinned clone (SkeletonUtils.clone — a plain
// .clone() does not rebuild the skeleton) + its own AnimationMixer, driven from
// the same Rig_Medium clips the player uses (Idle when still, Walk when moving).
// The model is chosen by the sim's enemy species — one KayKit skeleton per ring
// (skeleton_minion/rogue/warrior/mage). Champion/Elite are bigger + tinted; bosses
// reuse a model + tint (the Alfa a purple mage skeleton, the Warlord a dark-red
// barbarian). On a hit, the enemy plays a one-shot KayKit attack clip for its kind
// (melee skeletons slice/chop; the mage skeleton casts), then returns to idle/walk.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { EntityView } from '../world_api';

const AUTOFIT_HEIGHT = 1.8; // base skeleton height in world units (≈ the old capsule); tier scale multiplies this
const MODEL_FORWARD_Y = 0; // KayKit Rig_Medium faces +Z (sim facing=0). Flip to Math.PI if skeletons run backward.
const FADE = 0.18; // idle<->walk crossfade
const MOVE_WINDOW_MS = 180; // treat the enemy as "moving" for this long after its last position change
const ATTACK_FADE = 0.1; // quick blend into/out of the one-shot attack clip

const FILES: Record<string, string> = {
  // One skeleton model per ring species (KayKit Skeletons, Rig_Medium).
  minion: '/models/skeletons/Skeleton_Minion.glb',
  rogue: '/models/skeletons/Skeleton_Rogue.glb',
  warrior: '/models/skeletons/Skeleton_Warrior.glb',
  mage: '/models/skeletons/Skeleton_Mage.glb',
  // A KayKit Adventurer kept only for a boss skin (the Warlord). Shares Rig_Medium,
  // so it animates from the same Idle/Walk clips at no extra cost.
  brute: '/models/Barbarian.glb',
};

// Map an enemy species id (sim's EntityView.species) to its skeleton model variant.
// Every common mob carries a ring species; an unknown id falls back to the minion.
const SPECIES_VARIANT: Record<string, string> = {
  skeleton_minion: 'minion',
  skeleton_rogue: 'rogue',
  skeleton_warrior: 'warrior',
  skeleton_mage: 'mage',
};

// The one-shot KayKit attack clip each model variant plays on a hit (Rig_Medium, same rig).
// Melee skeletons slice/chop; the mage skeleton (and the caster boss) cast. Bosses resolve
// through BOSS_VARIANT, so their variant ('mage'/'brute') picks the clip here too.
const VARIANT_ATTACK_CLIP: Record<string, string> = {
  minion: 'Melee_1H_Attack_Slice_Diagonal',
  rogue: 'Melee_1H_Attack_Slice_Diagonal',
  warrior: 'Melee_2H_Attack_Chop', // heavier swing for the bruiser
  mage: 'Ranged_Magic_Shoot',
  brute: 'Melee_2H_Attack_Chop', // the Warlord boss
};

const TIER_SCALE: Record<string, number> = { normal: 1, champion: 1.35, elite: 1.7 };
const TIER_TINT: Record<string, number | undefined> = {
  normal: undefined, // natural bone colour
  champion: 0xe0a040, // burnished orange (matches the capsule tier read)
  elite: 0xc94fd0, // arcane violet
};
const BOSS_SCALE = 2.3;
const BOSS_TINT = 0x9b3bd0; // purple — "reads as boss"

// Per-boss model + tint, keyed by the boss id carried in EntityView.species.
const BOSS_VARIANT: Record<string, { variant: string; tint: number }> = {
  pack_alpha: { variant: 'mage', tint: BOSS_TINT }, // Alfa da Matilha — purple skeleton mage
  warlord: { variant: 'brute', tint: 0xb83232 }, // Senhor da Guerra — dark-red barbarian
};

interface Style {
  variant: string;
  scale: number;
  tint?: number;
}

// Pick the model + size + tint from the entity's boss/species/tier/id.
function styleFor(e: EntityView): Style {
  if (e.boss) {
    const b = BOSS_VARIANT[e.species] ?? { variant: 'mage', tint: BOSS_TINT };
    return { variant: b.variant, scale: BOSS_SCALE, tint: b.tint };
  }
  const scale = TIER_SCALE[e.tier] ?? 1;
  const tint = TIER_TINT[e.tier];
  // Each ring species maps to its own skeleton model at every tier; champion/elite just
  // scale it up and tint it (orange/violet). An unknown species falls back to the minion.
  const named = SPECIES_VARIANT[e.species] ?? 'minion';
  return { variant: named, scale, tint };
}

// One enemy's animated skeleton.
class EnemyAvatar {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction;
  private walk: THREE.AnimationAction;
  private current: THREE.AnimationAction;
  private materials: THREE.Material[] = []; // per-instance clones, disposed on release
  private prevX: number;
  private prevZ: number;
  private lastMoveMs = 0;
  private attack?: THREE.AnimationAction; // one-shot attack clip (LoopOnce); undefined if not found
  private attacking = false; // the attack clip is playing (the locomotion base is faded out)

  constructor(template: THREE.Object3D, idleClip: THREE.AnimationClip, walkClip: THREE.AnimationClip, attackClip: THREE.AnimationClip | undefined, style: Style, x: number, z: number) {
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
      o.castShadow = true;
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
    this.root.add(inner);

    this.mixer = new THREE.AnimationMixer(inner);
    this.idle = this.mixer.clipAction(idleClip);
    this.walk = this.mixer.clipAction(walkClip);
    this.idle.play();
    this.current = this.idle;
    if (attackClip) {
      this.attack = this.mixer.clipAction(attackClip);
      this.attack.setLoop(THREE.LoopOnce, 1);
      this.attack.clampWhenFinished = true;
    }
    // A one-shot attack is the only LoopOnce action here, so 'finished' means the attack
    // ended: fade it out and resume the locomotion base (faded out on the strike).
    this.mixer.addEventListener('finished', () => {
      this.attacking = false;
      this.attack?.fadeOut(ATTACK_FADE);
      this.current.reset().fadeIn(ATTACK_FADE).play();
    });

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
    // While an attack clip plays it owns the body; resume idle/walk only once it finishes.
    if (!this.attacking) {
      const want = moving ? this.walk : this.idle;
      if (want !== this.current) {
        want.reset().fadeIn(FADE).play();
        this.current.fadeOut(FADE);
        this.current = want;
      }
    }
    this.mixer.update(dt);
  }

  triggerAttack(): void {
    if (!this.attack) return;
    this.attack.reset().fadeIn(ATTACK_FADE).play();
    this.current.fadeOut(ATTACK_FADE);
    this.attacking = true;
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
  private clipsByName = new Map<string, THREE.AnimationClip>(); // every loaded clip, for attack lookup
  private avatars = new Map<number, EnemyAvatar>();

  constructor() {
    this.load().catch((err) => console.error('[EnemyAvatars] failed to load', err));
  }

  private async load(): Promise<void> {
    const loader = new GLTFLoader();
    const [minion, rogue, warrior, mage, brute, general, movement, melee, ranged] = await Promise.all([
      loader.loadAsync(FILES.minion),
      loader.loadAsync(FILES.rogue),
      loader.loadAsync(FILES.warrior),
      loader.loadAsync(FILES.mage),
      loader.loadAsync(FILES.brute), // Warlord boss skin
      loader.loadAsync('/models/Rig_Medium_General.glb'), // already in public/models from the Knight slice
      loader.loadAsync('/models/Rig_Medium_MovementBasic.glb'),
      loader.loadAsync('/models/Rig_Medium_CombatMelee.glb'), // Melee_*_Attack_* clips
      loader.loadAsync('/models/Rig_Medium_CombatRanged.glb'), // Ranged_Magic_* clips
    ]);
    this.templates.set('minion', minion.scene);
    this.templates.set('rogue', rogue.scene);
    this.templates.set('warrior', warrior.scene);
    this.templates.set('mage', mage.scene);
    this.templates.set('brute', brute.scene); // used by the Warlord boss variant
    const clips = [
      ...general.animations, ...movement.animations,
      ...melee.animations, ...ranged.animations,
    ];
    this.clipsByName = new Map(clips.map((c) => [c.name, c]));
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
      const attackClip = this.clipsByName.get(VARIANT_ATTACK_CLIP[style.variant] ?? '');
      a = new EnemyAvatar(tpl, this.idleClip, this.walkClip, attackClip, style, e.x, e.z);
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
