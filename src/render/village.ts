// A small decorative medieval TOWN — presentation only, NEVER touches the sim
// (no collision: the player walks freely through it). Modular KayKit MegaKit pieces
// are assembled on a 2.0-unit grid into a cluster of cottages, two corner towers, a
// brick-paved plaza + street, an ornamental-fence perimeter and an arch gateway,
// all around the vendor (at 10,6). Deterministic, intentional placement.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Where the town sits: clustered around a small plaza, next to the vendor NPC
// (10,6) and well clear of the player spawn (0,0). forest.ts keeps this circle
// free of trees so nothing grows inside the buildings.
export const VILLAGE_CX = 10;
export const VILLAGE_CZ = 6;
export const VILLAGE_CLEAR = 14; // radius kept free of forest scatter (covers the bigger town)
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
  towerRoof: 'Roof_Tower_RoundTiles',
  floor: 'Floor_WoodDark',
  brick: 'Floor_Brick',
  fence: 'Prop_WoodenFence_Single',
  metalFence: 'Prop_MetalFence_Ornament',
  arch: 'Wall_Arch',
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

// Cottages: [x, z] — they RING the vendor (10,6) in the arc away from the spawn (0,0),
// so the SW approach (where the gate + street are) stays open. Doors auto-aim at the plaza.
const HOUSES: [number, number][] = [
  [16, 9], [8, 13], [15, 2], // original three
  [20, 11], [13, 16], [3, 11], // three more, denser town
];

// Two corner towers flanking the town (read as guard towers). [x, z].
const TOWERS: [number, number][] = [[18, 3], [4, 14]];

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

// A two-storey square keep capped with a conical tower roof. Solid plaster walls
// (no door/window) stacked two storeys high; built around the local origin.
function buildTower(tpl: Templates, wallH: number): THREE.Group {
  const g = new THREE.Group();
  for (let story = 0; story < 2; story++) {
    const y = story * wallH;
    for (const [, x, z, yaw] of WALL_SLOTS) place(g, tpl.get(FILES.wall), x, y, z, yaw); // all plain walls
    for (const [x, z, yaw] of CORNERS) place(g, tpl.get(FILES.corner), x, y, z, yaw);
  }
  place(g, tpl.get(FILES.towerRoof), 0, 2 * wallH + ROOF_Y_NUDGE, 0, 0);
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

// Pave an axis-aligned rectangle with brick tiles. `step` is the measured tile size,
// so tiles tessellate without gaps/overlap. Tiles sit just above the ground (y).
function paveRect(parent: THREE.Object3D, brick: THREE.Object3D | undefined, cx: number, cz: number, halfX: number, halfZ: number, step: number, y: number): void {
  if (!brick || step <= 0) return;
  for (let x = cx - halfX; x <= cx + halfX + 1e-6; x += step) {
    for (let z = cz - halfZ; z <= cz + halfZ + 1e-6; z += step) {
      place(parent, brick, x, y, z, 0);
    }
  }
}

// Run a fence in a straight line of `count` segments from (x0,z0) along (dx,dz),
// spaced by the measured segment width, each facing across the run.
function fenceRun(parent: THREE.Object3D, seg: THREE.Object3D | undefined, x0: number, z0: number, dx: number, dz: number, count: number, width: number, yaw: number): void {
  if (!seg || width <= 0) return;
  for (let i = 0; i < count; i++) place(parent, seg, x0 + dx * width * i, 0, z0 + dz * width * i, yaw);
}

// Measure a template's footprint width on X (for tiling/spacing).
function footprintX(o: THREE.Object3D | undefined): number {
  if (!o) return MOD;
  const b = new THREE.Box3().setFromObject(o);
  return Math.max(0.1, b.max.x - b.min.x);
}

export async function populateVillage(scene: THREE.Scene): Promise<void> {
  const loader = new GLTFLoader();
  const names = [...new Set(Object.values(FILES))];
  const gltfs = await Promise.all(names.map((n) => loader.loadAsync(`/models/village/${n}.gltf`)));
  const tpl: Templates = new Map();
  names.forEach((n, i) => {
    const s = gltfs[i].scene;
    s.traverse((o) => {
      o.castShadow = true; // buildings drop shadows
      o.receiveShadow = true; // and catch them from each other
    });
    tpl.set(n, s);
  });

  // measure the wall height so the roof sits right regardless of the kit's scale
  const wallBox = new THREE.Box3().setFromObject(tpl.get(FILES.wall)!);
  const wallH = wallBox.max.y - wallBox.min.y;
  const brickStep = footprintX(tpl.get(FILES.brick)); // brick tile size, for the plaza/street
  const fenceW = footprintX(tpl.get(FILES.metalFence)); // ornamental-fence segment width

  const village = new THREE.Group();
  village.name = 'village';

  // --- ground: a brick-paved plaza + a street leading in from the SW approach ---
  paveRect(village, tpl.get(FILES.brick), PLAZA_X, PLAZA_Z, 4, 4, brickStep, 0.02); // the plaza
  paveRect(village, tpl.get(FILES.brick), 5, 2, 3, 1.5, brickStep, 0.02); // street toward the spawn

  // --- cottages — door auto-aimed at the plaza ---
  for (const [x, z] of HOUSES) {
    const house = buildHouse(tpl, wallH);
    house.position.set(x, 0, z);
    house.rotation.y = Math.atan2(x - PLAZA_X, z - PLAZA_Z); // local –Z (door) faces the plaza
    village.add(house);
  }

  // --- two corner towers ---
  for (const [x, z] of TOWERS) {
    const tower = buildTower(tpl, wallH);
    tower.position.set(x, 0, z);
    village.add(tower);
  }

  // --- vendor stall at (10,6) — open front aimed back toward the spawn / player approach ---
  const stall = buildStall(tpl, wallH);
  stall.position.set(10, 0, 6);
  stall.rotation.y = Math.atan2(10, 6); // local –Z (open side) faces the origin
  village.add(stall);

  // --- an arch gateway on the SW street, framing the approach ---
  place(village, tpl.get(FILES.arch), 5, 0, 1, Math.atan2(PLAZA_X - 5, PLAZA_Z - 1));

  // --- an ornamental-fence perimeter along the N and E edges (SW left open for the gate) ---
  fenceRun(village, tpl.get(FILES.metalFence), 6, 17, 1, 0, 9, fenceW, 0); // north edge (+Z)
  fenceRun(village, tpl.get(FILES.metalFence), 22, 16, 0, -1, 8, fenceW, PI / 2); // east edge (+X)

  // --- intentional props around the vendor's plaza ---
  place(village, tpl.get(FILES.wagon), 7, 0, 3, 0.6); // by the open SW approach
  place(village, tpl.get(FILES.crate), 12, 0, 8, 0.3); // near the stall
  place(village, tpl.get(FILES.crate), 12.7, 0, 8.4, 1.1);
  place(village, tpl.get(FILES.wagon), 14, 0, 11, 2.2); // a second wagon by the NE houses
  for (let i = 0; i < 4; i++) place(village, tpl.get(FILES.fence), 5, 0, 4 + i * MOD, PI / 2); // a wooden fence run on the west edge

  scene.add(village);
}
