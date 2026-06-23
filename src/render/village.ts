// A small decorative medieval TOWN — presentation only, NEVER touches the sim
// (no collision: the player walks freely through it). Modular KayKit MegaKit pieces
// are assembled on a 2.0-unit grid into a cluster of cottages, two corner towers, a
// brick-paved plaza + street, an ornamental-fence perimeter and an arch gateway,
// all around the vendor (at 10,6). Deterministic, intentional placement.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// The town sits on the central SAFE-ZONE, centered on the spawn (0,0): a brick plaza at the
// centre, four streets in a cross, cottages lining them, and guard towers at the corners.
// forest.ts keeps the whole safe-zone free of trees, so nothing grows inside the city.
export const VILLAGE_CX = 0; // town centre = spawn / safe-zone centre (environment's terrain-flatten anchor)
export const VILLAGE_CZ = 0;
const PLAZA_X = 0;
const PLAZA_Z = 0;

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

// Cottages lining the four streets — two per side of each street, doors auto-aimed at the
// central plaza. Spread across the safe-zone; footprints stay well inside cheb 30.
const HOUSES: [number, number][] = [
  [-8, 16], [8, 16], [-8, 24], [8, 24], // north street (+Z)
  [-8, -16], [8, -16], [-8, -24], [8, -24], // south street (-Z)
  [16, -8], [16, 8], [24, -8], [24, 8], // east street (+X)
  [-16, -8], [-16, 8], [-24, -8], [-24, 8], // west street (-X)
];

// Guard towers at the four corners of the town. [x, z].
const TOWERS: [number, number][] = [[24, 24], [-24, 24], [24, -24], [-24, -24]];

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

  // --- central plaza on the spawn (0,0): the town square + spawn/revive point ---
  paveRect(village, tpl.get(FILES.brick), PLAZA_X, PLAZA_Z, 11, 8, brickStep, 0.02); // ~22x16 plaza

  // --- four main streets in a cross, out toward the ring gates (inside the safe-zone) ---
  paveRect(village, tpl.get(FILES.brick), 0, 17, 2, 9, brickStep, 0.02); // north (+Z): z 8..26
  paveRect(village, tpl.get(FILES.brick), 0, -17, 2, 9, brickStep, 0.02); // south (-Z)
  paveRect(village, tpl.get(FILES.brick), 18, 0, 8, 2, brickStep, 0.02); // east (+X): x 10..26
  paveRect(village, tpl.get(FILES.brick), -18, 0, 8, 2, brickStep, 0.02); // west (-X)

  // --- cottages lining the streets — door auto-aimed at the central plaza ---
  for (const [x, z] of HOUSES) {
    const house = buildHouse(tpl, wallH);
    house.position.set(x, 0, z);
    house.rotation.y = Math.atan2(x - PLAZA_X, z - PLAZA_Z); // local -Z (door) faces the plaza
    village.add(house);
  }

  // --- guard towers at the four corners of the town ---
  for (const [x, z] of TOWERS) {
    const tower = buildTower(tpl, wallH);
    tower.position.set(x, 0, z);
    village.add(tower);
  }

  // --- vendor stall at (10,6), on the plaza — open side aimed at the spawn / plaza centre ---
  const stall = buildStall(tpl, wallH);
  stall.position.set(10, 0, 6);
  stall.rotation.y = Math.atan2(10, 6); // local -Z (open side) faces the origin
  village.add(stall);

  // --- arch gateways framing each street's exit to the wilds (at the safe-zone edge) ---
  place(village, tpl.get(FILES.arch), 0, 0, 27, 0); // north gate
  place(village, tpl.get(FILES.arch), 0, 0, -27, 0); // south gate
  place(village, tpl.get(FILES.arch), 27, 0, 0, PI / 2); // east gate
  place(village, tpl.get(FILES.arch), -27, 0, 0, PI / 2); // west gate

  // --- ornamental fences flanking each street gate (town border; the gates stay open) ---
  fenceRun(village, tpl.get(FILES.metalFence), 4, 26, 1, 0, 3, fenceW, 0); // N gate, east flank
  fenceRun(village, tpl.get(FILES.metalFence), -4, 26, -1, 0, 3, fenceW, 0); // N gate, west flank
  fenceRun(village, tpl.get(FILES.metalFence), 4, -26, 1, 0, 3, fenceW, 0); // S gate
  fenceRun(village, tpl.get(FILES.metalFence), -4, -26, -1, 0, 3, fenceW, 0);
  fenceRun(village, tpl.get(FILES.metalFence), 26, 4, 0, 1, 3, fenceW, PI / 2); // E gate
  fenceRun(village, tpl.get(FILES.metalFence), 26, -4, 0, -1, 3, fenceW, PI / 2);
  fenceRun(village, tpl.get(FILES.metalFence), -26, 4, 0, 1, 3, fenceW, PI / 2); // W gate
  fenceRun(village, tpl.get(FILES.metalFence), -26, -4, 0, -1, 3, fenceW, PI / 2);

  // --- intentional props around the plaza (off the spawn centre + the street mouths) ---
  place(village, tpl.get(FILES.wagon), -9, 0, -6, 0.6);
  place(village, tpl.get(FILES.crate), 8, 0, -7, 0.3);
  place(village, tpl.get(FILES.crate), 8.7, 0, -6.6, 1.1);
  place(village, tpl.get(FILES.wagon), -8, 0, 7, 2.2);
  place(village, tpl.get(FILES.crate), 12, 0, 6, 0.4); // by the vendor stall

  scene.add(village);
}
