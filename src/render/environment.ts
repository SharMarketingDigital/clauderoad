// World atmosphere — presentation only, NEVER touches the sim. A gradient sky with
// a moving sun (day/night cycle), drifting clouds, moon + stars at night, soft
// shadows that follow the sun's angle, an undulating colour-varied ground, dense
// instanced grass, distance fog, and a toggleable rain system. Everything is
// tunable in the block below. `terrainHeight()` seats entities/scenery on the hills.
//
// TEST CONTROLS (keys):  R = toggle rain · T = skip time forward (~2h/press)
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { VILLAGE_CX, VILLAGE_CZ } from './village';

// ===================== TUNABLES =====================
// -- day/night cycle --
const DAY_LENGTH = 240; // seconds for a full sunrise->night->sunrise cycle
const START_TIME = 0.33; // 0..1 time the world opens at (0=midnight, .25=sunrise, .5=noon, .75=sunset)
const TIME_SKIP = 1 / 12; // how far the T key jumps (~2 hours)
const SUN_TILT_Z = -0.32; // how far south the sun arcs (shadow direction); 0 = straight overhead
// Per-time-of-day look. Stops are interpolated; tweak colours/intensities freely.
interface Stop {
  t: number;
  zenith: number; horizon: number; // sky gradient
  sun: number; sunI: number; // directional light colour + intensity
  ambSky: number; ambGrnd: number; ambI: number; // hemisphere fill
  fog: number; // fog colour (also the horizon haze)
  glow: number; glowI: number; // warm glow around the sun disc in the sky
  cloud: number; // cloud tint
  star: number; // star visibility 0..1
}
const DAY: Stop[] = [
  { t: 0.00, zenith: 0x070b18, horizon: 0x121a2e, sun: 0x5570a8, sunI: 0.25, ambSky: 0x2a3a58, ambGrnd: 0x141a26, ambI: 0.42, fog: 0x121a2e, glow: 0x000000, glowI: 0, cloud: 0x2a3450, star: 1 }, // midnight
  { t: 0.22, zenith: 0x1a2c4a, horizon: 0x4a3f55, sun: 0x7a6a92, sunI: 0.35, ambSky: 0x33425e, ambGrnd: 0x1a2230, ambI: 0.5, fog: 0x46404f, glow: 0x66486e, glowI: 0.3, cloud: 0x4a4258, star: 0.55 }, // pre-dawn
  { t: 0.27, zenith: 0x6a86b0, horizon: 0xf0a85a, sun: 0xffb066, sunI: 1.25, ambSky: 0xc8d4e2, ambGrnd: 0x4a5a36, ambI: 0.7, fog: 0xe8a868, glow: 0xff9040, glowI: 1.3, cloud: 0xf0c090, star: 0.05 }, // sunrise
  { t: 0.37, zenith: 0x4a86c8, horizon: 0xcfe0ee, sun: 0xfff0d8, sunI: 1.6, ambSky: 0xbfd8ff, ambGrnd: 0x55673a, ambI: 0.7, fog: 0xcfe0ee, glow: 0xffd0a0, glowI: 0.5, cloud: 0xffffff, star: 0 }, // morning
  { t: 0.50, zenith: 0x3f7bc4, horizon: 0xd5e7f5, sun: 0xfff1d4, sunI: 1.7, ambSky: 0xbfd8ff, ambGrnd: 0x55673a, ambI: 0.7, fog: 0xd5e7f5, glow: 0xfff0d0, glowI: 0.35, cloud: 0xffffff, star: 0 }, // noon
  { t: 0.64, zenith: 0x4a82c0, horizon: 0xd2dfe8, sun: 0xfff0d0, sunI: 1.6, ambSky: 0xbfd8ff, ambGrnd: 0x55673a, ambI: 0.7, fog: 0xd2dfe8, glow: 0xffd8a0, glowI: 0.5, cloud: 0xfdf6ee, star: 0 }, // afternoon
  { t: 0.73, zenith: 0x5a6ba0, horizon: 0xee8a4a, sun: 0xff8a3a, sunI: 1.25, ambSky: 0xc6b4be, ambGrnd: 0x4a4a30, ambI: 0.66, fog: 0xe07a45, glow: 0xff6020, glowI: 1.45, cloud: 0xf0a070, star: 0.05 }, // sunset
  { t: 0.80, zenith: 0x1e2a48, horizon: 0x6a4555, sun: 0x8a6080, sunI: 0.4, ambSky: 0x44405e, ambGrnd: 0x1f2530, ambI: 0.52, fog: 0x5a4050, glow: 0x804060, glowI: 0.45, cloud: 0x55455a, star: 0.5 }, // dusk
  { t: 0.87, zenith: 0x070b18, horizon: 0x121a2e, sun: 0x5570a8, sunI: 0.25, ambSky: 0x2a3a58, ambGrnd: 0x141a26, ambI: 0.42, fog: 0x121a2e, glow: 0x000000, glowI: 0, cloud: 0x2a3450, star: 1 }, // night
  { t: 1.00, zenith: 0x070b18, horizon: 0x121a2e, sun: 0x5570a8, sunI: 0.25, ambSky: 0x2a3a58, ambGrnd: 0x141a26, ambI: 0.42, fog: 0x121a2e, glow: 0x000000, glowI: 0, cloud: 0x2a3450, star: 1 }, // wrap = midnight
];
const MOON_COLOR = 0xdfe6f5;
const MOON_SIZE = 26; // sprite size up in the sky
const STAR_COUNT = 600;
// -- rain --
const RAIN_COUNT = 2200; // drops (instanced points) — lower for perf
const RAIN_AREA = 46; // box half-width around the player the rain falls in
const RAIN_TOP = 26; // how high above the player drops spawn
const RAIN_SPEED = 42; // fall speed (units/s)
const RAIN_FADE = 2.0; // seconds to fade rain in/out
const RAIN_OVERCAST = 0x8a9098; // grey the sky/fog blend toward while raining
const RAIN_SUN_CUT = 0.62; // how much the rain dims the sun (0..1)
const RAIN_FOG_FAR = 88; // fog pulls in this close at full rain
// -- sun shadow --
const SUN_DISTANCE = 70;
const SHADOWS = true;
const SHADOW_MAP_SIZE = 2048;
const SHADOW_AREA = 40;
// -- fog (clear-weather far) --
const FOG_NEAR = 58;
const FOG_FAR = 140;
// -- terrain relief (visual) --
const TERRAIN_AMP = 1.6;
const TERRAIN_SCALE = 0.013;
const FLAT_RADIUS = 26;
const FLAT_RAMP = 16;
const VILLAGE_FLAT = 13;
const GROUND_SIZE = 152;
const GROUND_SEGS = 200;
const GRASS_DARK = 0x3c6b2c;
const GRASS_LIGHT = 0x74a049;
const DIRT = 0x6f5a3c;
const DIRT_THRESHOLD = 0.7;
// -- grass tufts (instanced) --
const GRASS_MODELS = ['Grass_1_A_Color1', 'Grass_1_C_Color1', 'Grass_2_A_Color1'];
const GRASS_COUNT = 900;
const GRASS_SPREAD = 64;
const GRASS_TARGET_H = 0.7;
const GRASS_TINT_LO = 0x6f9a45;
const GRASS_TINT_HI = 0xa9c66a;
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
  return f;
}
function smoothstep(a: number, b: number, x: number): number {
  const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
  return t * t * (3 - 2 * t);
}
function col(hex: number): THREE.Color {
  return new THREE.Color(hex);
}

export function terrainHeight(x: number, z: number): number {
  const rOrigin = Math.hypot(x, z);
  const rVillage = Math.hypot(x - VILLAGE_CX, z - VILLAGE_CZ);
  let m = smoothstep(FLAT_RADIUS, FLAT_RADIUS + FLAT_RAMP, rOrigin);
  m *= smoothstep(VILLAGE_FLAT, VILLAGE_FLAT + 8, rVillage);
  if (m <= 0) return 0;
  return (fbm(x * TERRAIN_SCALE, z * TERRAIN_SCALE) - 0.5) * 2 * TERRAIN_AMP * m;
}

// ---- sky dome: vertical gradient + a warm glow around the sun ----
function makeSky(): { mesh: THREE.Mesh; uniforms: Record<string, THREE.IUniform> } {
  const uniforms = {
    // placeholder colours — overwritten by applyTime() on the first frame
    top: { value: col(0x3f7bc4) },
    bottom: { value: col(0xd5e7f5) },
    sunDir: { value: new THREE.Vector3(0, 1, 0) },
    glow: { value: col(0xffffff) },
    glowI: { value: 0.4 },
  };
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(420, 32, 16),
    new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false, uniforms,
      vertexShader: `varying vec3 vDir; void main(){ vDir = position; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
      fragmentShader: `uniform vec3 top; uniform vec3 bottom; uniform vec3 sunDir; uniform vec3 glow; uniform float glowI; varying vec3 vDir;
        void main(){ vec3 d = normalize(vDir); float t = clamp(d.y*0.5+0.5, 0.0, 1.0); vec3 c = mix(bottom, top, pow(t, 0.65));
          float s = max(dot(d, normalize(sunDir)), 0.0); c += glow * pow(s, 7.0) * glowI; gl_FragColor = vec4(c, 1.0); }`,
    }),
  );
  mesh.renderOrder = -3;
  return { mesh, uniforms };
}

function makeCloudTexture(): THREE.CanvasTexture {
  const W = 1024, H = 512;
  const canvas = document.createElement('canvas');
  canvas.width = W; canvas.height = H;
  const ctx = canvas.getContext('2d')!;
  const img = ctx.createImageData(W, H);
  for (let y = 0; y < H; y++) {
    const vFade = smoothstep(0.05, 0.5, y / H);
    for (let x = 0; x < W; x++) {
      const n = fbm((x / W) * 8, (y / H) * 8 + 50);
      const a = smoothstep(0.5, 0.75, n) * vFade;
      const i = (y * W + x) * 4;
      img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255;
      img.data[i + 3] = Math.round(a * 255);
    }
  }
  ctx.putImageData(img, 0, 0);
  const tex = new THREE.CanvasTexture(canvas);
  tex.wrapS = THREE.RepeatWrapping;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeClouds(): { mesh: THREE.Mesh; tex: THREE.CanvasTexture; mat: THREE.MeshBasicMaterial } {
  const tex = makeCloudTexture();
  const mat = new THREE.MeshBasicMaterial({ map: tex, transparent: true, opacity: 0.85, depthWrite: false, fog: false, side: THREE.BackSide });
  const mesh = new THREE.Mesh(new THREE.SphereGeometry(400, 32, 16), mat);
  mesh.renderOrder = -2;
  return { mesh, tex, mat };
}

function makeMoonTexture(): THREE.CanvasTexture {
  const S = 128;
  const canvas = document.createElement('canvas');
  canvas.width = S; canvas.height = S;
  const ctx = canvas.getContext('2d')!;
  const g = ctx.createRadialGradient(S / 2, S / 2, 0, S / 2, S / 2, S / 2);
  g.addColorStop(0, 'rgba(255,255,255,1)');
  g.addColorStop(0.55, 'rgba(235,242,255,1)');
  g.addColorStop(0.72, 'rgba(220,228,245,0.5)');
  g.addColorStop(1, 'rgba(220,228,245,0)');
  ctx.fillStyle = g; ctx.fillRect(0, 0, S, S);
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}
function makeStars(): THREE.Points {
  const pos = new Float32Array(STAR_COUNT * 3);
  let s = 0x2f6b91;
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < STAR_COUNT; i++) {
    const u = rnd(), v = rnd() * 0.5 + 0.5; // upper hemisphere
    const theta = u * Math.PI * 2, phi = Math.acos(v);
    const r = 405;
    pos[i * 3] = r * Math.sin(phi) * Math.cos(theta);
    pos[i * 3 + 1] = r * Math.cos(phi);
    pos[i * 3 + 2] = r * Math.sin(phi) * Math.sin(theta);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  const mat = new THREE.PointsMaterial({ color: 0xffffff, size: 1.6, sizeAttenuation: false, transparent: true, opacity: 0, depthWrite: false, fog: false });
  const stars = new THREE.Points(geo, mat);
  stars.renderOrder = -1;
  return stars;
}

function makeGround(): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(GROUND_SIZE, GROUND_SIZE, GROUND_SEGS, GROUND_SEGS);
  geo.rotateX(-Math.PI / 2);
  const pos = geo.attributes.position;
  const dark = col(GRASS_DARK), light = col(GRASS_LIGHT), dirt = col(DIRT);
  const colors = new Float32Array(pos.count * 3);
  const c = new THREE.Color();
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), z = pos.getZ(i);
    pos.setY(i, terrainHeight(x, z));
    const g = fbm(x * 0.05 + 10, z * 0.05 + 10);
    c.copy(dark).lerp(light, smoothstep(0.25, 0.75, g));
    const d = fbm(x * 0.09 + 200, z * 0.09 + 200);
    if (d > DIRT_THRESHOLD) c.lerp(dirt, smoothstep(DIRT_THRESHOLD, DIRT_THRESHOLD + 0.12, d));
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const ground = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, metalness: 0 }));
  ground.receiveShadow = true;
  return ground;
}

function makeRain(): { points: THREE.Points; fall(dt: number, px: number, py: number, pz: number): void; mat: THREE.PointsMaterial } {
  const pos = new Float32Array(RAIN_COUNT * 3);
  let s = 0x71c3a4;
  const rnd = (): number => { s = (s * 1103515245 + 12345) & 0x7fffffff; return s / 0x7fffffff; };
  for (let i = 0; i < RAIN_COUNT; i++) {
    pos[i * 3] = (rnd() * 2 - 1) * RAIN_AREA;
    pos[i * 3 + 1] = rnd() * RAIN_TOP; // local height (0..RAIN_TOP), world += player y
    pos[i * 3 + 2] = (rnd() * 2 - 1) * RAIN_AREA;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  // a soft vertical streak so points read as falling drops
  const S = 16;
  const cv = document.createElement('canvas'); cv.width = S; cv.height = S;
  const cx = cv.getContext('2d')!;
  const g = cx.createLinearGradient(0, 0, 0, S);
  g.addColorStop(0, 'rgba(200,220,255,0)'); g.addColorStop(0.5, 'rgba(210,228,255,0.9)'); g.addColorStop(1, 'rgba(200,220,255,0)');
  cx.fillStyle = g; cx.fillRect(S * 0.4, 0, S * 0.2, S);
  const tex = new THREE.CanvasTexture(cv);
  const mat = new THREE.PointsMaterial({ map: tex, color: 0xbcd0ee, size: 0.9, sizeAttenuation: true, transparent: true, opacity: 0, depthWrite: false, fog: true });
  const points = new THREE.Points(geo, mat);
  points.frustumCulled = false;
  points.visible = false;
  const arr = geo.attributes.position.array as Float32Array;
  return {
    points, mat,
    fall(dt, px, py, pz) {
      points.position.set(px, py, pz); // the rain box follows the player
      const drop = RAIN_SPEED * dt;
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] -= drop;
        if (arr[i] < 0) { arr[i] += RAIN_TOP; arr[i - 1] = (rnd() * 2 - 1) * RAIN_AREA; arr[i + 1] = (rnd() * 2 - 1) * RAIN_AREA; }
      }
      geo.attributes.position.needsUpdate = true;
    },
  };
}

async function populateGrass(scene: THREE.Scene): Promise<void> {
  const loader = new GLTFLoader();
  const gltfs = await Promise.all(GRASS_MODELS.map((n) => loader.loadAsync(`/models/forest/${n}.gltf`)));
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
    return { geo, mat, h: Math.max(1e-3, box.max.y - box.min.y), minY: box.min.y };
  });
  let seed = 0x51ed270b;
  const rnd = (): number => { seed = (seed * 1103515245 + 12345) & 0x7fffffff; return seed / 0x7fffffff; };
  const perModel: THREE.Matrix4[][] = parts.map(() => []);
  const colors: THREE.Color[][] = parts.map(() => []);
  const lo = col(GRASS_TINT_LO), hi = col(GRASS_TINT_HI);
  const m = new THREE.Matrix4(), p = new THREE.Vector3(), q = new THREE.Quaternion(), e = new THREE.Euler(), sc = new THREE.Vector3();
  for (let i = 0; i < GRASS_COUNT; i++) {
    const x = (rnd() * 2 - 1) * GRASS_SPREAD, z = (rnd() * 2 - 1) * GRASS_SPREAD;
    if (Math.hypot(x, z) < 5) continue;
    const idx = Math.floor(rnd() * parts.length); const part = parts[idx];
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
    colors[idx].forEach((cc, i) => inst.setColorAt(i, cc));
    inst.instanceMatrix.needsUpdate = true;
    if (inst.instanceColor) inst.instanceColor.needsUpdate = true;
    inst.castShadow = false; inst.receiveShadow = false;
    group.add(inst);
  });
  scene.add(group);
}

// Server-driven sky state (multiplayer): the time of day (0..1) + whether it's raining.
// When passed to update(), it overrides the local clock + R/T keys so every client
// shows the SAME sky. Offline this is omitted and the local cycle runs.
export interface WeatherState {
  time: number;
  raining: boolean;
}

export interface Environment {
  // `server` (multiplayer only) drives time + rain from the server; omit/null offline to
  // run the local day/night clock + the R/T test keys.
  update(dt: number, px: number, pz: number, py: number, server?: WeatherState | null): void;
  // Freeze the day/night cycle at a fixed time of day (0..1) so a recorded clip
  // always has the same light; pass null to resume the running cycle. Presentation only.
  setTimeOverride(t: number | null): void;
}

export function setupEnvironment(scene: THREE.Scene, renderer: THREE.WebGLRenderer): Environment {
  const fog = new THREE.Fog(0xd5e7f5, FOG_NEAR, FOG_FAR);
  scene.fog = fog;
  if (SHADOWS) { renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap; }

  const { mesh: sky, uniforms: skyU } = makeSky();
  const { mesh: clouds, tex: cloudTex, mat: cloudMat } = makeClouds();
  const stars = makeStars();
  const moon = new THREE.Sprite(new THREE.SpriteMaterial({ map: makeMoonTexture(), color: MOON_COLOR, transparent: true, opacity: 0, depthWrite: false, fog: false }));
  moon.scale.setScalar(MOON_SIZE);
  scene.add(sky, clouds, stars, moon);
  scene.add(makeGround());

  const hemi = new THREE.HemisphereLight(0xbfd8ff, 0x55673a, 0.7);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1d4, 1.7);
  if (SHADOWS) {
    sun.castShadow = true;
    sun.shadow.mapSize.set(SHADOW_MAP_SIZE, SHADOW_MAP_SIZE);
    const cam = sun.shadow.camera;
    cam.near = 1; cam.far = SUN_DISTANCE * 2 + SHADOW_AREA * 2;
    cam.left = -SHADOW_AREA; cam.right = SHADOW_AREA; cam.top = SHADOW_AREA; cam.bottom = -SHADOW_AREA;
    cam.updateProjectionMatrix();
    sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.02;
  }
  scene.add(sun, sun.target);

  const rain = makeRain();
  scene.add(rain.points);

  populateGrass(scene).catch((err) => console.error('[grass] failed to load', err));

  // ---- day/night + weather state ----
  let timeOfDay = START_TIME; // 0..1
  let timeOverride: number | null = null; // when set, the cycle is frozen here (for clean clips)
  let rainAmt = 0; // current rain strength
  let rainTarget = 0; // 0 or 1 (toggled by R)

  window.addEventListener('keydown', (ev) => {
    if (ev.repeat) return;
    const k = ev.key.toLowerCase();
    if (k === 'r') rainTarget = rainTarget > 0.5 ? 0 : 1;
    else if (k === 't') timeOfDay = (timeOfDay + TIME_SKIP) % 1;
  });

  // scratch colours (no per-frame allocation)
  const cTop = new THREE.Color(), cBot = new THREE.Color(), cSun = new THREE.Color(), cFog = new THREE.Color();
  const cGlow = new THREE.Color(), cCloud = new THREE.Color(), cAmbS = new THREE.Color(), cAmbG = new THREE.Color();
  const overcast = col(RAIN_OVERCAST);
  const sunDir = new THREE.Vector3();
  const lerpN = (a: number, b: number, f: number): number => a + (b - a) * f;

  function applyTime(t: number): void {
    // find the two stops bracketing t and the blend factor
    let i = 0;
    while (i < DAY.length - 1 && DAY[i + 1].t <= t) i++;
    const a = DAY[i], b = DAY[Math.min(i + 1, DAY.length - 1)];
    const f = b.t > a.t ? (t - a.t) / (b.t - a.t) : 0;
    cTop.setHex(a.zenith).lerp(col(b.zenith), f);
    cBot.setHex(a.horizon).lerp(col(b.horizon), f);
    cSun.setHex(a.sun).lerp(col(b.sun), f);
    cFog.setHex(a.fog).lerp(col(b.fog), f);
    cGlow.setHex(a.glow).lerp(col(b.glow), f);
    cCloud.setHex(a.cloud).lerp(col(b.cloud), f);
    cAmbS.setHex(a.ambSky).lerp(col(b.ambSky), f);
    cAmbG.setHex(a.ambGrnd).lerp(col(b.ambGrnd), f);
    let sunI = lerpN(a.sunI, b.sunI, f);
    let glowI = lerpN(a.glowI, b.glowI, f);
    const ambI = lerpN(a.ambI, b.ambI, f);
    const starV = lerpN(a.star, b.star, f);

    // sun arc: phase 0 at sunrise(.25), up at noon(.5), down at night
    const phase = (t - 0.25) * Math.PI * 2;
    sunDir.set(Math.cos(phase), Math.sin(phase), SUN_TILT_Z).normalize();
    const dayUp = sunDir.y; // >0 day, <0 night
    // the shadow-casting light is the sun by day, the moon (antipode) by night
    const lightDir = dayUp > 0 ? sunDir.clone() : sunDir.clone().negate();

    // rain darkens/greys everything
    if (rainAmt > 0) {
      cTop.lerp(overcast, 0.72 * rainAmt); cBot.lerp(overcast, 0.72 * rainAmt);
      cFog.lerp(overcast, 0.8 * rainAmt); cCloud.lerp(overcast, 0.85 * rainAmt);
      sunI *= 1 - RAIN_SUN_CUT * rainAmt; glowI *= 1 - rainAmt;
    }

    (skyU.top.value as THREE.Color).copy(cTop);
    (skyU.bottom.value as THREE.Color).copy(cBot);
    (skyU.glow.value as THREE.Color).copy(cGlow);
    skyU.glowI.value = glowI;
    (skyU.sunDir.value as THREE.Vector3).copy(sunDir);

    sun.color.copy(cSun); sun.intensity = Math.max(0.05, sunI);
    sun.userData.dir = lightDir; // remembered for the per-frame follow
    hemi.color.copy(cAmbS); hemi.groundColor.copy(cAmbG); hemi.intensity = ambI;
    fog.color.copy(cFog);
    fog.far = lerpN(FOG_FAR, RAIN_FOG_FAR, rainAmt);
    cloudMat.color.copy(cCloud);
    cloudMat.opacity = lerpN(0.85, 1.0, rainAmt);
    (stars.material as THREE.PointsMaterial).opacity = starV * (1 - rainAmt);
    // moon up at night, on the antipode of the sun
    (moon.material as THREE.SpriteMaterial).opacity = smoothstep(0.06, -0.12, dayUp) * (1 - rainAmt);
  }

  return {
    setTimeOverride(t) {
      timeOverride = t;
    },
    update(dt, px, pz, py, server = null) {
      if (server) {
        // MULTIPLAYER: time + rain are the server's — everyone shares one sky. The local
        // clock and the R/T test keys are overridden each frame (so R/T do nothing in MP).
        timeOfDay = server.time;
        rainTarget = server.raining ? 1 : 0;
      } else if (timeOverride === null) {
        // SINGLE-PLAYER: advance the local clock (the R/T keys + clip override still apply).
        timeOfDay = (timeOfDay + dt / DAY_LENGTH) % 1;
      }
      const tNow = timeOverride ?? timeOfDay; // timeOverride is null in MP -> = server.time
      // ease rain toward its target
      const dir = Math.sign(rainTarget - rainAmt);
      if (dir !== 0) rainAmt = Math.max(0, Math.min(1, rainAmt + dir * dt / RAIN_FADE));

      applyTime(tNow);
      cloudTex.offset.x += 0.0015 * dt;

      // keep the sky/stars/sun-shadow centred on the player; the sun direction is
      // from applyTime (time of day), the position drives the shadow frustum.
      sky.position.set(px, 0, pz);
      clouds.position.set(px, 0, pz);
      stars.position.set(px, 0, pz);
      const ld = sun.userData.dir as THREE.Vector3;
      sun.position.set(px + ld.x * SUN_DISTANCE, py + ld.y * SUN_DISTANCE, pz + ld.z * SUN_DISTANCE);
      sun.target.position.set(px, py, pz);
      sun.target.updateMatrixWorld();
      // moon sits on the antipode of the sun, up in the sky
      moon.position.set(px - sunDir.x * 380, py - sunDir.y * 380, pz - sunDir.z * 380);

      rain.points.visible = rainAmt > 0.01;
      if (rain.points.visible) { rain.mat.opacity = 0.55 * rainAmt; rain.fall(dt, px, py, pz); }
    },
  };
}
