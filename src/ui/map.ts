// World map (presentation only) — opened with M. Draws the zone rings (the central safe
// Vila Central + the concentric level 1/2/4/10 rings, as nested squares, since the zones
// are Chebyshev bands) and the local player's live position dot.
//
// It reads ONLY the IWorld seam for the player's position, so it works identically in
// single-player (the local Sim) and multiplayer (the networked ClientWorld). The ring
// geometry comes from the sim's zone DATA (ZONES / WORLD_HALF) — the same source the sim
// spawns from, so the map can never drift out of sync with the world. Toggled with M and
// guarded by isTyping() so the key never fires while typing in chat.
import type { IWorld } from '../world_api';
import { ZONES, WORLD_HALF, SAFE_CITIES, zoneAt } from '../sim/zones';
import { isTyping } from './typing';
import { registerOverlay } from './overlays';

const MAP_PX = 360; // the square map is this many px on a side (represents the whole world)

// Map a world position to map-area pixels (top-left origin). +x = east (right), +z = north
// (up). Pure, so the core math is unit-tested without a DOM.
export function worldToMapPx(
  x: number, z: number, mapPx: number, worldHalf: number,
): { left: number; top: number } {
  const left = ((x + worldHalf) / (2 * worldHalf)) * mapPx;
  const top = ((worldHalf - z) / (2 * worldHalf)) * mapPx;
  return { left, top };
}

export class WorldMap {
  private root: HTMLDivElement;
  private area: HTMLDivElement; // the square that holds the rings + the player dot
  private dot: HTMLDivElement; // the local player's marker
  private coords: HTMLDivElement; // "Posição: x, z · Zona: ..."
  private visible = false; // closed by default; M opens it

  constructor() {
    injectStyle();
    this.root = el('wm');
    this.root.style.display = 'none';

    const header = el('wm-header');
    header.append(span('wm-title', 'Mapa do Mundo'), span('wm-close', 'M / Esc fecha'));

    this.area = el('wm-area');
    this.area.style.width = `${MAP_PX}px`;
    this.area.style.height = `${MAP_PX}px`;
    this.buildRings();

    this.dot = el('wm-dot'); // appended LAST so it paints above every ring
    this.area.appendChild(this.dot);

    this.coords = el('wm-coords');
    this.root.append(header, this.area, this.coords);
    document.body.appendChild(this.root);

    // M toggles the map; Esc closes it. Guarded by isTyping() so neither fires while
    // typing in chat (offline there are no text fields, so M always works).
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (isTyping()) return;
      if (e.key === 'Escape') { if (this.visible) this.setVisible(false); return; }
      if (e.key.toLowerCase() === 'm') this.setVisible(!this.visible);
    });
    // ESC priority (overlays registry): the settings menu only opens when no window is up.
    registerOverlay(() => this.visible);
  }

  private setVisible(open: boolean): void {
    this.visible = open;
    this.root.style.display = open ? 'flex' : 'none';
  }

  // One nested square per zone, drawn largest-first so the inner rings paint on top (each
  // ring's visible band is the part its inner neighbour doesn't cover). Built once.
  private buildRings(): void {
    const ordered = [...ZONES].sort((a, b) => b.outer - a.outer); // outermost first
    for (const z of ordered) {
      const sq = el('wm-ring');
      const sizePx = (z.outer / WORLD_HALF) * MAP_PX;
      sq.style.width = `${sizePx}px`;
      sq.style.height = `${sizePx}px`;
      sq.style.background = ringColor(z.level, z.safe);
      sq.appendChild(span('wm-ring-label', z.safe ? z.name : `${z.name} · Nv ${z.level}`));
      this.area.appendChild(sq);
    }
    // Extra safe cities (off-origin, e.g. Vila do Leste) aren't concentric rings, so draw each as
    // its own small safe-coloured square at its projected map position.
    for (const c of SAFE_CITIES) {
      const sq = el('wm-city');
      const sizePx = ((c.half * 2) / (2 * WORLD_HALF)) * MAP_PX;
      const { left, top } = worldToMapPx(c.cx, c.cz, MAP_PX, WORLD_HALF);
      sq.style.width = `${sizePx}px`;
      sq.style.height = `${sizePx}px`;
      sq.style.left = `${left}px`;
      sq.style.top = `${top}px`;
      sq.appendChild(span('wm-ring-label', c.name));
      this.area.appendChild(sq);
    }
  }

  // Move the player dot to the live position; only touches the DOM while the map is open.
  update(world: IWorld): void {
    if (!this.visible) return;
    const id = world.localPlayerId();
    const me = id != null ? world.entities().find((e) => e.id === id) : undefined;
    if (!me) {
      this.dot.style.display = 'none';
      this.coords.textContent = 'Aguardando o jogador…';
      return;
    }
    this.dot.style.display = 'block';
    const { left, top } = worldToMapPx(me.x, me.z, MAP_PX, WORLD_HALF);
    this.dot.style.left = `${left}px`;
    this.dot.style.top = `${top}px`;
    const zone = zoneAt(me.x, me.z);
    const where = zone.safe ? `${zone.name} (segura)` : `${zone.name} · Nv ${zone.level}`;
    this.coords.textContent = `Posição: ${Math.round(me.x)}, ${Math.round(me.z)} · Zona: ${where}`;
  }
}

// Ring fill by level: a calm town, then green -> olive -> orange -> red as it gets deadlier.
function ringColor(level: number, safe: boolean): string {
  if (safe) return '#1f3a4d'; // Vila Central — calm blue-grey
  switch (level) {
    case 1: return '#2e5a2c'; // Campina — green
    case 2: return '#5c5a24'; // Bosque — olive
    case 4: return '#7a4a1c'; // Terras Selvagens — orange-brown
    case 10: return '#6e2020'; // Ermo Profundo — red
    default: return '#3a3a3a';
  }
}

function el(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}
function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text; // textContent, never innerHTML
  return s;
}

function injectStyle(): void {
  if (document.getElementById('wm-style')) return;
  const s = document.createElement('style');
  s.id = 'wm-style';
  s.textContent = `
    /* No giant panel around the map — just the minimap itself, centered (caveat #3). */
    .wm { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 45;
      pointer-events: auto; display: flex; flex-direction: column; align-items: center; gap: 10px;
      font-family: system-ui, sans-serif; color: #eaf1ff; }
    .wm-header { display: flex; align-items: baseline; justify-content: center; gap: 14px; }
    .wm-title { font: 800 15px/1.1 system-ui, sans-serif; color: #f4e8c8; text-shadow: 0 1px 0 #000, 0 0 12px var(--glow); }
    .wm-close { font: 600 11px/1 system-ui, sans-serif; color: #8294ad; }
    .wm-area { position: relative; align-self: center; border: 2px solid transparent; border-radius: 8px; overflow: hidden;
      background: #0a0d12 padding-box, var(--edge-grad) border-box;
      box-shadow: 0 12px 40px -10px rgba(0,0,0,0.7), 0 0 24px -10px var(--glow); }
    .wm-ring { position: absolute; left: 50%; top: 50%; transform: translate(-50%, -50%);
      border: 1px solid rgba(0,0,0,0.5); border-radius: 3px; }
    .wm-city { position: absolute; transform: translate(-50%, -50%); background: #1f3a4d;
      border: 1px solid rgba(120,160,220,0.6); border-radius: 3px; }
    .wm-ring-label { position: absolute; top: 3px; left: 50%; transform: translateX(-50%);
      font: 700 10px/1 system-ui, sans-serif; color: rgba(255,255,255,0.92); white-space: nowrap;
      text-shadow: 0 1px 2px #000; pointer-events: none; }
    .wm-dot { position: absolute; width: 11px; height: 11px; transform: translate(-50%, -50%);
      background: #ffd24a; border: 2px solid #14181f; border-radius: 50%;
      box-shadow: 0 0 6px rgba(255,210,74,0.9); z-index: 10; }
    .wm-coords { font: 600 12px/1.3 system-ui, sans-serif; color: #9fb2cc; text-align: center; }
  `;
  document.head.appendChild(s);
}
