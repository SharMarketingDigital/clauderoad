// Decorative forest scatter — presentation only, NEVER touches the sim (there is
// no collision: the player walks freely through it, by design). Loads the curated
// KayKit forest models from /models/forest/ and spreads varied trees, rocks,
// bushes and grass across the terrain.
//
// PERF: every model of a given kind is drawn with a single InstancedMesh (one draw
// call regardless of how many are placed), so a busy forest can't spike the frame
// time. Per-instance scale + rotation keep it from reading as a tiled grid.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VILLAGE_CX, VILLAGE_CZ, VILLAGE_CLEAR } from './village';
import { terrainHeight } from './environment';
import { WORLD_HALF } from '../sim/zones';

const DENSITY = 3.0; // global multiplier on every count below — scaled up to fill the larger world
const SPREAD = WORLD_HALF; // half-extent of the scatter area — covers the whole world (the rings)
const CLEAR = 7; // keep a clear radius around the spawn point (origin) — the walkable start area

interface Kind {
  files: string[];
  count: number;
  targetH: number; // models are auto-fit to ~this tall, so the pack's native scale doesn't matter
  varMin: number;
  varMax: number;
}

const KINDS: Kind[] = [
  {
    files: ['Tree_1_A_Color1', 'Tree_2_A_Color1', 'Tree_2_C_Color1', 'Tree_3_A_Color1', 'Tree_4_A_Color1'],
    count: 55, targetH: 7.0, varMin: 0.75, varMax: 1.35,
  },
  {
    files: ['Tree_Bare_1_A_Color1', 'Tree_Bare_1_C_Color1', 'Tree_Bare_2_A_Color1'],
    count: 12, targetH: 6.5, varMin: 0.8, varMax: 1.25,
  },
  {
    files: ['Rock_1_A_Color1', 'Rock_1_E_Color1', 'Rock_2_A_Color1', 'Rock_3_A_Color1', 'Rock_3_J_Color1'],
    count: 40, targetH: 1.5, varMin: 0.5, varMax: 1.9,
  },
  {
    files: ['Bush_1_A_Color1', 'Bush_2_A_Color1', 'Bush_3_A_Color1', 'Bush_4_A_Color1'],
    count: 48, targetH: 1.2, varMin: 0.7, varMax: 1.45,
  },
  {
    // grass is transparent (overdraw), so keep it modest
    files: ['Grass_1_A_Color1', 'Grass_1_C_Color1', 'Grass_2_A_Color1'],
    count: 90, targetH: 0.8, varMin: 0.7, varMax: 1.5,
  },
];

// A model reduced to instancing-ready parts: each sub-mesh's geometry baked into
// the model's local frame (so an InstancedMesh just needs a per-instance matrix),
// plus the bbox to auto-fit + seat it on the ground.
interface Model {
  parts: { geo: THREE.BufferGeometry; mat: THREE.Material | THREE.Material[] }[];
  height: number;
  minY: number;
}

function toModel(scene: THREE.Object3D): Model {
  scene.updateMatrixWorld(true);
  const parts: Model['parts'] = [];
  const box = new THREE.Box3();
  scene.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (!mesh.isMesh || !mesh.geometry) return;
    const geo = mesh.geometry.clone();
    geo.applyMatrix4(mesh.matrixWorld); // bake the mesh's transform -> geometry is now in model space
    parts.push({ geo, mat: mesh.material });
    geo.computeBoundingBox();
    if (geo.boundingBox) box.union(geo.boundingBox);
  });
  return { parts, height: Math.max(1e-3, box.max.y - box.min.y), minY: box.min.y };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export async function populateForest(scene: THREE.Scene): Promise<void> {
  const loader = new GLTFLoader();
  const names = [...new Set(KINDS.flatMap((k) => k.files))];
  const gltfs = await Promise.all(names.map((n) => loader.loadAsync(`/models/forest/${n}.gltf`)));
  const models = new Map<string, Model>();
  names.forEach((n, i) => models.set(n, toModel(gltfs[i].scene)));

  // Deterministic local PRNG (decoration only — never the sim's Rng; see render/CLAUDE.md).
  let seed = 0x1a2b3c4d;
  const rnd = (): number => {
    seed = (seed * 1103515245 + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };

  // Pass 1: place instances, collecting a per-file list of transforms.
  const perFile = new Map<string, THREE.Matrix4[]>();
  const pos = new THREE.Vector3();
  const quat = new THREE.Quaternion();
  const euler = new THREE.Euler();
  const scl = new THREE.Vector3();
  for (const kind of KINDS) {
    const n = Math.round(kind.count * DENSITY);
    for (let i = 0; i < n; i++) {
      const x = (rnd() * 2 - 1) * SPREAD;
      const z = (rnd() * 2 - 1) * SPREAD;
      if (Math.hypot(x, z) < CLEAR) continue; // keep the spawn / start area clear
      if (Math.hypot(x - VILLAGE_CX, z - VILLAGE_CZ) < VILLAGE_CLEAR) continue; // no trees inside the village
      const file = kind.files[Math.floor(rnd() * kind.files.length)];
      const model = models.get(file);
      if (!model) continue;
      const s = clamp((kind.targetH / model.height) * (kind.varMin + rnd() * (kind.varMax - kind.varMin)), 0.1, 6);
      pos.set(x, terrainHeight(x, z) - model.minY * s, z); // seat the base on the (visual) terrain
      euler.set(0, rnd() * Math.PI * 2, 0);
      quat.setFromEuler(euler);
      scl.setScalar(s);
      const m = new THREE.Matrix4().compose(pos, quat, scl);
      let list = perFile.get(file);
      if (!list) {
        list = [];
        perFile.set(file, list);
      }
      list.push(m);
    }
  }

  // Pass 2: one InstancedMesh per model sub-mesh (≈ one draw call per model).
  const forest = new THREE.Group();
  forest.name = 'forest';
  for (const [file, mats] of perFile) {
    const model = models.get(file);
    if (!model) continue;
    for (const part of model.parts) {
      const inst = new THREE.InstancedMesh(part.geo, part.mat, mats.length);
      mats.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true; // trees/rocks/bushes drop shadows
      inst.receiveShadow = false;
      forest.add(inst);
    }
  }
  scene.add(forest);
}
