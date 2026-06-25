// Paper-doll 3D preview of the LOCAL player for the character/inventory panel ("I").
//
// Pure presentation: a tiny self-contained Three.js scene/canvas that HOSTS the world's own
// `PlayerAvatar` (so the body skin + weapons + Idle clip are exactly the player's real class — see
// class_models.ts) and lets the user spin it HORIZONTALLY by dragging. It renders ONLY while the
// panel is open (the Hud calls tick() each frame while open), so it costs nothing when closed.
//
// It reads NOTHING from the world directly — the Hud passes the local player's `mastery` into
// tick(), and the viewer rebuilds the avatar when the class changes (mirrors renderer.ts:257-262).
import * as THREE from 'three';
import { PlayerAvatar } from './player_avatar';
import type { MasteryId } from '../world_api';

const ROT_SENSITIVITY = 0.01; // radians of yaw per pixel dragged
const REDUCED_MOTION_POSE_SECS = 0.5; // advance the idle this far once, then hold (reduced motion)

export class CharacterViewer {
  readonly canvas: HTMLCanvasElement;
  private gl: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;

  private avatar: PlayerAvatar | null = null;
  private mastery: MasteryId | null = null; // the class currently shown; rebuild when it changes

  private lastMs = 0; // 0 == "first frame after (re)open" -> dt=0 (avoids an idle jump on reopen)
  private yaw = 0; // accumulated horizontal rotation applied to the avatar root
  private dragging = false;
  private lastX = 0;
  private reduceMotion = false;
  private posed = false; // reduced-motion: idle already advanced to a representative pose

  constructor() {
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'char-canvas';
    this.gl = new THREE.WebGLRenderer({
      canvas: this.canvas,
      antialias: true,
      alpha: true, // transparent over the panel background
      powerPreference: 'low-power',
    });
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));

    this.camera = new THREE.PerspectiveCamera(35, 1, 0.1, 100);
    this.camera.position.set(0, 1.05, 3.4);
    this.camera.lookAt(0, 1.0, 0);

    // Simple fixed lighting (NOT the world's day/night environment — overkill for a preview).
    const key = new THREE.DirectionalLight(0xffffff, 2.2);
    key.position.set(2.5, 4, 3);
    this.scene.add(key);
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x23232b, 1.1));

    // Horizontal-only rotation by drag (custom — NOT OrbitControls, which would also zoom/pitch/pan).
    this.canvas.style.cursor = 'grab';
    this.canvas.addEventListener('pointerdown', (e) => {
      this.dragging = true;
      this.lastX = e.clientX;
      this.canvas.style.cursor = 'grabbing';
      try { this.canvas.setPointerCapture(e.pointerId); } catch { /* ignore */ }
    });
    this.canvas.addEventListener('pointermove', (e) => {
      if (!this.dragging) return;
      this.yaw += (e.clientX - this.lastX) * ROT_SENSITIVITY; // dx only — vertical is ignored
      this.lastX = e.clientX;
    });
    const endDrag = (e: PointerEvent): void => {
      this.dragging = false;
      this.canvas.style.cursor = 'grab';
      try { this.canvas.releasePointerCapture(e.pointerId); } catch { /* ignore */ }
    };
    this.canvas.addEventListener('pointerup', endDrag);
    this.canvas.addEventListener('pointercancel', endDrag);

    // Long-lived context: keep it on loss so a backgrounded GPU doesn't permanently black the canvas.
    this.canvas.addEventListener('webglcontextlost', (e) => e.preventDefault());

    // Respect reduced-motion: freeze the idle on a natural pose (drag still works — user-initiated).
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    this.reduceMotion = mq.matches;
    mq.addEventListener('change', (e) => { this.reduceMotion = e.matches; this.posed = false; });

    // Size from the canvas's OWN box (it is display:none while closed -> measure on open + on resize).
    new ResizeObserver(() => this.resize()).observe(this.canvas);
  }

  private resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.gl.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // The Hud calls this when the panel opens/closes, so the gated tick() resets cleanly (no dt jump
  // on reopen) and the canvas re-measures now that it is visible.
  setActive(active: boolean): void {
    this.lastMs = 0;
    if (active) this.resize();
  }

  // Drive ONE frame. Call only while the panel is open. `mastery` is the local player's class.
  tick(mastery: MasteryId): void {
    // (Re)build the avatar when the class changes — mirrors renderer.ts:257-262.
    if (this.mastery !== mastery) {
      this.mastery = mastery;
      this.posed = false;
      if (this.avatar) {
        this.scene.remove(this.avatar.root);
        this.avatar.dispose();
      }
      this.avatar = new PlayerAvatar(mastery);
      this.scene.add(this.avatar.root);
    }
    const av = this.avatar;
    if (!av) return;

    const now = performance.now();
    const dt = this.lastMs ? Math.min(0.1, (now - this.lastMs) / 1000) : 0;
    this.lastMs = now;

    av.root.rotation.y = this.yaw; // user drag — applied even under reduced motion

    if (av.ready) {
      if (this.reduceMotion) {
        if (!this.posed) { av.update(REDUCED_MOTION_POSE_SECS, false); this.posed = true; } // one step, then hold
      } else {
        av.update(dt, false); // idle (never "moving") — plays Idle_A in a loop
      }
    }
    this.gl.render(this.scene, this.camera); // always render so a drag repaints even when idle is frozen
  }
}
