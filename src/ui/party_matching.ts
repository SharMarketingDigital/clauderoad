// Party matching window (presentation only), Silkroad-style — opened with E. Three parts:
//   • the public LIST of parties looking for members (with type, level limits, slots open)
//     — a seeker clicks "Pedir entrada"; the leader then approves/denies;
//   • REGISTER my group (leader only): a title + optional level range, or cancel the listing;
//   • the pending REQUESTS to my group (leader only): each with Aceitar / Recusar.
//
// It reads the server-authoritative lobby state (matchingList / partyRequests /
// myRequestPartyId) + the player's party, and SENDS matching intent — it decides nothing.
// Like the chat, this is a concrete MP channel (a MatchingPort the ClientWorld satisfies),
// not part of the IWorld seam. A focused <input> makes isTyping() true so the character
// never moves while you type a title (same mechanism as chat / the invite-name field).
import type { PartyView } from '../world_api';
import { registerOverlay } from './overlays';
import type { MatchingEntryView, MatchingRequestView } from '../net/protocol';
import { decoratePanel } from './theme';
import { isTyping } from './typing';

// The narrow surface this window needs — ClientWorld satisfies it structurally (so the UI
// stays decoupled from the concrete online world, depending only on these methods).
export interface MatchingPort {
  localPlayerId(): number | null;
  localParty(): PartyView | null;
  localLevel(): number;
  matchingList(): MatchingEntryView[];
  partyRequests(): MatchingRequestView[];
  myRequestPartyId(): number | null;
  registerMatching(title: string, minLevel: number, maxLevel: number): void;
  unregisterMatching(): void;
  requestJoinMatching(partyId: number): void;
  cancelMatchingRequest(): void;
  approveJoin(playerId: number): void;
  denyJoin(playerId: number): void;
}

export class PartyMatching {
  private root: HTMLDivElement;
  private listEl: HTMLDivElement; // the public LFM list (rebuilt on change)
  private requestsEl: HTMLDivElement; // pending requests to my party (rebuilt on change)
  // register controls (built once; visibility/labels updated each frame)
  private registerBox: HTMLDivElement;
  private titleInput: HTMLInputElement;
  private minInput: HTMLInputElement;
  private maxInput: HTMLInputElement;
  private registerBtn: HTMLButtonElement;
  private unregisterBtn: HTMLButtonElement;
  private registerHint: HTMLDivElement;
  private visible = false; // closed by default; E opens it (it's a browser, not a HUD frame)
  private lastSig = ''; // rebuild the list/requests only when the data actually changed

  constructor(private readonly port: MatchingPort) {
    injectStyle();
    this.root = el('pm');
    this.root.style.display = 'none';

    const header = el('pm-header');
    header.append(span('pm-title', 'Party Matching | Procurar Grupo'), span('pm-close', 'E / Esc fecha'));

    this.listEl = el('pm-list');
    this.requestsEl = el('pm-requests');

    // --- register my group (leader only) ---
    this.registerBox = el('pm-register');
    this.titleInput = textInput('pm-input', 'título / propósito (ex.: farm de lobos)', 40);
    this.minInput = numInput('pm-num', 'Nv mín');
    this.maxInput = numInput('pm-num', 'Nv máx');
    const levelRow = el('pm-level-row');
    levelRow.append(this.minInput, this.maxInput);
    this.registerBtn = button('pm-btn primary', 'Registrar grupo na lista', () => {
      this.port.registerMatching(this.titleInput.value.trim(), intOf(this.minInput), intOf(this.maxInput));
    });
    this.unregisterBtn = button('pm-btn danger', 'Cancelar registro', () => this.port.unregisterMatching());
    this.registerHint = el('pm-hint');
    this.registerBox.append(
      span('pm-section', 'Meu grupo'),
      this.registerHint, this.titleInput, levelRow, this.registerBtn, this.unregisterBtn,
    );

    this.root.append(header, span('pm-section', 'Grupos procurando membros'), this.listEl, this.requestsEl, this.registerBox);
    document.body.appendChild(this.root);
    decoratePanel(this.root); // stone frame

    // E toggles the window; Esc closes it. Guarded by isTyping() so neither fires while
    // typing in chat or in this window's own title field (you can type "e" in a title).
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (isTyping()) return; // inputs manage their own Esc/Enter (below)
      if (e.key === 'Escape') { if (this.visible) this.setVisible(false); return; }
      if (e.key.toLowerCase() === 'e') this.setVisible(!this.visible);
    });
    // ESC priority (overlays registry): the settings menu only opens when no window is up.
    registerOverlay(() => this.visible);
  }

  private setVisible(open: boolean): void {
    this.visible = open;
    this.root.style.display = open ? 'flex' : 'none';
    if (open) this.lastSig = ''; // force a rebuild on (re)open
  }

  update(): void {
    if (!this.visible) return; // only touch the DOM while the window is open

    const myId = this.port.localPlayerId();
    const myParty = this.port.localParty();
    const myLevel = this.port.localLevel();
    const list = this.port.matchingList();
    const reqs = this.port.partyRequests();
    const myReq = this.port.myRequestPartyId();
    const isLeader = !!myParty && myParty.members.some((m) => m.id === myId && m.leader);
    const registered = !!myParty && list.some((e) => e.partyId === myParty.id);

    // --- register controls (no rebuild — keep the inputs' typed values) ---
    if (isLeader) {
      this.registerHint.textContent = registered ? 'Seu grupo está na lista de matching.' : '';
      this.titleInput.style.display = registered ? 'none' : 'block';
      this.minInput.parentElement!.style.display = registered ? 'none' : 'flex';
      this.registerBtn.style.display = registered ? 'none' : 'block';
      this.unregisterBtn.style.display = registered ? 'block' : 'none';
    } else {
      this.registerHint.textContent = myParty
        ? 'Só o líder pode registrar o grupo na lista.'
        : 'Crie um grupo (tecla P) e seja líder para registrar na lista.';
      this.titleInput.style.display = 'none';
      this.minInput.parentElement!.style.display = 'none';
      this.registerBtn.style.display = 'none';
      this.unregisterBtn.style.display = 'none';
    }

    // --- list + requests: rebuild only when the data changed (so clicks/hover don't thrash) ---
    const sig = JSON.stringify({ list, reqs, myReq, p: myParty?.id ?? 0, l: isLeader, lvl: myLevel });
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    this.listEl.textContent = '';
    if (list.length === 0) {
      this.listEl.appendChild(span('pm-empty', 'Nenhum grupo na lista. Registre o seu abaixo!'));
    }
    for (const e of list) {
      const row = el('pm-row');
      const info = el('pm-row-info');
      const titleTxt = e.title || '(sem título)';
      const typeTxt = e.expMode === 'auto-share' ? 'XP dividido' : 'XP cada um';
      info.append(
        span('pm-row-title', titleTxt),
        span('pm-row-meta', `${e.leaderName} · ${typeTxt} · ${e.members}/${e.maxMembers} · ${levelLabel(e)}`),
      );
      row.appendChild(info);
      row.appendChild(this.actionFor(e, myParty, myReq, myLevel));
      this.listEl.appendChild(row);
    }

    // pending requests to MY party (leader only)
    this.requestsEl.textContent = '';
    if (isLeader && reqs.length > 0) {
      this.requestsEl.appendChild(span('pm-section', 'Pedidos para entrar'));
      for (const r of reqs) {
        const row = el('pm-row');
        row.appendChild(span('pm-row-title', `${r.name} · Nv ${r.level}`));
        const btns = el('pm-row-btns');
        btns.append(
          button('pm-btn primary small', 'Aceitar', () => this.port.approveJoin(r.playerId)),
          button('pm-btn small', 'Recusar', () => this.port.denyJoin(r.playerId)),
        );
        row.appendChild(btns);
        this.requestsEl.appendChild(row);
      }
    }
  }

  // The right-hand action for one list row: a "your group" tag, a cancel-my-request button,
  // or a "Pedir entrada" button (disabled — with a reason tooltip — when already grouped,
  // full, already requesting elsewhere, or this player doesn't meet the level restriction;
  // the server is still the authority, this is just honest UI feedback).
  private actionFor(e: MatchingEntryView, myParty: PartyView | null, myReq: number | null, myLevel: number): HTMLElement {
    if (myParty && myParty.id === e.partyId) return span('pm-row-tag', 'Seu grupo');
    if (myReq === e.partyId) {
      return button('pm-btn small', 'Cancelar pedido', () => this.port.cancelMatchingRequest());
    }
    const meetsLevel = (e.minLevel === 0 || myLevel >= e.minLevel) && (e.maxLevel === 0 || myLevel <= e.maxLevel);
    const btn = button('pm-btn primary small', 'Pedir entrada', () => this.port.requestJoinMatching(e.partyId));
    btn.disabled = !!myParty || e.members >= e.maxMembers || myReq !== null || !meetsLevel;
    btn.title = !meetsLevel
      ? `Seu nível (${myLevel}) não atende a este grupo (${levelLabel(e)}).`
      : e.members >= e.maxMembers ? 'Grupo cheio.'
      : myParty ? 'Você já está num grupo.'
      : myReq !== null ? 'Você já tem um pedido pendente.' : '';
    return btn;
  }
}

function levelLabel(e: MatchingEntryView): string {
  if (e.minLevel > 0 && e.maxLevel > 0) return `Nv ${e.minLevel}–${e.maxLevel}`;
  if (e.minLevel > 0) return `Nv ${e.minLevel}+`;
  if (e.maxLevel > 0) return `até Nv ${e.maxLevel}`;
  return 'qualquer nível';
}

function intOf(input: HTMLInputElement): number {
  const n = parseInt(input.value, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function el(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}
function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text; // textContent, never innerHTML — names/titles can never inject markup
  return s;
}
function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}
function textInput(className: string, placeholder: string, maxLen: number): HTMLInputElement {
  const i = document.createElement('input');
  i.className = className;
  i.type = 'text';
  i.maxLength = maxLen;
  i.placeholder = placeholder;
  guardTyping(i);
  return i;
}
function numInput(className: string, placeholder: string): HTMLInputElement {
  const i = document.createElement('input');
  i.className = className;
  i.type = 'number';
  i.min = '0';
  i.placeholder = placeholder;
  guardTyping(i);
  return i;
}
// Keep keystrokes inside the field (Esc blurs; Enter/typing never reach the game/HUD).
function guardTyping(i: HTMLInputElement): void {
  i.addEventListener('keydown', (e) => {
    e.stopPropagation();
    if (e.key === 'Escape') { e.preventDefault(); i.blur(); }
  });
}

function injectStyle(): void {
  if (document.getElementById('pm-style')) return;
  const s = document.createElement('style');
  s.id = 'pm-style';
  s.textContent = `
    .pm { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 44;
      width: min(440px, 92vw); max-height: 78vh; overflow-y: auto; pointer-events: auto;
      display: flex; flex-direction: column; gap: 9px; padding: 14px 16px;
      background: rgba(14,19,28,0.96); border: 1px solid rgba(120,160,220,0.5); border-radius: 12px;
      box-shadow: 0 10px 40px rgba(0,0,0,0.55); font-family: system-ui, sans-serif; color: #eaf1ff; }
    .pm-header { display: flex; align-items: baseline; justify-content: space-between; }
    .pm-title { font: 800 15px/1.1 system-ui, sans-serif; color: #ffd24a; }
    .pm-close { font: 600 11px/1 system-ui, sans-serif; color: #8294ad; }
    .pm-section { font: 700 11px/1 system-ui, sans-serif; color: #9fb2cc; letter-spacing: 0.05em;
      text-transform: uppercase; padding-top: 4px; }
    .pm-list, .pm-requests { display: flex; flex-direction: column; gap: 6px; }
    .pm-empty { font: 500 12px/1.4 system-ui, sans-serif; color: #8294ad; padding: 4px 2px; }
    .pm-row { display: flex; align-items: center; justify-content: space-between; gap: 8px;
      padding: 7px 9px; background: rgba(22,29,40,0.85); border: 1px solid rgba(120,160,220,0.3);
      border-radius: 8px; }
    .pm-row-info { display: flex; flex-direction: column; gap: 2px; min-width: 0; flex: 1; }
    .pm-row-title { font: 700 13px/1.2 system-ui, sans-serif; color: #eaf1ff; overflow: hidden;
      text-overflow: ellipsis; white-space: nowrap; }
    .pm-row-meta { font: 500 11px/1.2 system-ui, sans-serif; color: #9fb2cc; }
    .pm-row-tag { font: 700 11px/1 system-ui, sans-serif; color: #ffd24a; white-space: nowrap; }
    .pm-row-btns { display: flex; gap: 6px; }
    .pm-register { display: flex; flex-direction: column; gap: 7px; padding-top: 6px;
      border-top: 1px solid rgba(120,160,220,0.2); }
    .pm-hint { font: 500 12px/1.4 system-ui, sans-serif; color: #8294ad; }
    .pm-level-row { display: flex; gap: 7px; }
    .pm-input, .pm-num { pointer-events: auto; box-sizing: border-box; padding: 6px 9px;
      font: 500 12px/1.2 system-ui, sans-serif; color: #fff; background: rgba(8,11,16,0.95);
      border: 1px solid rgba(120,160,220,0.6); border-radius: 6px; outline: none; }
    .pm-input { width: 100%; }
    .pm-num { flex: 1; min-width: 0; }
    .pm-btn { pointer-events: auto; padding: 6px 11px; font: 700 12px/1.1 system-ui, sans-serif;
      color: #dbe6f7; background: rgba(30,40,56,0.95); border: 1px solid rgba(120,160,220,0.5);
      border-radius: 7px; cursor: pointer; white-space: nowrap; }
    .pm-btn.small { padding: 5px 9px; font-size: 11px; }
    .pm-btn:hover:not(:disabled) { background: rgba(44,58,80,0.98); }
    .pm-btn:disabled { opacity: 0.4; cursor: default; }
    .pm-btn.primary { color: #10202f; background: #ffd24a; border-color: #ffd24a; }
    .pm-btn.primary:hover:not(:disabled) { background: #ffde6a; }
    .pm-btn.danger { color: #ffd0d0; border-color: rgba(200,120,120,0.6); background: rgba(40,24,24,0.9); }
  `;
  document.head.appendChild(s);
}
