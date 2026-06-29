// A small themed dialog asking for a gold price — replaces window.prompt(), which blocks the loop,
// looks like a browser alert, and vanishes in fullscreen. One-shot: built on demand, appended to
// <body> (NOT inside a per-frame HUD panel, so it isn't rebuilt under the player), removed on close.
// Enter confirms, Esc/clique-fora cancela. While the input is focused, isTyping() is true so the game
// hotkeys (J/N/WASD…) are inert. Pure UI — never touches the sim.
import { decoratePanel } from './theme';

interface AskPriceOpts {
  title: string;
  hint?: string;
  initial?: number;
  allowZero?: boolean; // true (stall): 0/blank removes the listing; false (market): the price must be > 0
  confirmLabel?: string;
  onSubmit: (price: number) => void; // called with the parsed integer on confirm (never on cancel)
}

export function askPrice(opts: AskPriceOpts): void {
  injectStyle();
  const scrim = document.createElement('div');
  scrim.className = 'price-scrim';
  const panel = document.createElement('div');
  panel.className = 'price-panel';

  panel.append(textDiv('price-title', opts.title));
  if (opts.hint) panel.append(textDiv('price-hint', opts.hint));

  const wrap = document.createElement('div');
  wrap.className = 'price-input-wrap';
  const input = document.createElement('input');
  input.type = 'number';
  input.min = opts.allowZero ? '0' : '1';
  input.step = '1';
  input.className = 'price-input';
  input.placeholder = '0';
  if (opts.initial != null) input.value = String(opts.initial);
  const coin = textDiv('price-coin', 'g');
  wrap.append(input, coin);
  panel.append(wrap);

  const actions = document.createElement('div');
  actions.className = 'price-actions';
  const cancelBtn = makeBtn('price-btn', 'Cancelar');
  const okBtn = makeBtn('price-btn price-btn-ok', opts.confirmLabel ?? 'Confirmar');
  actions.append(cancelBtn, okBtn);
  panel.append(actions);

  decoratePanel(panel); // medieval stone frame, like the other panels
  scrim.append(panel);
  document.body.append(scrim);

  let done = false;
  const close = (): void => {
    if (done) return;
    done = true;
    scrim.remove();
  };
  const confirm = (): void => {
    const price = Math.floor(Number(input.value));
    if (!Number.isInteger(price) || price < 0) return close(); // garbage -> treat as cancel
    if (price === 0 && !opts.allowZero) return close(); // market requires a positive price
    close();
    opts.onSubmit(price);
  };

  okBtn.onclick = confirm;
  cancelBtn.onclick = close;
  scrim.addEventListener('click', (e) => {
    if (e.target === scrim) close();
  });
  input.addEventListener('keydown', (e) => {
    e.stopPropagation(); // keep digits out of the game hotkeys
    if (e.key === 'Enter') {
      e.preventDefault();
      confirm();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    }
  });

  input.focus();
  input.select();
}

function textDiv(className: string, text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  d.textContent = text;
  return d;
}
function makeBtn(className: string, text: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  b.textContent = text;
  return b;
}

function injectStyle(): void {
  if (document.getElementById('price-style')) return;
  const s = document.createElement('style');
  s.id = 'price-style';
  s.textContent = `
    .price-scrim { position: fixed; inset: 0; z-index: 85; display: grid; place-items: center;
      background: rgba(6,9,14,0.6); backdrop-filter: blur(2px); }
    .price-panel { position: relative; display: flex; flex-direction: column; gap: 10px;
      min-width: min(320px, 90vw); padding: 20px 22px; border-radius: 12px; color: #ece2cf; }
    .price-title { font-weight: 800; font-size: 17px; line-height: 1.2; color: #ffe9a8; }
    .price-hint { font-weight: 500; font-size: 12px; line-height: 1.3; color: #b9ad93; margin-top: -4px; }
    .price-input-wrap { display: flex; align-items: center; gap: 8px; }
    .price-input { flex: 1; padding: 9px 11px; font: 700 16px/1 ui-monospace, monospace; color: #fff5cc;
      background: rgba(8,12,18,0.9); border: 1px solid rgba(176,140,60,0.45); border-radius: 8px; }
    .price-input:focus { outline: none; border-color: #ffd24a; }
    .price-coin { font: 700 15px/1 ui-monospace, monospace; color: #ffd24a; }
    .price-actions { display: flex; gap: 10px; justify-content: flex-end; margin-top: 4px; }
    .price-btn { padding: 7px 16px; cursor: pointer; font-weight: 700; font-size: 13px; color: #f3e8cc;
      background: rgba(40,32,22,0.92); border: 1px solid #a07f3c; border-radius: 8px; }
    .price-btn:hover { border-color: #ffd24a; }
    .price-btn-ok { color: #0c1018; background: #ffd24a; border-color: #ffd24a; }
    .price-btn-ok:hover { filter: brightness(1.08); }
  `;
  document.head.appendChild(s);
}
