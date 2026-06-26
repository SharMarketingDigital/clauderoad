// Name-entry screen (GDD v0.4 §1.3, character creation) — a modal shown ON ENTRY,
// BEFORE the class screen. It captures the player NAME, fires `onSubmit(name)`, then
// removes itself. It decides nothing else: the caller threads the name into world
// creation (single-player: the local Sim player; multiplayer: the `join` handshake,
// which the server uses as the save key). `?name=` in the URL stays a shortcut that
// pre-fills/skips this screen. Works identically in single-player and multiplayer.
//
// Mirrors the ClassSelect pattern: self-injected scoped CSS, a fixed full-screen modal,
// and `textContent` (never innerHTML) so a typed name can never inject markup.
import { decoratePanel } from './theme';

const MIN_LEN = 2;
const MAX_LEN = 24; // matches the server's name cap (trim().slice(0, 24))
// Letters (incl. accented pt-BR), digits, spaces, `_` and `-`. Names render via
// textContent, so this is UX/consistency — not an XSS boundary.
const NAME_RE = /^[\p{L}\p{N} _-]+$/u;

// Trim, collapse internal whitespace, cap to the server's limit, then trim again so a
// cut that lands on a space can't leave a trailing space. The server does trim()+slice(),
// so this keeps the displayed name === the stored name in both single- and multiplayer.
export function normalizeName(raw: string): string {
  return raw.trim().replace(/\s+/g, ' ').slice(0, MAX_LEN).trim();
}

// A name is valid if, once normalized, it is MIN_LEN..MAX_LEN and only allowed chars.
export function isValidName(raw: string): boolean {
  const name = normalizeName(raw);
  return name.length >= MIN_LEN && name.length <= MAX_LEN && NAME_RE.test(name);
}

export class NameSelect {
  private root: HTMLDivElement;

  constructor(onSubmit: (name: string) => void, opts: { initial?: string } = {}) {
    injectStyle();
    this.root = el('ns');

    const panel = el('ns-panel');
    panel.append(
      span('ns-title', 'Quem é você?'),
      span('ns-sub', `Escolha o nome do seu personagem (${MIN_LEN}–${MAX_LEN} caracteres).`),
    );

    const input = document.createElement('input');
    input.className = 'ns-input';
    input.type = 'text';
    input.maxLength = MAX_LEN;
    input.placeholder = 'Seu nome';
    input.autocomplete = 'off';
    input.spellcheck = false;
    if (opts.initial) input.value = opts.initial;

    const hint = span('ns-hint', '');

    const btn = document.createElement('button');
    btn.className = 'ns-btn';
    btn.type = 'button';
    btn.textContent = 'Entrar';

    const submit = (): void => {
      if (!isValidName(input.value)) return;
      onSubmit(normalizeName(input.value));
      this.root.remove(); // entry screen: name once, then play
    };
    const refresh = (): void => {
      const typed = input.value.trim();
      const ok = isValidName(input.value);
      btn.disabled = !ok;
      // Only nag once they've typed something invalid; an empty field shows no error.
      hint.textContent = typed.length === 0 || ok ? '' : `Use ${MIN_LEN}–${MAX_LEN} letras, números, espaço, _ ou -.`;
    };

    input.addEventListener('input', refresh);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      }
    });
    btn.addEventListener('click', submit);

    panel.append(input, hint, btn);
    decoratePanel(panel); // stone frame (basic palette) — the first screen the player sees
    this.root.appendChild(panel);
    document.body.appendChild(this.root);

    refresh();
    input.focus();
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
  if (document.getElementById('ns-style')) return;
  const s = document.createElement('style');
  s.id = 'ns-style';
  s.textContent = `
    .ns { position: fixed; inset: 0; z-index: 60; pointer-events: auto;
      display: grid; place-items: center; background: rgba(6,9,14,0.82); backdrop-filter: blur(3px);
      font-family: system-ui, sans-serif; }
    .ns-panel { display: flex; flex-direction: column; gap: 8px; align-items: center;
      padding: 22px 24px; width: min(440px, 94vw); box-sizing: border-box;
      background: rgba(14,19,28,0.97); border: 1px solid rgba(120,160,220,0.5); border-radius: 14px;
      box-shadow: 0 14px 50px rgba(0,0,0,0.6); }
    .ns-title { font: 800 22px/1.1 system-ui, sans-serif; color: #ffd24a; }
    .ns-sub { font: 500 12.5px/1.4 system-ui, sans-serif; color: #9fb2cc; margin-bottom: 6px; text-align: center; }
    .ns-input { width: 100%; box-sizing: border-box; padding: 11px 13px; text-align: center;
      background: rgba(22,29,40,0.9); border: 1px solid rgba(120,160,220,0.35); border-radius: 10px;
      color: #eaf1ff; font: 700 16px/1.1 system-ui, sans-serif; outline: none;
      transition: border-color 0.1s, background 0.1s; }
    .ns-input:focus { border-color: #ffd24a; background: rgba(34,44,60,0.95); }
    .ns-hint { font: 500 11.5px/1.3 system-ui, sans-serif; color: #e2849a; min-height: 14px; text-align: center; }
    .ns-btn { width: 100%; cursor: pointer; padding: 11px 16px; margin-top: 2px;
      background: rgba(22,29,40,0.9); border: 1px solid rgba(120,160,220,0.35); border-radius: 10px;
      color: #ffd24a; font: 800 15px/1.1 system-ui, sans-serif;
      transition: border-color 0.1s, background 0.1s, opacity 0.1s; }
    .ns-btn:hover:not(:disabled) { border-color: #ffd24a; background: rgba(34,44,60,0.95); }
    .ns-btn:disabled { opacity: 0.45; cursor: default; }
  `;
  document.head.appendChild(s);
}
