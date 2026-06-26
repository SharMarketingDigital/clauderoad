// Central game menu (tecla Esc) — Silkroad-style: a dimmed scrim + a centered list of EVERY UI
// panel with its keyboard shortcut right-aligned. It opens on Esc ONLY when no other window is up
// (it consults the shared overlay registry in the CAPTURE phase, before the panels' bubble-phase
// Esc-closers), so an open panel's Esc still closes THAT panel and this menu stays out of the way.
//
// Each row simply re-fires the panel's REAL hotkey (a synthetic keydown) after closing — so this
// menu needs NO references to the panels; they keep owning their own keys (the menu is a launcher,
// not a controller). "Configurações" fires Backspace (the settings menu's new key); "Sair" reloads
// to the start screen. The old ESC-opened settings menu now lives behind "Configurações".
import { registerOverlay, anyOverlayOpen } from './overlays';
import { isTyping } from './typing';
import { decoratePanel } from './theme';

interface MenuEntry {
  label: string;
  shortcut: string; // shown right-aligned
  run: () => void; // action when the row is clicked / activated
}

export class EscMenu {
  private readonly root: HTMLDivElement;
  private open = false;

  constructor() {
    injectStyle();

    // ALL panels, with the project's REAL shortcuts (Silkroad-inspired, adapted). Clicking a row
    // closes the menu and re-fires that panel's hotkey, so its own listener opens it. Party rows
    // (P/E) only do something in multiplayer (the party panels register their keys there) — they
    // are harmless no-ops in single-player.
    const entries: MenuEntry[] = [
      { label: 'Voltar', shortcut: 'Esc', run: () => this.setOpen(false) },
      { label: 'Inventário', shortcut: 'I', run: () => this.fireKey('i') },
      { label: 'Personagem', shortcut: 'C', run: () => this.fireKey('c') },
      { label: 'Habilidades', shortcut: 'K', run: () => this.fireKey('k') },
      { label: 'Alquimia', shortcut: 'L', run: () => this.fireKey('l') },
      { label: 'Loja', shortcut: 'V', run: () => this.fireKey('v') },
      { label: 'Armazém', shortcut: 'H', run: () => this.fireKey('h') },
      { label: 'Mapa', shortcut: 'M', run: () => this.fireKey('m') },
      { label: 'Grupo', shortcut: 'P', run: () => this.fireKey('p') },
      { label: 'Encontrar Grupo', shortcut: 'E', run: () => this.fireKey('e') },
      { label: 'Auto-play', shortcut: 'B', run: () => this.fireKey('b') },
      { label: 'Configurações', shortcut: 'Backspace', run: () => this.fireKey('Backspace') },
      { label: 'Sair', shortcut: 'Ctrl/Cmd + Esc', run: () => this.quit() },
    ];

    this.root = this.build(entries);
    document.body.appendChild(this.root);

    registerOverlay(() => this.open);

    // Capture phase: decide BEFORE the bubble-phase Esc-closers of the individual panels.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.key !== 'Escape' || e.repeat) return;
        if (this.open) { this.setOpen(false); e.stopPropagation(); e.preventDefault(); return; }
        if (isTyping()) return; // typing in chat -> the input's own Esc handles it
        if (anyOverlayOpen()) return; // a panel is up -> let ITS Esc close it; the menu stays closed
        this.setOpen(true); e.stopPropagation(); e.preventDefault();
      },
      { capture: true },
    );

    // Click on the scrim (but not the panel) closes the menu.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.setOpen(false);
    });
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.root.style.display = open ? 'grid' : 'none';
  }

  // Close the menu, then re-fire a panel's REAL hotkey so its own listener toggles it open.
  private fireKey(key: string): void {
    this.setOpen(false);
    window.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true }));
  }

  private quit(): void {
    this.setOpen(false);
    if (window.confirm('Sair do jogo? Voltará à tela inicial (progresso não salvo é perdido).')) {
      window.location.reload();
    }
  }

  private build(entries: MenuEntry[]): HTMLDivElement {
    const root = el('esc');
    const panel = el('esc-panel');
    panel.append(span('esc-title', 'Menu'));
    for (const entry of entries) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = entry.label === 'Sair' ? 'esc-row esc-row-quit' : 'esc-row';
      b.append(span('esc-label', entry.label), span('esc-key', entry.shortcut));
      b.addEventListener('click', () => entry.run());
      panel.append(b);
    }
    decoratePanel(panel); // medieval stone frame around the central menu
    root.append(panel);
    root.style.display = 'none';
    return root;
  }
}

// --- tiny DOM helpers (textContent only, never innerHTML) ---
function el(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}
function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  return s;
}

function injectStyle(): void {
  if (document.getElementById('esc-style')) return;
  const s = document.createElement('style');
  s.id = 'esc-style';
  s.textContent = `
    .esc { position: fixed; inset: 0; z-index: 80; display: none; place-items: center;
      background: rgba(6,9,14,0.78); backdrop-filter: blur(3px); font-family: system-ui, sans-serif; }
    .esc-panel { display: flex; flex-direction: column; gap: 2px; min-width: min(360px, 92vw);
      padding: 18px 16px; background: rgba(14,19,28,0.98); border: 1px solid rgba(120,160,220,0.5);
      border-radius: 14px; box-shadow: 0 14px 50px rgba(0,0,0,0.6); }
    .esc-title { font: 800 20px/1.1 system-ui, sans-serif; color: #ffd24a; text-align: center;
      margin-bottom: 10px; }
    .esc-row { display: flex; align-items: center; justify-content: space-between; gap: 24px;
      width: 100%; padding: 9px 12px; cursor: pointer; background: transparent; border: 0;
      border-radius: 8px; color: #eaf1ff; font: 600 15px/1.2 system-ui, sans-serif; text-align: left;
      transition: background 0.1s; }
    .esc-row:hover, .esc-row:focus-visible { background: rgba(120,160,220,0.16); outline: none; }
    .esc-key { color: #8aa0bd; font: 700 12px/1 ui-monospace, monospace; letter-spacing: 0.04em;
      padding: 3px 8px; background: rgba(34,44,60,0.9); border: 1px solid rgba(120,160,220,0.3);
      border-radius: 6px; white-space: nowrap; }
    .esc-row-quit { margin-top: 8px; color: #ff9a8a; }
    .esc-row-quit:hover, .esc-row-quit:focus-visible { background: rgba(160,60,50,0.22); }
  `;
  document.head.appendChild(s);
}
