// Multiplayer HUD (presentation only): a connection-status line, a transient announce
// banner, and a floating tag — NAME + HP BAR — above every player and mob. It reads
// only IWorld + the renderer's project(), so it's a pure consumer with no idea about
// the network. The HP bars come straight from the authoritative snapshot, so both
// clients see the SAME mob health, and the selected target is highlighted.
import type { IWorld } from '../world_api';
import type { Renderer } from '../render/renderer';
import type { Announcer } from './combat_feedback';

const TAG_Y = 2.4; // world height above an entity's feet to anchor its tag (flat-ground approx)

interface Tag {
  root: HTMLDivElement;
  name: HTMLDivElement;
  hp: HTMLDivElement; // the fill element (width = hp%)
  hpWrap: HTMLDivElement;
}

export class MpHud implements Announcer {
  private statusEl: HTMLDivElement;
  private announceEl: HTMLDivElement;
  private tagLayer: HTMLDivElement;
  private tags = new Map<number, Tag>();
  private announceTimer: ReturnType<typeof setTimeout> | null = null;

  constructor() {
    injectStyle();
    this.statusEl = el('mp-status');
    this.announceEl = el('mp-announce');
    this.tagLayer = el('mp-taglayer');
    document.body.append(this.statusEl, this.announceEl, this.tagLayer);
  }

  // A boss spawn / death / respawn banner (combat feedback calls this). Auto-hides.
  announce(text: string): void {
    this.announceEl.textContent = text;
    this.announceEl.style.display = 'block';
    if (this.announceTimer) clearTimeout(this.announceTimer);
    this.announceTimer = setTimeout(() => { this.announceEl.style.display = 'none'; }, 3500);
  }

  update(world: IWorld, renderer: Renderer, status: string, playerCount: number): void {
    this.statusEl.textContent = `Multiplayer — ${status} · ${playerCount} jogador(es)`;

    const localId = world.localPlayerId();
    const targetId = world.localTargetId();
    const seen = new Set<number>();
    for (const e of world.entities()) {
      if (e.kind === 'npc' && e.id !== targetId) {
        // a plain label for the town NPC (no HP bar)
      } else if (e.kind !== 'player' && e.kind !== 'enemy' && e.kind !== 'npc') {
        continue;
      }
      seen.add(e.id);
      const tag = this.tagFor(e.id);

      const isMe = e.id === localId;
      const isEnemy = e.kind === 'enemy';
      const isTarget = e.id === targetId;
      tag.name.textContent = isMe ? `${e.name} (você)` : e.name;
      tag.root.classList.toggle('me', isMe);
      tag.root.classList.toggle('enemy', isEnemy);
      tag.root.classList.toggle('hostile', isEnemy && e.hostile);
      tag.root.classList.toggle('target', isTarget);
      tag.root.classList.toggle('dead', e.dead);

      // HP bar for combatants (players + mobs); hidden for the non-combat NPC.
      const showHp = (e.kind === 'player' || e.kind === 'enemy') && e.maxHp > 0;
      tag.hpWrap.style.display = showHp ? 'block' : 'none';
      if (showHp) tag.hp.style.width = `${Math.max(0, Math.min(100, (e.hp / e.maxHp) * 100))}%`;

      const p = renderer.project(e.x, TAG_Y, e.z);
      if (p.visible) {
        tag.root.style.display = 'block';
        tag.root.style.left = `${p.x}px`;
        tag.root.style.top = `${p.y}px`;
      } else {
        tag.root.style.display = 'none';
      }
    }
    // drop tags for entities that left / died off
    for (const [id, tag] of this.tags) {
      if (!seen.has(id)) {
        tag.root.remove();
        this.tags.delete(id);
      }
    }
  }

  private tagFor(id: number): Tag {
    let tag = this.tags.get(id);
    if (!tag) {
      const root = el('mp-tag');
      const name = el('mp-tag-name');
      const hpWrap = el('mp-tag-hp');
      const hp = el('mp-tag-hp-fill');
      hpWrap.appendChild(hp);
      root.append(name, hpWrap);
      this.tagLayer.appendChild(root);
      tag = { root, name, hp, hpWrap };
      this.tags.set(id, tag);
    }
    return tag;
  }
}

function el(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}

function injectStyle(): void {
  if (document.getElementById('mp-hud-style')) return;
  const s = document.createElement('style');
  s.id = 'mp-hud-style';
  s.textContent = `
    .mp-status { position: fixed; top: 12px; left: 16px; z-index: 40; padding: 5px 12px;
      font: 600 13px/1 system-ui, sans-serif; color: #cfe0ff; background: rgba(20,26,36,0.8);
      border: 1px solid rgba(120,160,220,0.5); border-radius: 6px; pointer-events: none; }
    .mp-announce { position: fixed; top: 64px; left: 50%; transform: translateX(-50%); z-index: 41;
      display: none; padding: 7px 18px; font: 700 16px/1 system-ui, sans-serif; color: #ffe9a8;
      background: rgba(20,26,36,0.85); border: 1px solid rgba(242,196,74,0.7); border-radius: 8px;
      text-shadow: 0 1px 3px #000; pointer-events: none; }
    .mp-taglayer { position: fixed; inset: 0; z-index: 39; pointer-events: none; overflow: hidden; }
    .mp-tag { position: absolute; transform: translate(-50%, -100%); white-space: nowrap;
      display: flex; flex-direction: column; align-items: center; gap: 2px; }
    .mp-tag-name { padding: 1px 7px; font: 600 12px/1.4 system-ui, sans-serif; color: #eaf1ff;
      background: rgba(12,16,22,0.7); border: 1px solid rgba(150,170,200,0.5); border-radius: 8px;
      text-shadow: 0 1px 2px #000; }
    .mp-tag.me .mp-tag-name { color: #ffe9a8; border-color: rgba(242,196,74,0.7); }
    .mp-tag.enemy .mp-tag-name { color: #ffd0d0; border-color: rgba(200,120,120,0.55); }
    .mp-tag.target .mp-tag-name { border-color: #ffe9a8; box-shadow: 0 0 0 1px #ffe9a8; }
    .mp-tag.dead { opacity: 0.45; }
    .mp-tag-hp { width: 46px; height: 4px; background: rgba(0,0,0,0.6); border: 1px solid rgba(0,0,0,0.5);
      border-radius: 3px; overflow: hidden; }
    .mp-tag-hp-fill { height: 100%; width: 100%; background: #4caf50; transition: width 0.1s linear; }
    .mp-tag.enemy .mp-tag-hp-fill { background: #d05050; }
    .mp-tag.hostile .mp-tag-hp-fill { background: #ff5a4d; }
  `;
  document.head.appendChild(s);
}
