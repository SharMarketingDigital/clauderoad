// Local input: keyboard movement + mouse-orbit camera. Translates raw input
// into Commands and streams them into the world. (Online, the same Commands
// will be sent to the server instead of a local Sim — no change needed here.)
import type { IWorld, Command } from '../world_api';
import type { Renderer } from '../render/renderer';
import { isTyping } from '../ui/typing';

export class Input {
  private keys = new Set<string>();
  private dragging = false;
  private lastX = 0;
  private lastY = 0;
  // mouse-press tracking, to tell a click (select) apart from a drag (orbit)
  private downX = 0;
  private downY = 0;
  private downButton = 0;
  private moved = false;
  // one-shot commands (Tab, click-to-target) queued by event handlers and
  // flushed to the world once per frame in apply().
  private pending: Command[] = [];
  // A right-clicked entity id awaiting a duel challenge — resolved to a player NAME in apply()
  // (which has the world to look the name up). Null when there's nothing pending.
  private pendingChallengeId: number | null = null;

  constructor(canvas: HTMLCanvasElement, private renderer: Renderer) {
    window.addEventListener('keydown', (e) => {
      if (isTyping()) return; // chat (or any text field) has focus -> keys are for typing
      if (e.key === 'Tab') {
        e.preventDefault(); // don't move focus off the canvas
        if (!e.repeat) this.pending.push({ t: 'cycle-target' });
        return;
      }
      // Action-bar slots 1..9 (top-row digits). The sim no-ops empty slots.
      if (e.key.length === 1 && e.key >= '1' && e.key <= '9') {
        if (!e.repeat) this.pending.push({ t: 'use-ability', slot: Number(e.key) });
        return;
      }
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.key.toLowerCase()));

    canvas.addEventListener('mousedown', (e) => {
      this.dragging = true;
      this.downButton = e.button;
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.moved = false;
    });
    window.addEventListener('mouseup', (e) => {
      // mouseup is on window so a drag that releases off-canvas still ends; but
      // a SELECT only counts when the release is over the canvas itself (so a
      // future interactive HUD element can't be click-through-selected).
      const clicked = this.dragging && !this.moved && e.target === canvas;
      const button = this.downButton;
      this.dragging = false;
      if (!clicked) return;
      const id = this.renderer.pick(e.clientX, e.clientY);
      if (id == null) return;
      // Left click selects whatever is under it (the sim only keeps an enemy). Right click
      // challenges a player to a duel — resolved to its name in apply().
      if (button === 0) this.pending.push({ t: 'set-target', id });
      else if (button === 2) this.pendingChallengeId = id;
    });
    window.addEventListener('mousemove', (e) => {
      if (!this.dragging) return;
      this.renderer.orbit((e.clientX - this.lastX) * 0.005, (e.clientY - this.lastY) * 0.005);
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      if (Math.hypot(e.clientX - this.downX, e.clientY - this.downY) > 5) this.moved = true;
    });
    canvas.addEventListener(
      'wheel',
      (e) => {
        e.preventDefault();
        this.renderer.zoom(e.deltaY * 0.01);
      },
      { passive: false },
    );
    // Suppress the browser context menu so right-click is free for the duel challenge.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  // Push queued actions + the current movement intent into the world. Called
  // once per frame.
  apply(world: IWorld): void {
    // Auto-play drives the player from the sim; ignore (and drop) manual input.
    if (world.botActive()) {
      this.pending.length = 0;
      this.pendingChallengeId = null;
      return;
    }
    // While typing in the chat, the player must NOT move/act: drop queued actions,
    // forget held keys (so a key pressed before opening chat doesn't stick), and stop.
    if (isTyping()) {
      this.pending.length = 0;
      this.pendingChallengeId = null;
      this.keys.clear();
      world.sendCommand({ t: 'stop' });
      return;
    }
    for (const cmd of this.pending) world.sendCommand(cmd);
    this.pending.length = 0;

    // Resolve a pending right-click duel challenge: look the picked entity up and, if it's another
    // player, send a duel-challenge by name (the sim/server validate it; a non-player is ignored).
    if (this.pendingChallengeId != null) {
      const tid = this.pendingChallengeId;
      this.pendingChallengeId = null;
      const me = world.localPlayerId();
      const t = world.entities().find((en) => en.id === tid);
      if (t && t.kind === 'player' && t.id !== me) world.sendCommand({ t: 'duel-challenge', name: t.name });
    }

    let fwd = 0;
    let right = 0;
    if (this.keys.has('w')) fwd += 1;
    if (this.keys.has('s')) fwd -= 1;
    if (this.keys.has('d')) right += 1;
    if (this.keys.has('a')) right -= 1;

    if (fwd === 0 && right === 0) {
      world.sendCommand({ t: 'stop' });
      return;
    }

    // Move relative to the camera: "W" is away from the camera.
    const yaw = this.renderer.yaw;
    const fwdX = -Math.sin(yaw);
    const fwdZ = -Math.cos(yaw);
    const rightX = Math.cos(yaw);
    const rightZ = -Math.sin(yaw);
    world.sendCommand({
      t: 'move',
      dx: fwdX * fwd + rightX * right,
      dz: fwdZ * fwd + rightZ * right,
    });
  }
}
