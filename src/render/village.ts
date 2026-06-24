// The Jangan-style walled CITY — presentation only, NEVER touches the sim (no collision: the
// player walks freely through it, including the walls; real wall collision is a future sim slice).
// A square STONE rampart (KayKit Dungeon Pack, character-scale ~4 tall) encloses the central
// safe-zone, with a gate at each cardinal point. Inside, MegaKit pieces build a brick plaza on the
// spawn, four streets out to the gates, cottages in the quadrants, four corner keeps, and the
// vendor's market stall. Deterministic, intentional placement on a 4-unit grid.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// The city sits on the central SAFE-ZONE, centered on the spawn (0,0). environment.ts flattens the
// terrain around this point (FLAT_RADIUS covers the wall), and forest.ts keeps the safe-zone clear
// of trees, so the city stands on clean flat ground.
export const VILLAGE_CX = 0; // town centre = spawn / safe-zone centre (environment's terrain-flatten anchor)
export const VILLAGE_CZ = 0;

const PI = Math.PI;
const MOD = 2.0; // MegaKit module width (a house wall segment); house footprint = 2*MOD per side
const HALF = MOD / 2;

const WALL_H = 26; // city-wall half-extent: a 52x52 stone square, just inside the safe-zone (cheb 30)
const SEG = 4; // stone wall segment width (measured from the Dungeon piece: 4.0)
const PLAZA_HALF = 8; // central plaza half-size (16x16) — the spawn + revive marker
const STREET_HALF = 2; // street half-width (4 wide), aligned with each gate

// Curated asset paths. MegaKit = /models/village/*.gltf (+bin+atlas, already curated). Stone walls
// = /models/walls/*.gltf.glb (Dungeon Pack, self-contained). Greenery = /models/forest/*.gltf
// (already curated for forest.ts). Lantern = /models/props/ (RPGToolsBits).
const ASSETS: Record<string, string> = {
  // MegaKit — cottages / plaza / keeps / stall
  mwall: '/models/village/Wall_Plaster_Straight.gltf',
  door: '/models/village/Wall_Plaster_Door_Round.gltf',
  window: '/models/village/Wall_Plaster_Window_Wide_Round.gltf',
  corner: '/models/village/Corner_Exterior_Wood.gltf',
  roof: '/models/village/Roof_RoundTiles_4x4.gltf',
  roofSmall: '/models/village/Roof_2x4_RoundTile.gltf',
  towerRoof: '/models/village/Roof_Tower_RoundTiles.gltf',
  floor: '/models/village/Floor_WoodDark.gltf',
  brick: '/models/village/Floor_Brick.gltf',
  crate: '/models/village/Prop_Crate.gltf',
  wagon: '/models/village/Prop_Wagon.gltf',
  chimney: '/models/village/Prop_Chimney.gltf',
  // Dungeon Pack — stone city wall (character scale: 4 wide x 4 tall x 1.5 thick, base at y=0)
  swall: '/models/walls/wall.gltf.glb',
  sgate: '/models/walls/wall_gate.gltf.glb',
  scorner: '/models/walls/wallCorner.gltf.glb',
  storch: '/models/walls/torchWall.gltf.glb',
  // greenery (already curated) + a prop
  bush: '/models/forest/Bush_2_A_Color1.gltf',
  tree: '/models/forest/Tree_2_A_Color1.gltf',
  lantern: '/models/props/lantern.gltf',
};

type Templates = Map<string, THREE.Object3D>;

// Clone a template into the parent at (x,y,z)+yaw, optionally scaled. Static meshes -> a plain
// clone shares geometry + material (cheap). No-op if the template failed to load.
function place(parent: THREE.Object3D, tpl: THREE.Object3D | undefined, x: number, y: number, z: number, yaw: number, scale = 1): void {
  if (!tpl) return;
  const o = tpl.clone(true);
  o.position.set(x, y, z);
  o.rotation.y = yaw;
  if (scale !== 1) o.scale.setScalar(scale);
  parent.add(o);
}

// --- a 4x4 MegaKit cottage (8 wall slots, 4 corners, 4 floor tiles, a roof + a chimney) ---
const WALL_SLOTS: [string, number, number, number][] = [
  ['door', -HALF, -MOD, 0], ['mwall', HALF, -MOD, 0], // front (–Z): door on the left
  ['mwall', -HALF, MOD, 0], ['mwall', HALF, MOD, 0], // back (+Z)
  ['mwall', -MOD, -HALF, PI / 2], ['window', -MOD, HALF, PI / 2], // west (–X), with a window
  ['mwall', MOD, -HALF, PI / 2], ['mwall', MOD, HALF, PI / 2], // east (+X)
];
const CORNERS: [number, number, number][] = [
  [-MOD, -MOD, 0], [MOD, -MOD, PI / 2], [MOD, MOD, PI], [-MOD, MOD, -PI / 2],
];
const FLOORS: [number, number][] = [[-HALF, -HALF], [HALF, -HALF], [HALF, HALF], [-HALF, HALF]];

function buildHouse(tpl: Templates, wallH: number): THREE.Group {
  const g = new THREE.Group();
  for (const [key, x, z, yaw] of WALL_SLOTS) place(g, tpl.get(key), x, 0, z, yaw);
  for (const [x, z, yaw] of CORNERS) place(g, tpl.get('corner'), x, 0, z, yaw);
  for (const [x, z] of FLOORS) place(g, tpl.get('floor'), x, 0, z, 0);
  place(g, tpl.get('roof'), 0, wallH, 0, 0);
  place(g, tpl.get('chimney'), HALF, wallH, HALF, 0);
  return g;
}

// A two-storey plaster keep capped with a conical tower roof (corner bastion).
function buildTower(tpl: Templates, wallH: number): THREE.Group {
  const g = new THREE.Group();
  for (let story = 0; story < 2; story++) {
    const y = story * wallH;
    for (const [, x, z, yaw] of WALL_SLOTS) place(g, tpl.get('mwall'), x, y, z, yaw);
    for (const [x, z, yaw] of CORNERS) place(g, tpl.get('corner'), x, y, z, yaw);
  }
  place(g, tpl.get('towerRoof'), 0, 2 * wallH, 0, 0);
  return g;
}

// The vendor's market stall: back wall + roof + crate counter, open toward the plaza.
function buildStall(tpl: Templates, wallH: number): THREE.Group {
  const g = new THREE.Group();
  place(g, tpl.get('mwall'), -HALF, 0, MOD, 0);
  place(g, tpl.get('mwall'), HALF, 0, MOD, 0);
  place(g, tpl.get('roofSmall'), 0, wallH, HALF, 0);
  place(g, tpl.get('crate'), -HALF, 0, -HALF, 0);
  place(g, tpl.get('crate'), HALF, 0, -HALF, PI / 4);
  return g;
}

// Pave an axis-aligned rectangle with brick tiles (tessellated by the measured tile size).
function paveRect(parent: THREE.Object3D, brick: THREE.Object3D | undefined, cx: number, cz: number, halfX: number, halfZ: number, step: number, y: number): void {
  if (!brick || step <= 0) return;
  for (let x = cx - halfX; x <= cx + halfX + 1e-6; x += step) {
    for (let z = cz - halfZ; z <= cz + halfZ + 1e-6; z += step) place(parent, brick, x, y, z, 0);
  }
}

// The stone rampart: 4 sides on a 4-unit grid (centre slot = an open gate; the two slots flanking
// each gate are torch-lit), plus the four L-corners. Pieces are centred on X/Z with their base at
// y=0, so placement is a direct grid drop. Corner yaws map the default L (arms toward -X,+Z) onto
// each physical corner.
function buildWall(parent: THREE.Object3D, tpl: Templates): void {
  const centers: number[] = [];
  for (let c = -(WALL_H - 2); c <= WALL_H - 2; c += SEG) centers.push(c); // -24 .. +24, gate at 0
  const keyFor = (c: number): string => (c === 0 ? 'sgate' : Math.abs(c) === SEG ? 'storch' : 'swall');
  for (const c of centers) {
    place(parent, tpl.get(keyFor(c)), c, 0, WALL_H, 0); // north (z=+H), runs along X
    place(parent, tpl.get(keyFor(c)), c, 0, -WALL_H, 0); // south (z=-H)
    place(parent, tpl.get(keyFor(c)), WALL_H, 0, c, PI / 2); // east (x=+H), rotated to run along Z
    place(parent, tpl.get(keyFor(c)), -WALL_H, 0, c, PI / 2); // west (x=-H)
  }
  // L-corners (default arms point -X,+Z): SE=0, SW=+90°, NW=180°, NE=-90°.
  place(parent, tpl.get('scorner'), WALL_H, 0, -WALL_H, 0); // SE
  place(parent, tpl.get('scorner'), -WALL_H, 0, -WALL_H, PI / 2); // SW
  place(parent, tpl.get('scorner'), -WALL_H, 0, WALL_H, PI); // NW
  place(parent, tpl.get('scorner'), WALL_H, 0, WALL_H, -PI / 2); // NE
}

// Cottages lining the quadrants (2 per quadrant), doors auto-aimed at the plaza.
const HOUSES: [number, number][] = [
  [10, 16], [16, 10], [-10, 16], [-16, 10],
  [10, -16], [16, -10], [-10, -16], [-16, -10],
];
// Corner keeps, inside the wall corners (symmetric).
const TOWERS: [number, number][] = [[20, 20], [-20, 20], [20, -20], [-20, -20]];

// Measure a template's footprint width on X (for tiling/spacing) and height on Y.
function sizeOf(o: THREE.Object3D | undefined): { x: number; y: number } {
  if (!o) return { x: MOD, y: 3 };
  const b = new THREE.Box3().setFromObject(o);
  return { x: Math.max(0.1, b.max.x - b.min.x), y: Math.max(0.1, b.max.y - b.min.y) };
}

export async function populateVillage(scene: THREE.Scene): Promise<void> {
  const loader = new GLTFLoader();
  const keys = Object.keys(ASSETS);
  const gltfs = await Promise.all(keys.map((k) => loader.loadAsync(ASSETS[k])));
  const tpl: Templates = new Map();
  keys.forEach((k, i) => {
    const s = gltfs[i].scene;
    s.traverse((o) => { o.castShadow = true; o.receiveShadow = true; });
    tpl.set(k, s);
  });

  const wallH = sizeOf(tpl.get('mwall')).y; // MegaKit wall height, so roofs sit right
  const brickStep = sizeOf(tpl.get('brick')).x; // brick tile size, for paving
  const lanternScale = 1.1 / sizeOf(tpl.get('lantern')).y; // scale the small prop up to ~1.1 tall

  const city = new THREE.Group();
  city.name = 'village';

  // --- stone rampart + 4 cardinal gates ---
  buildWall(city, tpl);

  // --- central plaza on the spawn (0,0): the town square + spawn/revive point ---
  paveRect(city, tpl.get('brick'), 0, 0, PLAZA_HALF, PLAZA_HALF, brickStep, 0.02);

  // --- four streets in a cross, plaza -> each gate (aligned with the gate openings) ---
  const sCen = (PLAZA_HALF + WALL_H) / 2; // street centre between plaza edge and wall
  const sHalf = (WALL_H - PLAZA_HALF) / 2; // street half-length
  paveRect(city, tpl.get('brick'), 0, sCen, STREET_HALF, sHalf, brickStep, 0.02); // north
  paveRect(city, tpl.get('brick'), 0, -sCen, STREET_HALF, sHalf, brickStep, 0.02); // south
  paveRect(city, tpl.get('brick'), sCen, 0, sHalf, STREET_HALF, brickStep, 0.02); // east
  paveRect(city, tpl.get('brick'), -sCen, 0, sHalf, STREET_HALF, brickStep, 0.02); // west

  // --- cottages in the quadrants, doors aimed at the plaza ---
  for (const [x, z] of HOUSES) {
    const h = buildHouse(tpl, wallH);
    h.position.set(x, 0, z);
    h.rotation.y = Math.atan2(x, z); // local -Z (door) faces the centre
    city.add(h);
  }

  // --- corner keeps inside the wall corners ---
  for (const [x, z] of TOWERS) {
    const tw = buildTower(tpl, wallH);
    tw.position.set(x, 0, z);
    city.add(tw);
  }

  // --- vendor stall at (10,6), open side toward the spawn/plaza ---
  const stall = buildStall(tpl, wallH);
  stall.position.set(10, 0, 6);
  stall.rotation.y = Math.atan2(10, 6);
  city.add(stall);

  // --- decoration: standing lanterns flanking each gate (inside), greenery + props on the plaza ---
  const G = WALL_H - 2; // just inside the gate
  place(city, tpl.get('lantern'), -2.5, 0, G, 0, lanternScale);
  place(city, tpl.get('lantern'), 2.5, 0, G, 0, lanternScale);
  place(city, tpl.get('lantern'), -2.5, 0, -G, 0, lanternScale);
  place(city, tpl.get('lantern'), 2.5, 0, -G, 0, lanternScale);
  place(city, tpl.get('lantern'), G, 0, -2.5, 0, lanternScale);
  place(city, tpl.get('lantern'), -G, 0, 2.5, 0, lanternScale);
  // bushes at the plaza corners; small trees by the inner courtyards (off the streets)
  for (const [x, z] of [[10, 10], [-10, 10], [10, -10], [-10, -10]] as [number, number][]) {
    place(city, tpl.get('bush'), x, 0, z, Math.atan2(z, x));
  }
  for (const [x, z] of [[22, 22], [-22, 22], [22, -22], [-22, -22]] as [number, number][]) {
    place(city, tpl.get('tree'), x, 0, z, 0);
  }
  // a couple of intentional props off the spawn centre
  place(city, tpl.get('wagon'), -9, 0, -6, 0.6);
  place(city, tpl.get('crate'), 8, 0, -7, 0.3);

  scene.add(city);
}
