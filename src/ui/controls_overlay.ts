// Controls reference (tecla ?) — a grouped cheat-sheet of EVERY key, since the game has ~18 controls
// but only a handful were ever shown. Opens on "?", from the Esc menu's "Controles" row, and AUTO-SHOWS
// once on a player's first session (so a newcomer learns PK/pet/loot/duel/teleport — mechanics nothing
// else surfaces). Pure UI: a dimmed scrim + a panel; Esc/?/click-scrim closes. Never touches the sim.
import { registerOverlay, anyOverlayOpen } from './overlays';
import { isTyping } from './typing';
import { decoratePanel } from './theme';

const SEEN_KEY = 'claroad.controls.seen';

interface KeyRow {
  key: string;
  label: string;
}
interface KeyGroup {
  title: string;
  rows: KeyRow[];
}

const GROUPS: KeyGroup[] = [
  {
    title: 'Movimento & Combate',
    rows: [
      { key: 'W A S D', label: 'Mover' },
      { key: 'Tab / Clique', label: 'Mirar um alvo' },
      { key: '1 – 9', label: 'Usar habilidades' },
      { key: 'G', label: 'Pegar loot do chão' },
      { key: 'Segurar ALT', label: 'PK livre — atacar jogadores (fora da cidade)' },
    ],
  },
  {
    title: 'Painéis',
    rows: [
      { key: 'I', label: 'Bolsa' },
      { key: 'C', label: 'Personagem' },
      { key: 'K', label: 'Habilidades' },
      { key: 'L', label: 'Alquimia' },
      { key: 'V', label: 'Loja' },
      { key: 'H', label: 'Armazém' },
      { key: 'M', label: 'Mapa' },
      { key: 'J', label: 'Mercado global' },
      { key: 'N', label: 'Minha barraca' },
      { key: 'O', label: 'Mochila do pet' },
    ],
  },
  {
    title: 'Social & PvP',
    rows: [
      { key: 'P', label: 'Grupo' },
      { key: 'E', label: 'Encontrar grupo' },
      { key: 'Clicar jogador', label: 'Desafiar para duelo' },
      { key: 'Enter', label: 'Chat (/p grupo · /g guilda)' },
    ],
  },
  {
    title: 'Pet & Viagem',
    rows: [
      { key: 'F', label: 'Invocar / dispensar o pet' },
      { key: 'Clicar teleportador', label: 'Viajar entre cidades' },
    ],
  },
  {
    title: 'Sistema',
    rows: [
      { key: 'B', label: 'Auto-play (bot)' },
      { key: 'Backspace', label: 'Configurações' },
      { key: 'Esc', label: 'Menu' },
      { key: '?', label: 'Esta tela de controles' },
    ],
  },
];

export class ControlsOverlay {
  private readonly root: HTMLDivElement;
  private open = false;

  constructor() {
    injectStyle();
    this.root = this.build();
    document.body.appendChild(this.root);
    registerOverlay(() => this.open);

    // "?" toggles; Esc closes. Capture phase so an open Controls owns Esc before the central menu.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat) return;
        if (this.open && (e.key === 'Escape' || e.key === '?')) {
          this.setOpen(false);
          e.stopImmediatePropagation();
          e.preventDefault();
          return;
        }
        if (e.key !== '?') return;
        if (isTyping()) return; // typing in chat — let the input receive "?"
        if (anyOverlayOpen()) return; // another window is up — don't stack on it
        this.setOpen(true);
        e.stopPropagation();
        e.preventDefault();
      },
      { capture: true },
    );

    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.setOpen(false);
    });
  }

  // Show the controls ONCE, on a player's first session (called from the class pick, right as they
  // enter the world). After that it only opens on demand (? / Esc menu).
  maybeAutoShow(): void {
    let seen = false;
    try {
      seen = localStorage.getItem(SEEN_KEY) === '1';
    } catch {
      /* storage off: just show it (harmless) */
    }
    if (seen) return;
    try {
      localStorage.setItem(SEEN_KEY, '1');
    } catch {
      /* ignore */
    }
    this.setOpen(true);
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.root.style.display = open ? 'grid' : 'none';
  }

  private build(): HTMLDivElement {
    const root = el('ctl');
    const panel = el('ctl-panel');
    panel.append(span('ctl-title', 'Controles'));
    panel.append(span('ctl-hint', 'Aperte ? ou Esc para fechar'));
    const grid = el('ctl-grid');
    for (const group of GROUPS) {
      const sec = el('ctl-section');
      sec.append(span('ctl-section-title', group.title));
      for (const r of group.rows) {
        const row = el('ctl-row');
        row.append(span('ctl-key', r.key), span('ctl-label', r.label));
        sec.append(row);
      }
      grid.append(sec);
    }
    panel.append(grid);
    decoratePanel(panel);
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
  if (document.getElementById('ctl-style')) return;
  const s = document.createElement('style');
  s.id = 'ctl-style';
  s.textContent = `
    .ctl { position: fixed; inset: 0; z-index: 80; display: none; place-items: center;
      background: rgba(6,9,14,0.8); backdrop-filter: blur(3px); font-family: system-ui, sans-serif; }
    .ctl-panel { display: flex; flex-direction: column; gap: 4px; max-width: min(720px, 94vw);
      max-height: 88vh; overflow: auto; padding: 20px 22px; background: rgba(14,19,28,0.98);
      border: 1px solid rgba(120,160,220,0.5); border-radius: 14px; box-shadow: 0 14px 50px rgba(0,0,0,0.6); }
    .ctl-title { font: 800 21px/1.1 system-ui, sans-serif; color: #ffd24a; text-align: center; }
    .ctl-hint { font: 500 12px/1.3 system-ui, sans-serif; color: #8aa0bd; text-align: center; margin-bottom: 12px; }
    .ctl-grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); gap: 14px; }
    .ctl-section { display: flex; flex-direction: column; gap: 5px; padding: 12px 14px;
      background: rgba(22,29,40,0.9); border: 1px solid rgba(120,160,220,0.25); border-radius: 10px; }
    .ctl-section-title { font: 800 12px/1 system-ui, sans-serif; color: #9fb2cc; letter-spacing: .04em;
      text-transform: uppercase; margin-bottom: 4px; }
    .ctl-row { display: flex; align-items: center; gap: 10px; }
    .ctl-key { flex: 0 0 auto; min-width: 76px; color: #ffd9a0; font: 700 11px/1.4 ui-monospace, monospace;
      padding: 3px 7px; background: rgba(34,44,60,0.95); border: 1px solid rgba(120,160,220,0.3);
      border-radius: 6px; text-align: center; white-space: nowrap; }
    .ctl-label { font: 500 13px/1.3 system-ui, sans-serif; color: #eaf1ff; }
  `;
  document.head.appendChild(s);
}
