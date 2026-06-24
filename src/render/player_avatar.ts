// Loads the local player's CLASS model (GLB) and drives it: Rig_Medium idle/walk clips via an
// AnimationMixer, the class weapon(s) parented to the hand-slot bones (sword+shield, bow, staff
// or spear), and a one-shot ATTACK CLIP (chosen per weapon type) played on top when the player
// strikes. The body skin and weapons both come from the player's class (see class_models.ts);
// all four skins share the Rig_Medium rig, so this code is identical for every one.
//
// Presentation only. It reads nothing from the world — the renderer tells it when
// the player moves/attacks (derived from IWorld) and feeds it the host delta time.
//
// NOTE on rigs: every class skin uses KayKit's "Rig_Medium" skeleton (bones upperarm.l,
// handslot.r, ...). Its animations therefore come from the pack's own Rig_Medium_*.glb —
// NOT KayKit_AnimatedCharacter_v1.2.glb, which is a different, incompatible 6-bone rig.
// Idle/Walk come from General/MovementBasic; the attack clips from CombatMelee/CombatRanged
// (per class — see MASTERY_ATTACK_CLIP). They all bind to the same bones, so one mixer drives them.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import type { MasteryId } from '../world_api';
import { MASTERY_MODEL, MASTERY_WEAPON, MASTERY_ATTACK_CLIP } from './class_models';

const TARGET_HEIGHT = 1.9; // world units — the Knight is auto-scaled to roughly the old capsule's height
const MODEL_FORWARD_Y = 0; // the Knight mesh already faces +Z (sim facing=0); a 180° offset made it run backward
const FADE = 0.18; // idle<->walk crossfade, seconds
const ATTACK_FADE = 0.1; // quick blend into/out of the one-shot attack clip

// GLTFLoader sanitizes node names (strips '.', ':' ...), so 'handslot.r' becomes
// 'handslotr' on the loaded object while the original is kept in userData.name.
// Match on a normalized form so we find bones regardless of which form survived.
function normName(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]/g, '');
}
function findNode(root: THREE.Object3D, gltfName: string): THREE.Object3D | undefined {
  const want = normName(gltfName);
  let found: THREE.Object3D | undefined;
  root.traverse((o) => {
    if (found) return;
    const orig = typeof o.userData?.name === 'string' ? (o.userData.name as string) : '';
    if (normName(o.name) === want || normName(orig) === want) found = o;
  });
  return found;
}

// Free a standalone avatar's GPU resources (geometry + materials + their textures). Used only
// for the LOCAL PlayerAvatar, which OWNS everything it loads — unlike the remote clones, which
// share geometry/textures with their template and so dispose only their cloned materials.
function disposeAvatar(obj: THREE.Object3D): void {
  obj.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh) return;
    mesh.geometry?.dispose();
    const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    for (const mat of mats) {
      if (!mat) continue;
      for (const key of Object.keys(mat)) {
        const val = (mat as unknown as Record<string, unknown>)[key];
        if (val && (val as { isTexture?: boolean }).isTexture) (val as THREE.Texture).dispose();
      }
      mat.dispose();
    }
  });
}

export class PlayerAvatar {
  // The renderer parents this into the scene and sets its position/rotation each
  // frame (like any other entity mesh). Empty until the GLB finishes loading.
  readonly root = new THREE.Group();
  ready = false;
  private disposed = false; // set by dispose(); a load() still in flight then releases instead of attaching

  private mixer?: THREE.AnimationMixer;
  private idle?: THREE.AnimationAction;
  private walk?: THREE.AnimationAction;
  private current?: THREE.AnimationAction; // the active locomotion base (idle/walk)

  // One-shot attack clips for this class (LoopOnce, clamp on the last frame). `attack` is the
  // normal/auto-attack hit; `heavyAttack` is the weightier clip for Golpe Forte (sword only).
  // Either may be undefined if the clip wasn't found; triggerAttack falls back or no-ops.
  private attack?: THREE.AnimationAction;
  private heavyAttack?: THREE.AnimationAction;
  private attacking = false; // an attack clip is currently playing (the base is faded out)

  // `mastery` is the player's class; it picks the body skin (MASTERY_MODEL), the weapon(s)
  // attached to the hand-slot bones (MASTERY_WEAPON), and the attack clip (MASTERY_ATTACK_CLIP).
  constructor(private readonly mastery: MasteryId) {
    // Fire-and-forget async load; the game keeps running on the capsule fallback
    // until `ready` flips true. A failure just logs and leaves the capsule in place.
    this.load().catch((err) => console.error('[PlayerAvatar] failed to load', err));
  }

  private async load(): Promise<void> {
    const loader = new GLTFLoader();
    const weapon = MASTERY_WEAPON[this.mastery];
    const [char, general, movement, melee, ranged, right, left] = await Promise.all([
      loader.loadAsync(MASTERY_MODEL[this.mastery]),
      loader.loadAsync('/models/Rig_Medium_General.glb'), // Idle_A, Hit_A, ... (same rig as every skin)
      loader.loadAsync('/models/Rig_Medium_MovementBasic.glb'), // Walking_A/B/C, Running_A/B
      loader.loadAsync('/models/Rig_Medium_CombatMelee.glb'), // Melee_*_Attack_* clips
      loader.loadAsync('/models/Rig_Medium_CombatRanged.glb'), // Ranged_Bow_* / Ranged_Magic_* clips
      loader.loadAsync(weapon.rightHand),
      weapon.leftHand ? loader.loadAsync(weapon.leftHand) : Promise.resolve(null),
    ]);
    if (this.disposed) {
      // Replaced (the class changed) before the model finished loading: drop the just-decoded
      // GPU resources instead of leaking them on an orphaned root that is never shown.
      disposeAvatar(char.scene);
      disposeAvatar(right.scene);
      if (left) disposeAvatar(left.scene);
      return;
    }

    const charObj = char.scene;
    // Auto-fit to the world: scale to TARGET_HEIGHT and drop the feet onto y=0,
    // so it works regardless of the model's native units.
    let box = new THREE.Box3().setFromObject(charObj);
    const h = box.max.y - box.min.y || 1;
    charObj.scale.setScalar(TARGET_HEIGHT / h);
    box = new THREE.Box3().setFromObject(charObj);
    charObj.position.y = -box.min.y;
    charObj.rotation.y = MODEL_FORWARD_Y;
    this.root.add(charObj);

    // Animations bind by bone name; every Rig_Medium clip (idle/walk AND the combat clips)
    // targets the same bones each class skin uses, so the mixer drives the character even
    // though the clips ship in separate GLBs.
    this.mixer = new THREE.AnimationMixer(charObj);
    const clips = [
      ...general.animations, ...movement.animations,
      ...melee.animations, ...ranged.animations,
    ];
    const byName = (name: string): THREE.AnimationClip | undefined => clips.find((c) => c.name === name);
    const idleClip = byName('Idle_A');
    const walkClip = byName('Walking_A'); // swap to 'Running_A' if the stride looks too slow for the move speed
    if (idleClip) {
      this.idle = this.mixer.clipAction(idleClip);
      this.idle.play();
      this.current = this.idle;
    }
    if (walkClip) this.walk = this.mixer.clipAction(walkClip);

    // The class's attack clip(s) as one-shots: play once, then hold the last frame until faded
    // back out (so a fast clip can't snap to rest before we crossfade to idle/walk).
    const atk = MASTERY_ATTACK_CLIP[this.mastery];
    const mkOneShot = (name?: string): THREE.AnimationAction | undefined => {
      const clip = name ? byName(name) : undefined;
      if (!clip || !this.mixer) return undefined;
      const a = this.mixer.clipAction(clip);
      a.setLoop(THREE.LoopOnce, 1);
      a.clampWhenFinished = true;
      return a;
    };
    this.attack = mkOneShot(atk.attack);
    this.heavyAttack = mkOneShot(atk.heavy);

    // When a one-shot attack finishes, resume the locomotion base (idle/walk was faded out on
    // the strike). Only attack clips are LoopOnce, so 'finished' always means an attack ended.
    this.mixer.addEventListener('finished', () => {
      this.attacking = false;
      this.attack?.fadeOut(ATTACK_FADE);
      this.heavyAttack?.fadeOut(ATTACK_FADE);
      this.current?.reset().fadeIn(ATTACK_FADE).play(); // update() then crossfades to walk if moving
    });

    // Weapon(s) -> KayKit's dedicated hand-slot bones (modeled for identity attach). The right
    // hand always holds the class weapon; the left hand gets an off-hand only when the class has
    // one (Sword & Shield) — bow/staff/spear wield a single weapon and carry nothing off-hand.
    const handR = findNode(charObj, 'handslot.r');
    const handL = findNode(charObj, 'handslot.l');
    if (handR) handR.add(right.scene);
    if (handL && left) handL.add(left.scene);

    // A skinned mesh's static bounding box doesn't track the animated pose, so it
    // can get wrongly frustum-culled; disable culling on the whole avatar.
    this.root.traverse((o) => {
      o.frustumCulled = false;
      o.castShadow = true;
    });

    this.ready = true;
  }

  // Free this avatar's GPU resources. The renderer calls this when the local player's class
  // changes and a new PlayerAvatar replaces this one (after the new one is on screen).
  dispose(): void {
    this.disposed = true; // a load() still in flight will release what it decoded (see load())
    this.mixer?.stopAllAction();
    disposeAvatar(this.root);
  }

  // True while an attack clip is playing — the renderer gates auto-attack swings on this so a
  // bleed tick (or a fast re-fire) can't restart the clip mid-swing.
  isSwinging(): boolean {
    return this.attacking;
  }

  // Fire a one-shot attack clip. heavy = Golpe Forte -> the weightier clip (a chop) when the
  // class has one, else the normal attack. Re-triggering restarts the clip from the top.
  triggerAttack(heavy: boolean): void {
    const action = (heavy && this.heavyAttack) ? this.heavyAttack : this.attack;
    if (!action) return;
    // Stop the OTHER attack action so normal<->heavy can't blend if we switch mid-swing.
    const other = action === this.attack ? this.heavyAttack : this.attack;
    other?.stop();
    action.reset().fadeIn(ATTACK_FADE).play();
    this.current?.fadeOut(ATTACK_FADE);
    this.attacking = true;
  }

  // Called once per render frame with the host delta and whether the player moved.
  update(dt: number, moving: boolean): void {
    if (!this.mixer) return;
    // While an attack clip plays it owns the body; resume idle/walk only once it finishes.
    if (!this.attacking) {
      const want = (moving ? this.walk : this.idle) ?? this.idle;
      if (want && want !== this.current) {
        want.reset().fadeIn(FADE).play();
        this.current?.fadeOut(FADE);
        this.current = want;
      }
    }
    this.mixer.update(dt);
  }
}
