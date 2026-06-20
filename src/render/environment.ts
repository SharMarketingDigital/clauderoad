// World atmosphere — presentation only, NEVER touches the sim. Builds a gradient
// sky + drifting clouds, a sun with soft shadows, an undulating colour-varied
// ground, dense instanced grass, and distance fog. The terrain bumps are VISUAL
// only (kept flat around the spawn/village); `terrainHeight()` lets the renderer
// seat entities/scenery on the hills. Everything is tunable in the block below.
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VILLAGE_CX, VILLAGE_CZ } from './village';

// ===================== TUNABLES =====================
// -- sky --
const SKY_ZENITH = 0x3f7bc4; // blue overhead
const SKY_HORIZON = 0xd5e7f5; // pale at the horizon
const SKY_EXPONENT = 0.65; // gradient falloff (lower = horizon band thinner)
// -- clouds --
const CLOUD_COVERAGE = 0.5; // 0..1 how much of the sky is cloud
const CLOUD_OPACITY = 0.9;
const CLOUD_DRIFT = 0.0015; // sky-texture scroll per second
const CLOUD_TINT = 0xffffff;
// -- sun + light --
const SUN_COLOR = 0xfff1d4;
const SUN_INTENSITY = 1.7; // kept below 1.0-ish total exposure so light materials (armour/bone) don't blow out to white
const SUN_DIR = new THREE.Vector3(-0.55, 1.0, -0.4); // direction toward the sun (the light angle)
const SUN_DISTANCE = 70; // how far the light sits (drives the shadow camera)
const AMBIENT_SKY = 0xbfd8ff;
const AMBIENT_GROUND = 0x55673a;
const AMBIENT_INTENSITY = 0.7; // hemisphere fill so shadows aren't pitch black
const SHADOWS = true;
const SHADOW_MAP_SIZE = 2048;
const SHADOW_AREA = 38; // half-size of the shadow frustum (follows the player for crisp local shadows)
// -- fog (depth) -- (colour ≈ sky horizon so the world fades into the sky)
const FOG_COLOR = 0xd5e7f5;
const FOG_NEAR = 58;
const FOG_FAR = 140;
// -- terrain relief (visual) --
const TERRAIN_AMP = 1.6; // max hill height (units)
const TERRAIN_SCALE = 0.013; // noise frequency (smaller = broader hills)
const FLAT_RADIUS = 26; // keep this radius around the origin flat (spawn + village + early farm)
const FLAT_RAMP = 16; // distance over which the hills ramp in past FLAT_RADIUS
const VILLAGE_FLAT = 13; // also keep a flat patch under the village
const GROUND_SIZE = 152; // a bit larger than the world (±60) so the fogged edge has ground
const GROUND_SEGS = 200; // ground subdivision (relief detail); one-time cost
// -- ground colour --
const GRASS_DARK = 0x3c6b2c;
const GRASS_LIGHT = 0x74a049;
const DIRT = 0x6f5a3c;
const DIRT_THRESHOLD = 0.7; // above this (a noise field) the ground turns to dirt
// -- grass tufts (instanced) --
const GRASS_MODELS = ['Grass_1_A_Color1', 'Grass_1_C_Color1', 'Grass_2_A_Color1'];
const GRASS_COUNT = 900; // total tufts — lower for perf
const GRASS_SPREAD = 64; // scatter half-extent
const GRASS_TARGET_H = 0.7; // tuft height
const GRASS_TINT_LO = 0x6f9a45;
const GRASS_TINT_HI = 0xa9c66a; // each tuft is tinted somewhere in this range
// ====================================================

// ---- deterministic value noise (decoration only; NEVER the sim's Rng) ----
function hash(x: number, z: number): number {
  const h = Math.sin(x * 127.1 + z * 311.7) * 43758.5453;
  return h - Math.floor(h);
}
function vnoise(x: number, z: number): number {
  const xi = Math.floor(x), zi = Math.floor(z), xf = x - xi, zf = z - zi;
  const u = xf * xf * (3 - 2 * xf), v = zf * zf * (3 - 2 * zf);
  const a = hash(xi, zi), b = hash(xi + 1, zi), c = hash(xi, zi + 1), d = hash(xi + 1, zi + 1);
  return a * (1 - u) * (1 - v) + b * u * (1 - v) + c * (1 - u) * v + d * u * v;
}
function fbm(x: number, z: number): number {
  let f = 0, amp = 0.5, fr = 1;
  for (let i = 0; i < 4; i++) { f += amp * vnoise(x * fr, z * fr); fr *= 2; amp *= 0.5; }
  return f; // ~0..0.94
}
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}

// Visual ground height at a world point — flat around the origin and the village,
// rolling hills farther out. Exported so the renderer/forest seat things on it.
export function terrainHeight(x: number, z: number): number {
  const rOrigin = Math.hypot(x, z);
  const rVillage = Math.hypot(x - VILLAGE_CX, z - VILLAGE_CZ);
  // mask: 0 in the flat zones, ramping to 1 outside both
  let m = smoothstep(FLAT_RADIUS, FLAT_RADIUS + FLAT_RAMP, rOrigin);
  m *= smoothstep(VILLAGE_FLAT, VILLAGE_FLAT + 8, rVillage);
  if (m <= 0) return 0;
  return (fbm(x * TERRAIN_SCALE, z * TERRAIN_SCALE) - 0.5) * 2 * TERRAIN_AMP * m;
}

function col(hex: number): THREE.Color {
  return new THREE.Color(hex);
}

// ---- sky dome (gradient) + cloud dome (drifting) ----
function makeSky(): THREE.Object3D {
  const sky = new THREE.Mesh(
    new THREE.SphereGeometry(420, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide,
      depthWrite: false,
      fog: false,
      uniforms: {
        top: { value: col(SKY_ZENITH) },
        bottom: { value: col(SKY_HORIZON) },
        exponent: { value: SKY_EXPONENT },
      },
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform float exponent; varying vec3 vDir;
        void main(){ float h = normalize(vDir).y; float t = pow(clamp(h*0.5+0.5,0.0,1.0), exponent); gl_FragColor = vec4(mix(bottom, top, t), 1.0); }`,
    }),
  );
  sky.renderOrder = -2;
  return sky;
}

function makeCloudTexture(): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  const tint = col(CLOUD_TINT);
  for (let y = 0; y < H; y++) {
    // fade clouds out near the bottom (horizon/below) so they cluster up high
    const vFade = smoothstep(0.05, 0.5, y / H);
    for (let x = 0; x < W; x++) {
      const n = fbm((x / W) * 8, (y / H) * 8 + 50); // 0..~0.94
      let a = smoothstep(1 - CLOUD_COVERAGE, 1 - CLOUD_COVERAGE + 0.25, n) * vFade;
      const i = (y * W + x) * 4;
      img.data[i] = tint.r * 255; img.data[i + 1] = tint.g * 255; img.data[i + 2] = tint.b * 255;
      img.data[i + 3] = Math.round(a * 255 * CLOUD_OPACITY);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

function makeClouds(): { mesh: THREE.Object3D; tex: THREE.CanvasTexture } {
  const tex = makeCloudTexture();
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(400, 32, 16),
    new THREE.MeshBasicMaterial({ map: tex, transparent: true, depthWrite: false, fog: false, side: THREE.BackSide }),
  );
  mesh.renderOrder = -1;
  return { mesh, tex };
}

// ---- undulating, colour-varied ground ----
function makeGround(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SEGS, GROUND_SEGS);
  geo.rotateX(-Math.PI / 2); // into the XZ plane (y up)
  const pos = geo.attributes.position;
  const dark = col(GRASS_DARK), light = col(GRASS_LIGHT), dirt = col(DIRT);
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    const g = fbm(x * 0.05 + 10, z * 0.05 + 10); // greenness
    c.copy(dark).lerp(light, smoothstep(0.25, 0.75, g));
    const d = fbm(x * 0.09 + 200, z * 0.09 + 200); // dirt patches
    if (d > DIRT_THRESHOLD) c.lerp(dirt, smoothstep(DIRT_THRESHOLD, DIRT_THRESHOLD + 0.12, d));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  ground.receiveShadow = true;
  return ground;
}

// ---- lights: hemisphere fill + sun (shadows) ----
function makeLights(scene: THREE.Scene): THREE.DirectionalLight {
  scene.add(new THREE.HemisphereLight(AMBIENT_SKY, AMBIENT_GROUND, AMBIENT_INTENSITY));
  const sun = new THREE.DirectionalLight(SUN_COLOR, SUN_INTENSITY);
  sun.position.copy(SUN_DIR).normalize().multiplyScalar(SUN_DISTANCE);
  if (SHADOWS) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const cam = sun.shadow.camera;
    cam.near = 1;
    cam.far = SUN_DISTANCE * 2 + SHADOW_AREA * 2;
    cam.left = -SHADOW_AREA; cam.right = SHADOW_AREA; cam.top = SHADOW_AREA; cam.bottom = -SHADOW_AREA;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0006;
    sun.shadow.normalBias = 0.02;
  }
  scene.add(sun);
  scene.add(sun.target);
  return sun;
}

// ---- dense instanced grass, seated on the terrain ----
async function populateGrass(scene: THREE.Scene): Promise<void> {
  const loader = new GLTFLoader();
  const gltfs = await Promise.all(GRASS_MODELS.map((n) => loader.loadAsync(`/models/forest/${n}.gltf`)));
  // bake each model to a single geometry + material + height
  const parts = gltfs.map((g) => {
    const s = g.scene; s.updateMatrixWorld(true);
    let geo: THREE.BufferGeometry | undefined; let mat: THREE.Material | THREE.Material[] | undefined;
    const box = new THREE.Box3();
    s.traverse((o) => {
      const mesh = o as THREE.Mesh;
      if (!mesh.isMesh || !mesh.geometry || geo) return;
      geo = mesh.geometry.clone(); geo.applyMatrix4(mesh.matrixWorld); mat = mesh.material;
      geo.computeBoundingBox(); if (geo.boundingBox) box.copy(geo.boundingBox);
    });
    const h = Math.max(1e-3, box.max.y - box.min.y);
    return { geo, mat, h, minY: box.min.y };
  });

  let seed = 0x51ed270b;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const perModel: THREE.Matrix4[][] = parts.map(() => []);
  const colors: THREE.Color[][] = parts.map(() => []);
  const lo = col(GRASS_TINT_LO), hi = col(GRASS_TINT_HI);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  for (let i = 0; i < GRASS_COUNT; i++) {
    const x = (rnd() * 2 - 1) * GRASS_SPREAD;
    const z = (rnd() * 2 - 1) * GRASS_SPREAD;
    if (Math.hypot(x, z) < 5) continue; // keep the very spawn clear
    const idx = Math.floor(rnd() * parts.length);
    const part = parts[idx];
    if (!part.geo) continue;
    const s = (GRASS_TARGET_H / part.h) * (0.7 + rnd() * 0.8);
    p.set(x, terrainHeight(x, z) - part.minY * s, z);
    e.set(0, rnd() * Math.PI * 2, 0); q.setFromEuler(e); sc.setScalar(s);
    perModel[idx].push(m.clone().compose(p, q, sc));
    colors[idx].push(new THREE.Color().copy(lo).lerp(hi, rnd()));
  }
  const group = new THREE.Group(); group.name = 'grass';
  parts.forEach((part, idx) => {
    const mats = perModel[idx];
    if (!part.geo || mats.length === 0) return;
    const inst = new THREE.InstancedMesh(part.geo, part.mat as THREE.Material, mats.length);
    mats.forEach((mat, i) => inst.setMatrixAt(i, mat));
    colors[idx].forEach((cc, i) => inst.setColorAt(i, cc)); // green variation per tuft
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = false; inst.receiveShadow = false;
    group.add(inst);
  });
  scene.add(group);
}

export interface Environment {
  sun: THREE.DirectionalLight;
  // per-frame: drift clouds + recentre sky/sun-shadow on the player for crisp shadows
  update(dt: number, px: number, pz: number, py: number): void;
}

export function setupEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Environment {
  scene.fog = new THREE.Fog(FOG_COLOR, FOG_NEAR, FOG_FAR);
  if (SHADOWS) {
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap; // soft edges
  }
  const sky = makeSky();
  const { mesh: clouds, tex: cloudTex } = makeClouds();
  scene.add(sky, clouds);
  scene.add(makeGround());
  const sun = makeLights(scene);
  populateGrass(scene).catch((err) => console.error('[grass] failed to load', err));

  const sunOffset = SUN_DIR.clone().normalize().multiplyScalar(SUN_DISTANCE);
  return {
    sun,
    update(dt, px, pz, py) {
      cloudTex.offset.x += CLOUD_DRIFT * dt;
      sky.position.set(px, 0, pz); // keep the dome centred on the player
      clouds.position.set(px, 0, pz);
      // recentre the sun's shadow frustum on the player (direction stays fixed)
      sun.position.set(px + sunOffset.x, py + sunOffset.y, pz + sunOffset.z);
      sun.target.position.set(px, py, pz);
      sun.target.updateMatrixWorld();
    },
  };
}
