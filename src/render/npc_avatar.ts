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

  // `label`, when given, floats a name tag above the NPC's head (TP3: the teleporter hubs get one so
  // they read as travel points; the vendor/warehouse pass none and look as before).
  constructor(modelUrl: string, label?: string) {
    if (label) this.root.add(makeLabelSprite(label));
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

// A floating name tag (canvas -> sprite) above an NPC's head: teal text on a dark plate so it reads at
// a distance; depthTest off so it isn't hidden by geometry. Presentation only (the render layer may use
// DOM/Three). Sized once from the text; the sprite always faces the camera.
function makeLabelSprite(text: string): THREE.Sprite {
  const font = 44, padX = 20, padY = 12;
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
  ctx.fillStyle = '#9fe8ff'; // teal — the teleporter's distinct colour
  ctx.fillText(text, canvas.width / 2, canvas.height / 2);
  const tex = new THREE.CanvasTexture(canvas);
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false, depthWrite: false }));
  const h = 0.5; // world units tall; width keeps the canvas aspect
  sprite.scale.set(h * (canvas.width / canvas.height), h, 1);
  sprite.position.y = TARGET_HEIGHT + 0.5; // just above the head
  sprite.renderOrder = 20; // draw over the world
  return sprite;
}
