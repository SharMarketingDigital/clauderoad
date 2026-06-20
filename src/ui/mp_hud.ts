// Minimal multiplayer HUD (presentation only): a connection-status line + a floating
// name tag above each player. Reads IWorld + the renderer's project(); it has no idea
// about the network, so it stays a pure consumer. Self-contained styles (injected).
import type { IWorld } from '../world_api';
import type { Renderer } from '../render/renderer';

const NAME_Y = 2.4; // world height above a player's feet to anchor the tag (flat-ground approx)

export class MpHud {
  private statusEl: HTMLDivElement;
  private tagLayer: HTMLDivElement;
  private tags = new Map<number, HTMLDivElement>();

  constructor() {
    injectStyle();
    this.statusEl = document.createElement('div');
    this.statusEl.className = 'mp-status';
    this.tagLayer = document.createElement('div');
    this.tagLayer.className = 'mp-taglayer';
    document.body.append(this.statusEl, this.tagLayer);
  }

  update(world: IWorld, renderer: Renderer, status: string, playerCount: number): void {
    this.statusEl.textContent = `Multiplayer — ${status} · ${playerCount} jogador(es)`;

    const localId = world.localPlayerId();
    const seen = new Set<number>();
    for (const e of world.entities()) {
      if (e.kind !== 'player') continue;
      seen.add(e.id);
      let tag = this.tags.get(e.id);
      if (!tag) {
        tag = document.createElement('div');
        tag.className = 'mp-name';
        this.tagLayer.appendChild(tag);
        this.tags.set(e.id, tag);
      }
      const isMe = e.id === localId;
      tag.textContent = isMe ? `${e.name} (você)` : e.name;
      tag.classList.toggle('me', isMe);
      const p = renderer.project(e.x, NAME_Y, e.z);
      if (p.visible) {
        tag.style.display = 'block';
        tag.style.left = `${p.x}px`;
        tag.style.top = `${p.y}px`;
      } else {
        tag.style.display = 'none';
      }
    }
    // drop tags for players who left
    for (const [id, tag] of this.tags) {
      if (!seen.has(id)) {
        tag.remove();
        this.tags.delete(id);
      }
    }
  }
}

function injectStyle(): void {
  if (document.getElementById('mp-hud-style')) return;
  const s = document.createElement('style');
  s.id = 'mp-hud-style';
  s.textContent = `
    .mp-status { position: fixed; top: 12px; left: 16px; z-index: 40; padding: 5px 12px;
      font: 600 13px/1 system-ui, sans-serif; color: #cfe0ff; background: rgba(20,26,36,0.8);
      border: 1px solid rgba(120,160,220,0.5); border-radius: 6px; pointer-events: none; }
    .mp-taglayer { position: fixed; inset: 0; z-index: 39; pointer-events: none; overflow: hidden; }
    .mp-name { position: absolute; transform: translate(-50%, -100%); white-space: nowrap;
      padding: 1px 7px; font: 600 12px/1.4 system-ui, sans-serif; color: #eaf1ff;
      background: rgba(12,16,22,0.7); border: 1px solid rgba(150,170,200,0.5); border-radius: 8px;
      text-shadow: 0 1px 2px #000; }
    .mp-name.me { color: #ffe9a8; border-color: rgba(242,196,74,0.7); }
  `;
  document.head.appendChild(s);
}
