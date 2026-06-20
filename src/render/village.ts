// A small decorative medieval village — presentation only, NEVER touches the sim
// (no collision: the player walks freely through it). Modular KayKit pieces are
// assembled on a 2.0-unit grid into a few cottages + a market stall marking the
// vendor (at 10,6). Deterministic, intentional placement (not scattered).
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Where the village sits: clustered around a small plaza, next to the vendor NPC
// (10,6) and well clear of the player spawn (0,0). forest.ts keeps this circle
// free of trees so nothing grows inside the houses.
// Centred exactly on the vendor NPC (sim spawns it at VENDOR_SPAWN_X/Z = 10,6).
export const VILLAGE_CX = 10;
export const VILLAGE_CZ = 6;
export const VILLAGE_CLEAR = 11; // radius kept free of forest scatter
const PLAZA_X = 10;
const PLAZA_Z = 6;

const MOD = 2.0; // wall module width (measured from the kit); house footprint = 2*MOD per side
const ROOF_Y_NUDGE = 0.0; // raise/lower the roof if it floats or sinks into the walls

const FILES = {
  wall: 'Wall_Plaster_Straight',
  door: 'Wall_Plaster_Door_Round',
  window: 'Wall_Plaster_Window_Wide_Round',
  corner: 'Corner_Exterior_Wood',
  roof: 'Roof_RoundTiles_4x4',
  roofSmall: 'Roof_2x4_RoundTile',
  floor: 'Floor_WoodDark',
  fence: 'Prop_WoodenFence_Single',
  crate: 'Prop_Crate',
  wagon: 'Prop_Wagon',
  chimney: 'Prop_Chimney',
};

const PI = Math.PI;
const HALF = MOD / 2; // 1.0 — segment-centre offset along an edge

// A 4x4 cottage: 8 wall slots [pieceKey, x, z, yaw], 4 corners, 4 floor tiles, roof.
// Built around the local origin; the caller positions + rotates the whole house.
const WALL_SLOTS: [keyof typeof FILES, number, number, number][] = [
  ['door', -HALF, -MOD, 0], ['wall', HALF, -MOD, 0], // front (–Z): door on the left
  ['wall', -HALF, MOD, 0], ['wall', HALF, MOD, 0], // back (+Z)
  ['wall', -MOD, -HALF, PI / 2], ['window', -MOD, HALF, PI / 2], // west (–X), with a window
  ['wall', MOD, -HALF, PI / 2], ['wall', MOD, HALF, PI / 2], // east (+X)
];
const CORNERS: [number, number, number][] = [
  [-MOD, -MOD, 0], [MOD, -MOD, PI / 2], [MOD, MOD, PI], [-MOD, MOD, -PI / 2],
];
const FLOORS: [number, number][] = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]];

// Houses: [x, z] — they RING the vendor (10,6), in the arc away from the spawn (0,0)
// so the SW approach stays open. Each door auto-aims at the vendor/plaza centre.
const HOUSES: [number, number][] = [[16, 9], [8, 13], [15, 2]];

type Templates = Map<string, THREE.Object3D>;

function place(parent: THREE.Object3D, tpl: THREE.Object3D | undefined, x: number, y: number, z: number, yaw: number): void {
  if (!tpl) return;
  const o = tpl.clone(true); // static meshes -> a plain clone is fine (shares geo + material)
  o.position.set(x, y, z);
  o.rotation.y = yaw;
  parent.add(o);
}

function buildHouse(tpl: Templates, wallH: number): THREE.Group {
  const g = new THREE.Group();
  for (const [key, x, z, yaw] of WALL_SLOTS) place(g, tpl.get(FILES[key]), x, 0, z, yaw);
  for (const [x, z, yaw] of CORNERS) place(g, tpl.get(FILES.corner), x, 0, z, yaw);
  for (const [x, z] of FLOORS) place(g, tpl.get(FILES.floor), x, 0, z, 0);
  place(g, tpl.get(FILES.roof), 0, wallH + ROOF_Y_NUDGE, 0, 0);
  place(g, tpl.get(FILES.chimney), HALF, wallH, HALF, 0);
  return g;
}

// The vendor's market stall: a back wall + roof + a crate counter, open toward the
// player's approach. Built around the local origin (= where the vendor stands).
function buildStall(tpl: Templates, wallH: number): THREE.Group {
  const g = new THREE.Group();
  place(g, tpl.get(FILES.wall), -HALF, 0, MOD, 0); // back wall, 2 segments, behind the vendor
  place(g, tpl.get(FILES.wall), HALF, 0, MOD, 0);
  place(g, tpl.get(FILES.roofSmall), 0, wallH, HALF, 0); // roof over the stand
  place(g, tpl.get(FILES.crate), -HALF, 0, -HALF, 0); // counter crates in front
  place(g, tpl.get(FILES.crate), HALF, 0, -HALF, PI / 4);
  return g;
}

export async function populateVillage(scene: THREE.Scene): Promise<void> {
  const loader = new GLTFLoader();
  const names = [...new Set(Object.values(FILES))];
  const gltfs = await Promise.all(names.map((n) => loader.loadAsync(`/models/village/${n}.gltf`)));
  const tpl: Templates = new Map();
  names.forEach((n, i) => {
    const s = gltfs[i].scene;
    s.traverse((o) => {
      o.castShadow = true; // houses drop shadows
      o.receiveShadow = true; // and catch them from each other / the chimney
    });
    tpl.set(n, s);
  });

  // measure the wall height so the roof sits right regardless of the kit's scale
  const wallBox = new THREE.Box3().setFromObject(tpl.get(FILES.wall)!);
  const wallH = wallBox.max.y - wallBox.min.y;

  const village = new THREE.Group();
  village.name = 'village';

  // cottages — door auto-aimed at the plaza
  for (const [x, z] of HOUSES) {
    const house = buildHouse(tpl, wallH);
    house.position.set(x, 0, z);
    house.rotation.y = Math.atan2(x - PLAZA_X, z - PLAZA_Z); // local –Z (door) faces the plaza
    village.add(house);
  }

  // vendor stall at (10,6) — open front aimed back toward the spawn / player approach
  const stall = buildStall(tpl, wallH);
  stall.position.set(10, 0, 6);
  stall.rotation.y = Math.atan2(10, 6); // local –Z (open side) faces the origin
  village.add(stall);

  // a few intentional props around the vendor's plaza
  place(village, tpl.get(FILES.wagon), 7, 0, 3, 0.6); // by the open SW approach
  place(village, tpl.get(FILES.crate), 12, 0, 8, 0.3); // near the stall
  place(village, tpl.get(FILES.crate), 12.7, 0, 8.4, 1.1);
  for (let i = 0; i < 4; i++) place(village, tpl.get(FILES.fence), 5, 0, 3 + i * MOD, PI / 2); // a fence run on the west edge

  scene.add(village);
}
