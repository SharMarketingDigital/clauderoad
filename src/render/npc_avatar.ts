// A fixed, animated NPC (the vendor) — presentation only, never touches the sim.
// Loads a KayKit character (GLB) and plays the Rig_Medium Idle clip; it just stands
// there facing the approach. Same scale/seating convention as the other avatars.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

const TARGET_HEIGHT = 1.8; // world units — match the player/skeletons
const MODEL_FORWARD_Y = 0; // KayKit faces +Z (sim facing=0); flip to Math.PI if it faces backward
// The vendor stands at (10,6); aim it toward the spawn (0,0) so it greets arrivals.
const FACE_YAW = Math.atan2(-10, -6);

export class NpcAvatar {
  readonly root = new THREE.Group();
  ready = false;
  private mixer?: THREE.AnimationMixer;

  constructor(modelUrl: string) {
    this.load(modelUrl).catch((err) => console.error('[NpcAvatar] failed to load', err));
  }

  private async load(modelUrl: string): Promise<void> {
    const loader = new GLTFLoader();
    const [char, general] = await Promise.all([
      loader.loadAsync(modelUrl),
      loader.loadAsync('/models/Rig_Medium_General.glb'), // already in public/models from the Knight slice
    ]);
    const inner = char.scene;
    // auto-fit to the world + seat the feet on the ground, then face the approach
    let box = new THREE.Box3().setFromObject(inner);
    const h = box.max.y - box.min.y || 1;
    inner.scale.setScalar(TARGET_HEIGHT / h);
    box = new THREE.Box3().setFromObject(inner);
    inner.position.y = -box.min.y;
    inner.rotation.y = MODEL_FORWARD_Y + FACE_YAW;
    inner.traverse((o) => {
      o.frustumCulled = false;
      o.castShadow = true;
    });
    this.root.add(inner);

    this.mixer = new THREE.AnimationMixer(inner);
    const idle = general.animations.find((c) => c.name === 'Idle_A');
    if (idle) this.mixer.clipAction(idle).play();
    this.ready = true;
  }

  update(dt: number): void {
    this.mixer?.update(dt);
  }
}
