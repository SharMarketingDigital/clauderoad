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
  // Duel target SELECTION (render/UI state only). The sim's target is enemy-only (canAttack), so a
  // player can never be the sim target — instead we track the left-click-selected OTHER player here
  // and expose it to the duel HUD. `leftClickId` holds the most recent clean left-click (incl. null
  // for empty ground), resolved in apply() which has the world to classify what was clicked.
  private uiSelectedPlayerId: number | null = null;
  private leftClickId: number | null = null;
  private hasLeftClick = false;
  // TP3: one-shot — the id of a teleporter NPC just left-clicked, consumed by the teleporter HUD to
  // open its menu (cleared on read). Pure UI state; the sim ignores npc targets.
  private teleporterClick: number | null = null;
  // PK livre (GDD v0.5 §2): whether ALT is currently held (PK mode armed). Read from each event's
  // authoritative modifier state (e.altKey) — robust to a dropped keyup — and mirrored to the sim
  // edge-triggered in apply(). `pkSent` is the last value pushed, so we only send on a change.
  private altHeld = false;
  private pkSent = false;
  // GDD v0.5 (Pets): one-shot — the P key was pressed; apply() resolves it into a summon/dismiss against
  // the current pet state (world.petActive()), since the toggle's value depends on the world.
  private pendingPetToggle = false;

  constructor(canvas: HTMLCanvasElement, private renderer: Renderer) {
    window.addEventListener('keydown', (e) => {
      if (isTyping()) return; // chat (or any text field) has focus -> keys are for typing
      this.altHeld = e.altKey; // PK livre: track the held ALT modifier from the authoritative modifier state
      if (e.key === 'Tab') {
        e.preventDefault(); // don't move focus off the canvas
        if (!e.repeat) this.pending.push({ t: 'cycle-target' });
        return;
      }
      // G — grab ALL nearby ground loot at once (GDD v0.5 loot físico: the manual "pegar sozinho" when
      // there's no collection pet yet). One-shot; the sim validates range + bag-full per item.
      if (e.key.toLowerCase() === 'g') {
        if (!e.repeat) this.pending.push({ t: 'pickup-nearby' });
        return;
      }
      // P — summon/dismiss the pet (GDD v0.5 Pets). One-shot; apply() toggles vs world.petActive().
      if (e.key.toLowerCase() === 'p') {
        if (!e.repeat) this.pendingPetToggle = true;
        return;
      }
      // Action-bar slots 1..9 (top-row digits). The sim no-ops empty slots.
      if (e.key.length === 1 && e.key >= '1' && e.key <= '9') {
        if (!e.repeat) this.pending.push({ t: 'use-ability', slot: Number(e.key) });
        return;
      }
      this.keys.add(e.key.toLowerCase());
    });
    window.addEventListener('keyup', (e) => { this.altHeld = e.altKey; this.keys.delete(e.key.toLowerCase()); });

    canvas.addEventListener('mousedown', (e) => {
      this.altHeld = e.altKey; // PK livre: catch ALT+click even if the ALT keydown never reached us
      this.dragging = true;
      this.downButton = e.button;
      this.downX = e.clientX;
      this.downY = e.clientY;
      this.lastX = e.clientX;
      this.lastY = e.clientY;
      this.moved = false;
    });
    window.addEventListener('mouseup', (e) => {
      // mouseup is on window so a drag that releases off-canvas still ends; but a SELECT only
      // counts on a non-drag LEFT click released over the canvas itself (right-click is camera
      // orbit only now — the old right-click-to-duel was replaced by the floating "Duelar" button).
      const clicked = this.dragging && !this.moved && this.downButton === 0 && e.target === canvas;
      this.dragging = false;
      if (!clicked) return;
      // A clean left click: record what's under it (id, or null for empty ground) for apply() to
      // classify — an enemy still goes to the sim as a target; another player becomes the duel
      // selection; empty ground clears it. Same raycast the mob-targeting already uses.
      const id = this.renderer.pick(e.clientX, e.clientY);
      this.leftClickId = id;
      this.hasLeftClick = true;
      if (id != null) this.pending.push({ t: 'set-target', id }); // the sim keeps it only if it's an enemy
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
    // Suppress the browser context menu so a right-drag orbits the camera without the menu popping.
    canvas.addEventListener('contextmenu', (e) => e.preventDefault());
    // PK livre: ALT is an OS/browser modifier (Alt-Tab, menu activation) whose keyup can be swallowed on
    // focus loss — releasing PK on blur stops the player getting stuck flagged.
    window.addEventListener('blur', () => { this.altHeld = false; });
  }

  // The OTHER player currently selected for a duel (from a left click), or null. Pure client/UI
  // state the duel HUD reads to offer the "Duelar" button; it never reaches the sim.
  duelTargetId(): number | null {
    return this.uiSelectedPlayerId;
  }

  // GDD v0.5 (PK livre): whether the local player is holding ALT (PK mode armed). The renderer reads
  // this to recolor the cursor/target ring while PK is active — pure client feedback (the sim decides
  // eligibility). The HOST-side held state; the sim gets the edge-triggered set-pk in apply().
  pkHeld(): boolean {
    return this.altHeld;
  }

  // One-shot: true on the frame the player left-clicked a teleporter NPC (consumed by the teleporter
  // HUD to open its menu). Cleared on read, so one click opens the menu exactly once.
  takeTeleporterClick(): boolean {
    const hit = this.teleporterClick != null;
    this.teleporterClick = null;
    return hit;
  }

  // Push queued actions + the current movement intent into the world. Called
  // once per frame.
  apply(world: IWorld): void {
    // PK livre (GDD v0.5 §2): mirror the held ALT modifier to the sim, edge-triggered (only on change,
    // so we don't spam the wire each frame). Forced OFF while botting or typing — you only PK with your
    // hands on the controls. The sim still gates the actual eligibility (PK flag + both outside a city).
    const wantPk = this.altHeld && !world.botActive() && !isTyping();
    if (wantPk !== this.pkSent) {
      world.sendCommand({ t: 'set-pk', on: wantPk });
      this.pkSent = wantPk;
    }
    // Auto-play drives the player from the sim; ignore (and drop) manual input.
    if (world.botActive()) {
      this.pending.length = 0;
      this.hasLeftClick = false;
      this.uiSelectedPlayerId = null;
      this.teleporterClick = null;
      this.pendingPetToggle = false;
      return;
    }
    // While typing in the chat, the player must NOT move/act: drop queued actions,
    // forget held keys (so a key pressed before opening chat doesn't stick), and stop.
    if (isTyping()) {
      this.pending.length = 0;
      this.hasLeftClick = false;
      this.teleporterClick = null;
      this.pendingPetToggle = false;
      this.keys.clear();
      world.sendCommand({ t: 'stop' });
      return;
    }
    for (const cmd of this.pending) world.sendCommand(cmd);
    this.pending.length = 0;

    // Pets (GDD v0.5): the P key toggles summon/dismiss against the CURRENT state (read from the world),
    // so one key both summons and dismisses.
    if (this.pendingPetToggle) {
      this.pendingPetToggle = false;
      world.sendCommand({ t: 'set-pet', on: !world.petActive() });
    }

    // Resolve the duel SELECTION from the last clean left click — render/UI state only (the sim
    // won't hold a player as its target). Clicking another player selects them (the duel HUD then
    // offers the "Duelar" button); clicking an enemy, the NPC, yourself, or empty ground clears it.
    if (this.hasLeftClick) {
      this.hasLeftClick = false;
      const id = this.leftClickId;
      const me = world.localPlayerId();
      const e = id != null ? world.entities().find((en) => en.id === id) : undefined;
      this.uiSelectedPlayerId = e && e.kind === 'player' && e.id !== me ? e.id : null;
      // TP3: clicking a teleporter NPC opens its menu (the teleporter HUD consumes this one-shot).
      if (e && e.kind === 'npc' && e.species === 'teleporter') this.teleporterClick = e.id;
      // GDD v0.5 (loot físico): clicking a ground item picks it up — the sim validates range + it's loot (FFA).
      if (e && e.kind === 'loot') world.sendCommand({ t: 'pickup', lootId: e.id });
    }
    // Keep the selection truthful so the "Duelar" button never lingers: drop it once a duel is
    // active or the selected player is no longer present.
    if (this.uiSelectedPlayerId != null) {
      const sel = world.entities().find((en) => en.id === this.uiSelectedPlayerId);
      if (!sel || sel.kind !== 'player' || world.localDuel() != null) this.uiSelectedPlayerId = null;
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
