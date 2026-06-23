// Class-selection screen (GDD v0.3 §G1) — a modal shown ON ENTRY, before playing. Lists
// the 4 classes (data from content/classes.ts); on pick it fires `onSelect(classId)` and
// removes itself. It decides nothing: the caller turns the pick into a `select-class`
// command (the sim equips that class's starter weapon/kit, for a fresh character). Works
// identically in single-player and multiplayer — it only emits the chosen id.
import { PLAYER_CLASSES } from '../sim/content/classes';

export class ClassSelect {
  private root: HTMLDivElement;

  constructor(onSelect: (classId: string) => void) {
    injectStyle();
    this.root = el('cs');

    const panel = el('cs-panel');
    panel.append(
      span('cs-title', 'Escolha sua classe'),
      span('cs-sub', 'Define sua arma e kit de habilidades iniciais. Você pode trocar de arma depois.'),
    );

    const grid = el('cs-grid');
    for (const c of PLAYER_CLASSES) {
      const card = document.createElement('button');
      card.className = 'cs-card';
      card.type = 'button';
      card.append(span('cs-card-name', c.name), span('cs-card-desc', c.description));
      card.addEventListener('click', () => {
        onSelect(c.id);
        this.root.remove(); // entry screen: pick once, then play
      });
      grid.appendChild(card);
    }
    panel.appendChild(grid);
    this.root.appendChild(panel);
    document.body.appendChild(this.root);
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
  if (document.getElementById('cs-style')) return;
  const s = document.createElement('style');
  s.id = 'cs-style';
  s.textContent = `
    .cs { position: fixed; inset: 0; z-index: 60; pointer-events: auto;
      display: grid; place-items: center; background: rgba(6,9,14,0.82); backdrop-filter: blur(3px);
      font-family: system-ui, sans-serif; }
    .cs-panel { display: flex; flex-direction: column; gap: 6px; align-items: center;
      padding: 22px 24px; max-width: min(720px, 94vw);
      background: rgba(14,19,28,0.97); border: 1px solid rgba(120,160,220,0.5); border-radius: 14px;
      box-shadow: 0 14px 50px rgba(0,0,0,0.6); }
    .cs-title { font: 800 22px/1.1 system-ui, sans-serif; color: #ffd24a; }
    .cs-sub { font: 500 12.5px/1.4 system-ui, sans-serif; color: #9fb2cc; margin-bottom: 8px; text-align: center; }
    .cs-grid { display: grid; grid-template-columns: repeat(2, 1fr); gap: 12px; width: 100%; }
    .cs-card { display: flex; flex-direction: column; gap: 6px; text-align: left; cursor: pointer;
      padding: 14px 16px; background: rgba(22,29,40,0.9); border: 1px solid rgba(120,160,220,0.35);
      border-radius: 10px; color: #eaf1ff; font-family: inherit; transition: border-color 0.1s, background 0.1s; }
    .cs-card:hover { border-color: #ffd24a; background: rgba(34,44,60,0.95); }
    .cs-card-name { font: 800 16px/1.1 system-ui, sans-serif; color: #ffd24a; }
    .cs-card-desc { font: 500 12.5px/1.45 system-ui, sans-serif; color: #c4d2e6; }
    @media (max-width: 560px) { .cs-grid { grid-template-columns: 1fr; } }
  `;
  document.head.appendChild(s);
}
