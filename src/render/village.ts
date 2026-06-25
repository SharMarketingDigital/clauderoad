// The Jangan-style walled CITY — presentation only, NEVER touches the sim (no collision: the
// player walks freely through it, including the walls; real wall collision is a future sim slice).
// A square STONE rampart (KayKit Dungeon Pack, character-scale ~4 tall) encloses the central
// safe-zone, with a gate at each cardinal point. Inside, MegaKit pieces build a brick plaza on the
// spawn, four streets out to the gates, cottages in the quadrants, four corner keeps, and the
// vendor's market stall. Deterministic, intentional placement on a 4-unit grid.
//
// PERF (O4): every repeated piece is drawn with an InstancedMesh (one draw call per template
// sub-mesh, regardless of how many are placed), mirroring forest.ts. The city went from ~522
// individual clones (~785 GPU draw calls, since MegaKit pieces are multi-primitive) to ~38
// InstancedMeshes. Placement is collected as a per-template list of WORLD matrices, then emitted.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { toModel, type Model } from './forest';

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

// A per-template-key list of WORLD transforms — the input to the InstancedMesh emit pass.
type Mats = Map<string, THREE.Matrix4[]>;

// Scratch reused while composing each piece's local TRS (one-time at load — never per frame).
const _p = new THREE.Vector3();
const _q = new THREE.Quaternion();
const _e = new THREE.Euler();
const _s = new THREE.Vector3();

// Record one placement of `key` at (x,y,z)+yaw (optionally scaled) as a WORLD matrix in `out`.
// `parent`, when given, is the world TRS of the enclosing group (house/tower/stall): the piece's
// local matrix is pre-multiplied by it so the instance carries its final world transform — the
// same result the old clone-into-a-positioned-Group produced.
function record(out: Mats, key: string, x: number, y: number, z: number, yaw: number, scale = 1, parent?: THREE.Matrix4): void {
  _p.set(x, y, z);
  _e.set(0, yaw, 0);
  _q.setFromEuler(_e);
  _s.setScalar(scale);
  const m = new THREE.Matrix4().compose(_p, _q, _s);
  if (parent) m.premultiply(parent); // world = parent * local
  let list = out.get(key);
  if (!list) {
    list = [];
    out.set(key, list);
  }
  list.push(m);
}

// World TRS for a positioned + yawed group (house / tower / stall).
function groupMatrix(x: number, z: number, yaw: number): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, 0, z),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(0, yaw, 0)),
    new THREE.Vector3(1, 1, 1),
  );
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

function recordHouse(out: Mats, parent: THREE.Matrix4, wallH: number): void {
  for (const [key, x, z, yaw] of WALL_SLOTS) record(out, key, x, 0, z, yaw, 1, parent);
  for (const [x, z, yaw] of CORNERS) record(out, 'corner', x, 0, z, yaw, 1, parent);
  for (const [x, z] of FLOORS) record(out, 'floor', x, 0, z, 0, 1, parent);
  record(out, 'roof', 0, wallH, 0, 0, 1, parent);
  record(out, 'chimney', HALF, wallH, HALF, 0, 1, parent);
}

// A two-storey plaster keep capped with a conical tower roof (corner bastion).
function recordTower(out: Mats, parent: THREE.Matrix4, wallH: number): void {
  for (let story = 0; story < 2; story++) {
    const y = story * wallH;
    for (const [, x, z, yaw] of WALL_SLOTS) record(out, 'mwall', x, y, z, yaw, 1, parent);
    for (const [x, z, yaw] of CORNERS) record(out, 'corner', x, y, z, yaw, 1, parent);
  }
  record(out, 'towerRoof', 0, 2 * wallH, 0, 0, 1, parent);
}

// The vendor's market stall: back wall + roof + crate counter, open toward the plaza.
function recordStall(out: Mats, parent: THREE.Matrix4, wallH: number): void {
  record(out, 'mwall', -HALF, 0, MOD, 0, 1, parent);
  record(out, 'mwall', HALF, 0, MOD, 0, 1, parent);
  record(out, 'roofSmall', 0, wallH, HALF, 0, 1, parent);
  record(out, 'crate', -HALF, 0, -HALF, 0, 1, parent);
  record(out, 'crate', HALF, 0, -HALF, PI / 4, 1, parent);
}

// The stone rampart: 4 sides on a 4-unit grid (centre slot = an open gate; the two slots flanking
// each gate are torch-lit), plus the four L-corners. Pieces are centred on X/Z with their base at
// y=0, so placement is a direct grid drop. Corner yaws map the default L (arms toward -X,+Z) onto
// each physical corner.
function recordWall(out: Mats): void {
  const centers: number[] = [];
  for (let c = -(WALL_H - 2); c <= WALL_H - 2; c += SEG) centers.push(c); // -24 .. +24, gate at 0
  const keyFor = (c: number): string => (c === 0 ? 'sgate' : Math.abs(c) === SEG ? 'storch' : 'swall');
  for (const c of centers) {
    record(out, keyFor(c), c, 0, WALL_H, 0); // north (z=+H), runs along X
    record(out, keyFor(c), c, 0, -WALL_H, 0); // south (z=-H)
    record(out, keyFor(c), WALL_H, 0, c, PI / 2); // east (x=+H), rotated to run along Z
    record(out, keyFor(c), -WALL_H, 0, c, PI / 2); // west (x=-H)
  }
  // L-corners (default arms point -X,+Z): SE=0, SW=+90°, NW=180°, NE=-90°.
  record(out, 'scorner', WALL_H, 0, -WALL_H, 0); // SE
  record(out, 'scorner', -WALL_H, 0, -WALL_H, PI / 2); // SW
  record(out, 'scorner', -WALL_H, 0, WALL_H, PI); // NW
  record(out, 'scorner', WALL_H, 0, WALL_H, -PI / 2); // NE
}

// Pave an axis-aligned rectangle with brick tiles (tessellated by the measured tile size).
function paveRect(out: Mats, cx: number, cz: number, halfX: number, halfZ: number, step: number, y: number): void {
  if (step <= 0) return;
  for (let x = cx - halfX; x <= cx + halfX + 1e-6; x += step) {
    for (let z = cz - halfZ; z <= cz + halfZ + 1e-6; z += step) record(out, 'brick', x, y, z, 0);
  }
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
  // Two views of each template: the raw scene (for size measurements) and a baked instancing
  // Model (sub-mesh geometry in model space — handles multi-primitive MegaKit pieces for free).
  const scenes = new Map<string, THREE.Object3D>();
  const models = new Map<string, Model>();
  keys.forEach((k, i) => {
    scenes.set(k, gltfs[i].scene);
    models.set(k, toModel(gltfs[i].scene));
  });

  const wallH = sizeOf(scenes.get('mwall')).y; // MegaKit wall height, so roofs sit right
  const brickStep = sizeOf(scenes.get('brick')).x; // brick tile size, for paving
  const lanternScale = 1.1 / sizeOf(scenes.get('lantern')).y; // scale the small prop up to ~1.1 tall

  // Collect every placement as a per-key list of world matrices (coordinates UNCHANGED from the
  // old clone-based build — the city is laid out pixel-identically), then emit InstancedMeshes.
  const mats: Mats = new Map();

  // --- stone rampart + 4 cardinal gates ---
  recordWall(mats);

  // --- central plaza on the spawn (0,0): the town square + spawn/revive point ---
  paveRect(mats, 0, 0, PLAZA_HALF, PLAZA_HALF, brickStep, 0.02);

  // --- four streets in a cross, plaza -> each gate (aligned with the gate openings) ---
  const sCen = (PLAZA_HALF + WALL_H) / 2; // street centre between plaza edge and wall
  const sHalf = (WALL_H - PLAZA_HALF) / 2; // street half-length
  paveRect(mats, 0, sCen, STREET_HALF, sHalf, brickStep, 0.02); // north
  paveRect(mats, 0, -sCen, STREET_HALF, sHalf, brickStep, 0.02); // south
  paveRect(mats, sCen, 0, sHalf, STREET_HALF, brickStep, 0.02); // east
  paveRect(mats, -sCen, 0, sHalf, STREET_HALF, brickStep, 0.02); // west

  // --- cottages in the quadrants, doors aimed at the plaza ---
  for (const [x, z] of HOUSES) recordHouse(mats, groupMatrix(x, z, Math.atan2(x, z)), wallH);

  // --- corner keeps inside the wall corners ---
  for (const [x, z] of TOWERS) recordTower(mats, groupMatrix(x, z, 0), wallH);

  // --- vendor stall at (10,6), open side toward the spawn/plaza ---
  recordStall(mats, groupMatrix(10, 6, Math.atan2(10, 6)), wallH);

  // --- decoration: standing lanterns flanking each gate (inside), greenery + props on the plaza ---
  const G = WALL_H - 2; // just inside the gate
  record(mats, 'lantern', -2.5, 0, G, 0, lanternScale);
  record(mats, 'lantern', 2.5, 0, G, 0, lanternScale);
  record(mats, 'lantern', -2.5, 0, -G, 0, lanternScale);
  record(mats, 'lantern', 2.5, 0, -G, 0, lanternScale);
  record(mats, 'lantern', G, 0, -2.5, 0, lanternScale);
  record(mats, 'lantern', -G, 0, 2.5, 0, lanternScale);
  // bushes at the plaza corners; small trees by the inner courtyards (off the streets)
  for (const [x, z] of [[10, 10], [-10, 10], [10, -10], [-10, -10]] as [number, number][]) {
    record(mats, 'bush', x, 0, z, Math.atan2(z, x));
  }
  for (const [x, z] of [[22, 22], [-22, 22], [22, -22], [-22, -22]] as [number, number][]) {
    record(mats, 'tree', x, 0, z, 0);
  }
  // a couple of intentional props off the spawn centre
  record(mats, 'wagon', -9, 0, -6, 0.6);
  record(mats, 'crate', 8, 0, -7, 0.3);

  // Emit pass: one InstancedMesh per (template, sub-mesh). Static city -> built once, never
  // touched per frame. castShadow + receiveShadow match the old per-clone flags (village kept
  // both true) so shadows still cast and receive identically.
  const city = new THREE.Group();
  city.name = 'village';
  for (const [key, list] of mats) {
    const model = models.get(key);
    if (!model || list.length === 0) continue;
    for (const part of model.parts) {
      const inst = new THREE.InstancedMesh(part.geo, part.mat, list.length);
      list.forEach((m, i) => inst.setMatrixAt(i, m));
      inst.instanceMatrix.needsUpdate = true;
      inst.castShadow = true;
      inst.receiveShadow = true;
      city.add(inst);
    }
  }
  scene.add(city);
}
