// Three.js renderer. It READS the world (via IWorld) and draws it.
// It must NEVER mutate the world or decide gameplay outcomes.
import * as THREE from 'three';
import type { IWorld, EntityKind, EntityView } from '../world_api';

const FLASH_DURATION = 0.12; // seconds — a quick "I got hit" white flash

export class Renderer {
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private gl: THREE.WebGLRenderer;
  private meshes = new Map<number, THREE.Object3D>();
  private raycaster = new THREE.Raycaster();
  // One reusable selection marker, moved onto the targeted enemy each frame.
  private selectionRing: THREE.Mesh;
  // Hit flashes: entity id -> seconds of white flash remaining. Driven by the
  // host clock (presentation only), decayed each frame.
  private flashes = new Map<number, number>();
  private lastRenderMs = 0;
  private projV = new THREE.Vector3(); // scratch for project()

  // third-person orbit camera state
  private camYaw = 0;
  private camPitch = 0.5;
  private camDist = 14;

  constructor(canvas: HTMLCanvasElement) {
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.scene.background = new THREE.Color(0x9fc0e8);
    this.scene.fog = new THREE.Fog(0x9fc0e8, 70, 150);

    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 600);

    const sun = new THREE.DirectionalLight(0xffffff, 2.2);
    sun.position.set(40, 60, 20);
    this.scene.add(sun);
    this.scene.add(new THREE.HemisphereLight(0xbfd8ff, 0x3a5a2a, 0.85));

    const ground = new THREE.Mesh(
      new THREE.PlaneGeometry(2 * 70, 2 * 70),
      new THREE.MeshStandardMaterial({ color: 0x4f7a3a }),
    );
    ground.rotation.x = -Math.PI / 2;
    this.scene.add(ground);

    this.selectionRing = makeSelectionRing();
    this.scene.add(this.selectionRing);

    this.scatterTrees();
    this.resize();
    window.addEventListener('resize', () => this.resize());
  }

  // Raycast screen coordinates against entity meshes; returns the id of the
  // entity under the cursor, or null. Read-only — used for click-to-target.
  pick(clientX: number, clientY: number): number | null {
    const ndc = new THREE.Vector2(
      (clientX / window.innerWidth) * 2 - 1,
      -(clientY / window.innerHeight) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);
    const hits = this.raycaster.intersectObjects([...this.meshes.values()], true);
    for (const h of hits) {
      let o: THREE.Object3D | null = h.object;
      while (o) {
        const id = o.userData.entityId;
        if (typeof id === 'number') return id;
        o = o.parent;
      }
    }
    return null;
  }

  // Purely decorative scenery (visual only, outside the sim). A tiny local
  // PRNG keeps it stable per load without touching the sim's Rng.
  private scatterTrees(): void {
    const trunkMat = new THREE.MeshStandardMaterial({ color: 0x5b3a21 });
    const leafMat = new THREE.MeshStandardMaterial({ color: 0x2f5d2f });
    let s = 0x1234;
    const rnd = (): number => {
      s = (s * 1103515245 + 12345) & 0x7fffffff;
      return s / 0x7fffffff;
    };
    for (let i = 0; i < 90; i++) {
      const x = (rnd() * 2 - 1) * 68;
      const z = (rnd() * 2 - 1) * 68;
      if (Math.hypot(x, z) < 6) continue; // keep spawn clear
      const g = new THREE.Group();
      const trunk = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.45, 2, 6), trunkMat);
      trunk.position.y = 1;
      const leaves = new THREE.Mesh(new THREE.ConeGeometry(1.7, 3.6, 7), leafMat);
      leaves.position.y = 3.5;
      g.add(trunk, leaves);
      g.position.set(x, 0, z);
      this.scene.add(g);
    }
  }

  orbit(dYaw: number, dPitch: number): void {
    this.camYaw -= dYaw;
    this.camPitch = clamp(this.camPitch + dPitch, 0.15, 1.3);
  }

  zoom(d: number): void {
    this.camDist = clamp(this.camDist + d, 6, 32);
  }

  get yaw(): number {
    return this.camYaw;
  }

  // Start a quick white flash on an entity's model (e.g. when it takes a hit).
  flash(id: number): void {
    this.flashes.set(id, FLASH_DURATION);
  }

  // Project a world point to screen pixels (for DOM overlays like damage text).
  // `visible` is false when the point is behind the camera / outside the frustum.
  project(x: number, y: number, z: number): { x: number; y: number; visible: boolean } {
    this.projV.set(x, y, z).project(this.camera);
    return {
      x: (this.projV.x * 0.5 + 0.5) * window.innerWidth,
      y: (-this.projV.y * 0.5 + 0.5) * window.innerHeight,
      visible: this.projV.z > -1 && this.projV.z < 1,
    };
  }

  render(world: IWorld): void {
    const nowMs = performance.now(); // host clock — fine here, never in src/sim
    const dt = this.lastRenderMs ? Math.min(0.1, (nowMs - this.lastRenderMs) / 1000) : 0;
    this.lastRenderMs = nowMs;

    this.sync(world);
    this.applyFlashes(dt);
    this.updateCamera(world);
    this.gl.render(this.scene, this.camera);
  }

  private applyFlashes(dt: number): void {
    for (const [id, remaining] of this.flashes) {
      const m = this.meshes.get(id);
      const left = remaining - dt;
      if (!m || left <= 0) {
        if (m) setFlash(m, 0);
        this.flashes.delete(id);
        continue;
      }
      this.flashes.set(id, left);
      setFlash(m, left / FLASH_DURATION); // fade the white glow out
    }
  }

  private sync(world: IWorld): void {
    const seen = new Set<number>();
    const targetId = world.localTargetId();
    let targetView: EntityView | undefined;
    for (const e of world.entities()) {
      seen.add(e.id);
      let m = this.meshes.get(e.id);
      if (!m) {
        m = makeActor(e.kind, e.boss);
        m.userData.entityId = e.id; // so pick() can map a hit back to the entity
        this.scene.add(m);
        this.meshes.set(e.id, m);
      }
      m.position.set(e.x, 0, e.z);
      m.rotation.y = e.facing;
      updateGlow(m, e.weaponPlus);
      updateHostileTint(m, e);
      updateDeadFade(m, e);
      if (e.id === targetId) targetView = e;
    }
    for (const [id, m] of this.meshes) {
      if (!seen.has(id)) {
        this.scene.remove(m);
        this.meshes.delete(id);
      }
    }
    // Park the selection ring under the current target (if any).
    if (targetView) {
      this.selectionRing.position.set(targetView.x, 0.06, targetView.z);
      this.selectionRing.scale.setScalar(targetView.boss ? 1.9 : 1); // match the bigger boss
      this.selectionRing.visible = true;
    } else {
      this.selectionRing.visible = false;
    }
  }

  private updateCamera(world: IWorld): void {
    const id = world.localPlayerId();
    let px = 0;
    let pz = 0;
    if (id != null) {
      const p = world.entities().find((e) => e.id === id);
      if (p) {
        px = p.x;
        pz = p.z;
      }
    }
    const cy = Math.cos(this.camPitch);
    const sy = Math.sin(this.camPitch);
    this.camera.position.set(
      px + Math.sin(this.camYaw) * this.camDist * cy,
      1.5 + this.camDist * sy,
      pz + Math.cos(this.camYaw) * this.camDist * cy,
    );
    this.camera.lookAt(px, 1.2, pz);
  }

  private resize(): void {
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }
}

// A simple capsule-ish humanoid with a "nose" so facing is visible. A boss is
// drawn bigger and in a distinct menacing color so it reads as a boss.
function makeActor(kind: EntityKind, boss = false): THREE.Object3D {
  const bodyColor = boss ? 0xa030d0 : kind === 'player' ? 0x3b82f6 : 0xb23b3b;
  const g = new THREE.Group();
  const body = new THREE.Mesh(
    new THREE.CylinderGeometry(0.5, 0.5, 1.7, 12),
    new THREE.MeshStandardMaterial({ color: bodyColor }),
  );
  body.position.y = 0.85;
  const head = new THREE.Mesh(
    new THREE.SphereGeometry(0.36, 14, 10),
    new THREE.MeshStandardMaterial({ color: 0xf0d9b5 }),
  );
  head.position.y = 1.95;
  const nose = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.18, 0.5),
    new THREE.MeshStandardMaterial({ color: 0x1a1a1a }),
  );
  nose.position.set(0, 1.0, 0.55); // +Z is "forward" (matches facing math)
  g.add(body, head, nose);
  g.userData.body = body; // so the per-frame hostile tint can recolor it
  if (kind === 'player') {
    // Enhancement glow aura — hidden until the equipped weapon hits +3. A
    // MeshBasicMaterial (no emissive) so the hit-flash never touches it.
    const glow = new THREE.Mesh(
      new THREE.SphereGeometry(1.15, 16, 12),
      new THREE.MeshBasicMaterial({
        color: 0xffd86b,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      }),
    );
    glow.position.y = 1.0;
    glow.visible = false;
    g.userData.glow = glow;
    g.add(glow);
  }
  if (boss) g.scale.setScalar(1.9); // visibly larger than a common mob
  return g;
}

// Show/scale the enhancement glow by the equipped weapon's "+N": nothing below
// +3, then ramping in brightness/size up to +10. Presentation only.
function updateGlow(actor: THREE.Object3D, weaponPlus: number): void {
  const glow = actor.userData.glow as THREE.Mesh | undefined;
  if (!glow) return;
  if (weaponPlus < 3) {
    glow.visible = false;
    return;
  }
  const t = Math.min(1, (weaponPlus - 3) / 7); // 0 at +3 -> 1 at +10
  glow.visible = true;
  (glow.material as THREE.MeshBasicMaterial).opacity = 0.18 + 0.4 * t;
  glow.scale.setScalar(1 + 0.25 * t);
}

const ENEMY_COLOR = 0xb23b3b; // calm red (idle wolf)
const HOSTILE_COLOR = 0xff2a2a; // hotter red while aggroed on the player

// Tint a common enemy's body by whether it's currently hostile (chasing us), so
// you can see which wolves are on you. Recolors `color` (not emissive), so it
// never fights the white hit-flash. Boss/player are left to their own color.
function updateHostileTint(actor: THREE.Object3D, e: EntityView): void {
  if (e.kind !== 'enemy' || e.boss) return;
  const body = actor.userData.body as THREE.Mesh | undefined;
  if (!body) return;
  (body.material as THREE.MeshStandardMaterial).color.setHex(
    e.hostile ? HOSTILE_COLOR : ENEMY_COLOR,
  );
}

// Fade a downed player to a translucent "spirit". Only touches the body/head/
// nose (MeshStandardMaterial); the glow aura (MeshBasicMaterial) is left alone.
function updateDeadFade(actor: THREE.Object3D, e: EntityView): void {
  if (e.kind !== 'player') return;
  actor.traverse((o) => {
    const mat = (o as THREE.Mesh).material as THREE.MeshStandardMaterial | undefined;
    if (mat && mat.isMeshStandardMaterial) {
      mat.transparent = e.dead; // reset to opaque on revive (don't strand it in the transparent path)
      mat.opacity = e.dead ? 0.3 : 1;
    }
  });
}

// Flat ground ring used as the "selected target" marker (classic WoW/Silkroad
// look). Decorative only — never affects the sim.
function makeSelectionRing(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.7, 0.95, 36),
    new THREE.MeshBasicMaterial({
      color: 0xffe14d,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.9,
    }),
  );
  ring.rotation.x = -Math.PI / 2; // lay flat on the ground
  ring.position.y = 0.06; // just above the ground plane
  ring.visible = false;
  return ring;
}

// Drive an actor's white hit-flash by tinting its materials' emissive. intensity
// 0 restores the normal (unlit-emissive) look. Each actor owns its materials
// (see makeActor), so this never bleeds onto other entities.
function setFlash(group: THREE.Object3D, intensity: number): void {
  group.traverse((o) => {
    const mat = (o as THREE.Mesh).material;
    if (mat && !Array.isArray(mat) && (mat as THREE.MeshStandardMaterial).emissive) {
      const m = mat as THREE.MeshStandardMaterial;
      m.emissive.setRGB(1, 1, 1);
      m.emissiveIntensity = intensity;
    }
  });
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
