// Multiplayer text chat (presentation only), MMO-style. The message HISTORY is ALWAYS
// on screen bottom-left (so everyone follows the conversation), and a discreet input is
// opened with Enter. The server is authoritative — this only SENDS the text and DISPLAYS
// what the server broadcasts back (with the sender's server-known name).
//
// Input focus matters: ONLY while the input is focused is isTyping() true, so Input + Hud
// ignore keystrokes (see ui/typing.ts) — the character never moves/acts while you type.
// The always-visible history is a plain <div> (not a text field), so it never blocks the
// game: WASD/skills work normally whenever the input isn't focused.
import type { ChatLine, ChatChannel } from '../net/protocol';
import { isTyping } from './typing';

const HISTORY = 8; // how many recent lines stay on screen (tunable)

export class ChatBox {
  private root: HTMLDivElement;
  private logEl: HTMLDivElement;
  private input: HTMLInputElement;

  // `send` forwards the typed text + its channel to the network (ClientWorld.sendChat).
  constructor(private readonly send: (text: string, channel: ChatChannel) => void) {
    injectStyle();
    this.root = el('chat');
    this.logEl = el('chat-log'); // the permanent history panel
    this.input = document.createElement('input');
    this.input.className = 'chat-input';
    this.input.type = 'text';
    this.input.maxLength = 200; // mirrors the server cap (the server still enforces it)
    this.input.placeholder = 'mensagem… (/p p/ grupo · Enter envia · Esc cancela)';
    this.input.style.display = 'none'; // discreet: only shows while you're typing
    this.root.append(this.logEl, this.input);
    document.body.appendChild(this.root);

    // Enter (when NOT already in a text field) opens + focuses the chat input.
    window.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !isTyping()) {
        e.preventDefault();
        this.open();
      }
    });

    // ANY loss of focus hides the input again (Esc/Enter below, clicking the game world,
    // alt-tab, …) — so it stays discreet whenever you're not actively typing, and the
    // game resumes the instant focus leaves it.
    this.input.addEventListener('blur', () => this.hide());

    // Inside the input: Enter sends, Esc cancels, Tab is a no-op (don't move focus onto a
    // HUD button). stopPropagation so these keystrokes never reach the game/HUD window
    // listeners (belt-and-suspenders with isTyping()).
    this.input.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Tab') {
        e.preventDefault(); // keep focus in the chat
        return;
      }
      if (e.key === 'Enter') {
        e.preventDefault();
        const raw = this.input.value.trim();
        if (raw) {
          // "/p <msg>" -> party channel; plain text -> say; any other "/command" is ignored.
          const p = /^\/p\b\s*/i.exec(raw);
          if (p) {
            const msg = raw.slice(p[0].length).trim();
            if (msg) this.send(msg, 'party');
          } else if (!raw.startsWith('/')) {
            this.send(raw, 'say');
          }
        }
        this.input.blur(); // -> hide() via the blur listener; back to the game
      } else if (e.key === 'Escape') {
        e.preventDefault();
        this.input.blur();
      }
    });
  }

  // Append a received line (player message or system notice). The history panel stays
  // permanently visible — this adds the newest line (which fades in) and trims the oldest.
  add(line: ChatLine): void {
    const row = el('chat-line');
    if (line.system) {
      row.classList.add('system');
      row.textContent = line.text; // e.g. "Fulano entrou"
    } else if (line.channel === 'party') {
      row.classList.add('party');
      row.append(span('chat-tag', '[Grupo] '), span('chat-from', `${line.from}: `), span('chat-text', line.text));
    } else {
      row.append(span('chat-from', `${line.from}: `), span('chat-text', line.text));
    }
    this.logEl.appendChild(row); // newest at the bottom; CSS fades it in
    while (this.logEl.childElementCount > HISTORY && this.logEl.firstChild) {
      this.logEl.removeChild(this.logEl.firstChild); // drop the oldest
    }
  }

  private open(): void {
    this.input.style.display = 'block';
    this.input.value = '';
    this.input.focus(); // now isTyping() is true -> the game ignores keys
  }

  // Hide the input again (called whenever it loses focus). The HISTORY stays visible.
  private hide(): void {
    this.input.value = '';
    this.input.style.display = 'none';
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
  s.textContent = text; // textContent, never innerHTML — chat text can never inject markup
  return s;
}

function injectStyle(): void {
  if (document.getElementById('chat-style')) return;
  const s = document.createElement('style');
  s.id = 'chat-style';
  s.textContent = `
    .chat { position: fixed; left: 16px; bottom: 16px; z-index: 42; width: 360px; max-width: 44vw;
      display: flex; flex-direction: column; gap: 5px; pointer-events: none; }
    .chat-log { display: flex; flex-direction: column; gap: 3px; }
    .chat-line { align-self: flex-start; max-width: 100%; padding: 2px 9px; border-radius: 8px;
      font: 500 13px/1.4 system-ui, sans-serif; color: #eef3ff; background: rgba(10,14,20,0.66);
      text-shadow: 0 1px 2px #000; word-break: break-word; animation: chat-in 0.18s ease-out; }
    .chat-line.system { color: #b8c4d8; font-style: italic; background: rgba(10,14,20,0.5); }
    .chat-line.party { background: rgba(18,30,22,0.72); border-left: 2px solid #6fcf7f; }
    .chat-tag { color: #6fcf7f; font-weight: 700; }
    .chat-from { color: #ffe9a8; font-weight: 700; }
    .chat-input { pointer-events: auto; width: 100%; box-sizing: border-box; padding: 6px 10px;
      font: 500 13px/1.2 system-ui, sans-serif; color: #fff; background: rgba(8,11,16,0.92);
      border: 1px solid rgba(120,160,220,0.7); border-radius: 8px; outline: none; }
    @keyframes chat-in { from { opacity: 0; transform: translateY(4px); } to { opacity: 1; transform: none; } }
  `;
  document.head.appendChild(s);
}
