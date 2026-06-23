// Animated 3D characters for the OTHER (remote) players in multiplayer — presentation only,
// never touches the sim. Each remote player is skinned to ITS OWN class (weapon mastery):
// Knight/Barbarian/Ranger/Mage. The shared clips + weapons load ONCE; a per-class TEMPLATE is
// built lazily on first need; each remote player gets its OWN skinned clone of the right
// template (SkeletonUtils.clone — a plain .clone() does not rebuild the skeleton) with its own
// AnimationMixer and material instances. So 20 players across 4 classes = 4 loaded templates
// cloned per id, not 20 reloads.
//
// The LOCAL player keeps its single PlayerAvatar (with the attack swing). Remotes only need
// movement animation: Idle when still, Walk when the interpolated position moves. All four
// class models share the Rig_Medium rig, so one Idle/Walk clip pair drives every skin.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { clone as cloneSkinned } from 'three/examples/jsm/utils/SkeletonUtils.js';
import type { MasteryId } from '../world_api';
import { MASTERY_MODEL } from './class_models';

const TARGET_HEIGHT = 1.9; // world units — matches the local avatar's auto-fit height
const MODEL_FORWARD_Y = 0; // KayKit Rig_Medium faces +Z (sim facing=0)
const FADE = 0.18; // idle<->walk crossfade, seconds
const MOVE_WINDOW_MS = 180; // treat as "moving" this long after the last position change (matches the local player)

// GLTFLoader sanitizes node names ('handslot.r' -> 'handslotr'); match normalized so we find
// the hand-slot bones regardless of which form survived. (Same as player_avatar.ts.)
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

// One remote player's animated character clone (of its class template).
class RemotePlayer {
  readonly root = new THREE.Group();
  private mixer: THREE.AnimationMixer;
  private idle: THREE.AnimationAction;
  private walk: THREE.AnimationAction;
  private current: THREE.AnimationAction;
  private materials: THREE.Material[] = []; // per-instance clones, disposed on release
  private prevX: number;
  private prevZ: number;
  private lastMoveMs = 0;

  constructor(template: THREE.Object3D, idleClip: THREE.AnimationClip, walkClip: THREE.AnimationClip, x: number, z: number) {
    this.prevX = x;
    this.prevZ = z;
    const inner = cloneSkinned(template); // deep skinned clone (character + weapons under the bones)
    // Clone materials per instance so the hit-flash / dead-fade on one player can't bleed onto
    // every other character (they'd otherwise share the template's materials).
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
    this.root.add(inner);

    // The clips bind by bone name; the clone has the same Rig_Medium bones, so the mixer drives it.
    this.mixer = new THREE.AnimationMixer(inner);
    this.idle = this.mixer.clipAction(idleClip);
    this.walk = this.mixer.clipAction(walkClip);
    this.idle.play();
    this.current = this.idle;
  }

  // Idle vs walk from the interpolated position (moving if it changed recently).
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
  }

  dispose(): void {
    this.mixer.stopAllAction();
    for (const m of this.materials) m.dispose(); // textures are shared with the template -> not disposed
  }
}

// Owns the shared clips/weapons, the per-class templates, and the live per-remote avatars.
export class PlayerAvatars {
  ready = false; // the SHARED assets (clips + weapons) are loaded — templates then load lazily per class
  private loading = false; // whether the one-time shared load has been kicked off yet
  private idleClip?: THREE.AnimationClip;
  private walkClip?: THREE.AnimationClip;
  private sword?: THREE.Object3D; // loaded weapon scenes, cloned into each class template
  private shield?: THREE.Object3D;
  private templates = new Map<MasteryId, THREE.Object3D>(); // auto-fit class model (with weapons), built once each
  private templateLoading = new Set<MasteryId>(); // classes whose template load is in flight
  private avatars = new Map<number, RemotePlayer>();

  // No eager load: the shared clips/weapons load LAZILY on the first remote player (see
  // rootFor), and each class template loads on the first remote player OF THAT CLASS. So
  // single-player — which never has a remote player — never fetches or decodes any of them.

  private async loadShared(): Promise<void> {
    const loader = new GLTFLoader();
    // Clips + weapons shared by EVERY class template (all four share the Rig_Medium rig).
    const [general, movement, sword, shield] = await Promise.all([
      loader.loadAsync('/models/Rig_Medium_General.glb'), // Idle_A
      loader.loadAsync('/models/Rig_Medium_MovementBasic.glb'), // Walking_A
      loader.loadAsync('/models/sword_1handed.gltf'),
      loader.loadAsync('/models/shield_round.gltf'),
    ]);
    const clips = [...general.animations, ...movement.animations];
    this.idleClip = clips.find((c) => c.name === 'Idle_A');
    this.walkClip = clips.find((c) => c.name === 'Walking_A');
    this.sword = sword.scene;
    this.shield = shield.scene;
    this.ready = !!(this.idleClip && this.walkClip && this.sword && this.shield);
  }

  // Build (once) the auto-fit character template for a class: load its GLB, scale to
  // TARGET_HEIGHT, seat the feet on y=0, face +Z, and parent its OWN weapon instances
  // (cloned, so each template owns its meshes) under the hand-slot bones. The per-class
  // weapon model is a LATER fatia; for now every class carries the sword + shield, matching
  // the local avatar so no class regresses.
  private async loadTemplate(mastery: MasteryId): Promise<void> {
    if (this.templates.has(mastery) || this.templateLoading.has(mastery)) return;
    this.templateLoading.add(mastery);
    const loader = new GLTFLoader();
    const gltf = await loader.loadAsync(MASTERY_MODEL[mastery]);
    const obj = gltf.scene;
    // Auto-fit: scale to TARGET_HEIGHT and seat the feet on y=0, face +Z (like the local avatar).
    let box = new THREE.Box3().setFromObject(obj);
    const h = box.max.y - box.min.y || 1;
    obj.scale.setScalar(TARGET_HEIGHT / h);
    box = new THREE.Box3().setFromObject(obj);
    obj.position.y = -box.min.y;
    obj.rotation.y = MODEL_FORWARD_Y;
    // Weapons -> the hand-slot bones. Cloned so this template owns them; SkeletonUtils then
    // clones them along with each player's character (each clone gets its own sword + shield).
    if (this.sword) findNode(obj, 'handslot.r')?.add(this.sword.clone());
    if (this.shield) findNode(obj, 'handslot.l')?.add(this.shield.clone());
    this.templates.set(mastery, obj);
    this.templateLoading.delete(mastery);
  }

  // Get (or create) the avatar root for a remote player. The FIRST call kicks off the one-time
  // shared load; the first call for a given CLASS kicks off that class's template load. Returns
  // null until the needed assets are ready (the renderer shows the capsule in the meantime).
  rootFor(id: number, x: number, z: number, mastery: MasteryId): THREE.Object3D | null {
    if (!this.ready || !this.idleClip || !this.walkClip) {
      if (!this.loading) {
        this.loading = true;
        this.loadShared().catch((err) => console.error('[PlayerAvatars] shared load failed', err));
      }
      return null;
    }
    // An existing avatar keeps its skin (a remote player's class doesn't change mid-session).
    const existing = this.avatars.get(id);
    if (existing) return existing.root;
    // Need this class's template; load it lazily and show the capsule until it's ready.
    const template = this.templates.get(mastery);
    if (!template) {
      this.loadTemplate(mastery).catch((err) => console.error('[PlayerAvatars] template load failed', err));
      return null;
    }
    const a = new RemotePlayer(template, this.idleClip, this.walkClip, x, z);
    this.avatars.set(id, a);
    return a.root;
  }

  has(id: number): boolean {
    return this.avatars.has(id);
  }

  update(id: number, dt: number, x: number, z: number, nowMs: number): void {
    this.avatars.get(id)?.update(dt, x, z, nowMs);
  }

  // Drop a player's avatar when they disconnect (dispose its cloned materials + mixer).
  release(id: number): void {
    const a = this.avatars.get(id);
    if (a) {
      a.dispose();
      this.avatars.delete(id);
    }
  }
}
