// Loads the KayKit Knight (GLB) and drives it for the local player: Rig_Medium
// idle/walk clips via an AnimationMixer, sword + shield parented to the hand-slot
// bones, and a procedural attack swing layered on top of the clip pose.
//
// Presentation only. It reads nothing from the world — the renderer tells it when
// the player moves/attacks (derived from IWorld) and feeds it the host delta time.
//
// NOTE on rigs: the Knight uses KayKit's "Rig_Medium" skeleton (bones upperarm.l,
// handslot.r, ...). Its animations therefore come from the Adventurers pack's own
// Rig_Medium_*.glb — NOT KayKit_AnimatedCharacter_v1.2.glb, which is a different,
// incompatible 6-bone rig. There is no melee-attack clip in the free Rig_Medium
// set, so the attack is a small procedural swing (see update()).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const TARGET_HEIGHT = 1.9; // world units — the Knight is auto-scaled to roughly the old capsule's height
const MODEL_FORWARD_Y = 0; // the Knight mesh already faces +Z (sim facing=0); a 180° offset made it run backward
const FADE = 0.18; // idle<->walk crossfade, seconds

// --- attack swing (procedural; layered on top of the idle/walk clip pose) ----------
// The blade winds UP, then cuts DOWN *through* the rest pose into a short follow-
// through, then settles — so it reads as a real cut, not a raise-and-return twitch.
// Successive swings alternate the diagonal for a combo feel. All the feel knobs:
const SWING_SECS = 0.42; // auto-attack swing duration (s) — raise it for a slower, weightier cut
const SWING_SECS_HEAVY = 0.55; // Golpe Forte: longer, to fit a bigger arc
const SWING_AMP = 2.1; // auto-attack arc size (radians of shoulder rotation) — bigger = wider cut
const SWING_AMP_HEAVY = 2.9; // Golpe Forte: wider / more aggressive
const WINDUP_FRAC = 0.34; // fraction of the swing spent raising the sword before the cut
const SETTLE_FRAC = 0.84; // when the follow-through starts easing back to neutral
const FOLLOW_FRAC = 0.35; // how far PAST rest the cut follows through (× amplitude)
// The two diagonal cuts, alternated each swing. Each is the bone-local rotation
// AXIS the blade sweeps around; they are mirror images:
//   CUT_A = '\' (top-right -> bottom-left), CUT_B = '/' (top-left -> bottom-right).
// The Z term drives the forward/back depth of the cut (+Z cuts toward the front /
// the enemy); the X term tilts it into the diagonal. Flip a CUT's Z sign to cut
// front vs back; flip an X sign to swap a diagonal's slant. (Do NOT flip SWING_AMP —
// that negates the whole profile and inverts the wind-up->cut order.)
const CUT_A = new THREE.Vector3(0.6, 0, 1).normalize(); // first swing: '\'
const CUT_B = new THREE.Vector3(-0.6, 0, 1).normalize(); // next swing: '/'

// Easing + the swing's normalized angle profile (multiplied by the amplitude).
const easeOutCubic = (t: number): number => 1 - (1 - t) ** 3;
const easeInCubic = (t: number): number => t * t * t;
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
// progress p in [0,1] -> 0 -> +1 (raise) -> -FOLLOW (cut through rest) -> 0 (settle).
function swingProfile(p: number): number {
  if (p < WINDUP_FRAC) return easeOutCubic(p / WINDUP_FRAC); // raise: quick, decelerating into the wind-up
  if (p < SETTLE_FRAC) {
    const t = (p - WINDUP_FRAC) / (SETTLE_FRAC - WINDUP_FRAC);
    return lerp(1, -FOLLOW_FRAC, easeInCubic(t)); // strike: hold, then accelerate down through rest
  }
  const t = (p - SETTLE_FRAC) / (1 - SETTLE_FRAC);
  return lerp(-FOLLOW_FRAC, 0, easeOutCubic(t)); // settle back to neutral
}

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

export class PlayerAvatar {
  // The renderer parents this into the scene and sets its position/rotation each
  // frame (like any other entity mesh). Empty until the GLB finishes loading.
  readonly root = new THREE.Group();
  ready = false;

  private mixer?: THREE.AnimationMixer;
  private idle?: THREE.AnimationAction;
  private walk?: THREE.AnimationAction;
  private current?: THREE.AnimationAction;

  // The shoulder bone we pulse for the attack. It is animated every frame by the
  // idle/walk clips, so the mixer resets it each tick -> the swing can't accumulate.
  private swingBone?: THREE.Object3D;
  private swingLeft = 0; // seconds remaining on the current swing (0 = not swinging)
  private swingDur = SWING_SECS; // this swing's total duration
  private swingAmp = SWING_AMP; // this swing's arc size (radians)
  private swingAxis = CUT_A; // this swing's diagonal (alternates each attack)
  private swingFlip = false; // toggles \ <-> / each swing
  private readonly tmpQ = new THREE.Quaternion();

  constructor() {
    // Fire-and-forget async load; the game keeps running on the capsule fallback
    // until `ready` flips true. A failure just logs and leaves the capsule in place.
    this.load().catch((err) => console.error('[PlayerAvatar] failed to load', err));
  }

  private async load(): Promise<void> {
    const loader = new GLTFLoader();
    const [knight, general, movement, sword, shield] = await Promise.all([
      loader.loadAsync('/models/Knight.glb'),
      loader.loadAsync('/models/Rig_Medium_General.glb'), // Idle_A, Hit_A, ... (same rig as the Knight)
      loader.loadAsync('/models/Rig_Medium_MovementBasic.glb'), // Walking_A/B/C, Running_A/B
      loader.loadAsync('/models/sword_1handed.gltf'),
      loader.loadAsync('/models/shield_round.gltf'),
    ]);

    const knightObj = knight.scene;
    // Auto-fit to the world: scale to TARGET_HEIGHT and drop the feet onto y=0,
    // so it works regardless of the model's native units.
    let box = new THREE.Box3().setFromObject(knightObj);
    const h = box.max.y - box.min.y || 1;
    knightObj.scale.setScalar(TARGET_HEIGHT / h);
    box = new THREE.Box3().setFromObject(knightObj);
    knightObj.position.y = -box.min.y;
    knightObj.rotation.y = MODEL_FORWARD_Y;
    this.root.add(knightObj);

    // Animations bind by bone name; the Rig_Medium clips target the same bones the
    // Knight skin uses, so the mixer drives the Knight even though the clips ship in
    // separate GLBs.
    this.mixer = new THREE.AnimationMixer(knightObj);
    const clips = [...general.animations, ...movement.animations];
    const byName = (name: string): THREE.AnimationClip | undefined => clips.find((c) => c.name === name);
    const idleClip = byName('Idle_A');
    const walkClip = byName('Walking_A'); // swap to 'Running_A' if the stride looks too slow for the move speed
    if (idleClip) {
      this.idle = this.mixer.clipAction(idleClip);
      this.idle.play();
      this.current = this.idle;
    }
    if (walkClip) this.walk = this.mixer.clipAction(walkClip);

    // Weapons -> KayKit's dedicated hand-slot bones (modeled for identity attach).
    const handR = findNode(knightObj, 'handslot.r');
    const handL = findNode(knightObj, 'handslot.l');
    if (handR) handR.add(sword.scene);
    if (handL) handL.add(shield.scene);
    this.swingBone = findNode(knightObj, 'upperarm.r');

    // A skinned mesh's static bounding box doesn't track the animated pose, so it
    // can get wrongly frustum-culled; disable culling on the whole avatar.
    this.root.traverse((o) => {
      o.frustumCulled = false;
    });

    this.ready = true;
  }

  isSwinging(): boolean {
    return this.swingLeft > 0;
  }

  // Fire a one-shot attack swing. heavy = Golpe Forte (wider, longer, more aggressive).
  // Successive swings alternate the diagonal (\ then /) for a sword-combo feel.
  triggerAttack(heavy: boolean): void {
    this.swingFlip = !this.swingFlip;
    this.swingAxis = this.swingFlip ? CUT_A : CUT_B; // first swing -> '\'
    this.swingDur = heavy ? SWING_SECS_HEAVY : SWING_SECS;
    this.swingAmp = heavy ? SWING_AMP_HEAVY : SWING_AMP;
    this.swingLeft = this.swingDur;
  }

  // Called once per render frame with the host delta and whether the player moved.
  update(dt: number, moving: boolean): void {
    if (!this.mixer) return;
    const want = (moving ? this.walk : this.idle) ?? this.idle;
    if (want && want !== this.current) {
      want.reset().fadeIn(FADE).play();
      this.current?.fadeOut(FADE);
      this.current = want;
    }
    this.mixer.update(dt);

    // Procedural swing, applied AFTER the mixer so it rides on top of the clip pose:
    // wind up -> cut through -> settle, eased, along this swing's diagonal axis.
    if (this.swingLeft > 0 && this.swingBone) {
      const p = Math.min(1, 1 - this.swingLeft / this.swingDur); // 0 -> 1 over the swing
      const angle = swingProfile(p) * this.swingAmp;
      this.swingBone.quaternion.multiply(this.tmpQ.setFromAxisAngle(this.swingAxis, angle));
      this.swingLeft -= dt;
    }
  }
}
