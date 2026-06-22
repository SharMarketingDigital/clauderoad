// Party / co-op UI (presentation only), MMO-style. Reads the local player's party +
// pending invite from IWorld (localParty / localInvite — the server's authoritative
// state, mirrored over the snapshot) and SENDS party commands back. It never decides
// anything: create / invite / accept / refuse / leave are all intent the sim validates.
//
// Three pieces, top-left under the player's own frame:
//   • member FRAMES (name, level, HP/MP bars, leader ★) when you're in a party;
//   • CONTROLS — "Criar grupo" (with the two mode pickers) when solo, or Convidar + Sair
//     when grouped (Convidar only for the leader);
//   • an INVITE popup (Aceitar / Recusar) when someone invites you.
// A name <input> makes isTyping() true while focused, so the character never moves while
// you type a name (same mechanism as chat).
import type { IWorld, PartyExpMode, PartyLootMode } from '../world_api';

export class PartyHud {
  private root: HTMLDivElement;
  private framesEl: HTMLDivElement;
  // controls
  private createBtn: HTMLButtonElement;
  private createForm: HTMLDivElement;
  private expSel: HTMLSelectElement;
  private lootSel: HTMLSelectElement;
  private inviteRow: HTMLDivElement;
  private nameInput: HTMLInputElement;
  private leaveBtn: HTMLButtonElement;
  // invite popup
  private invitePopup: HTMLDivElement;
  private inviteText: HTMLDivElement;

  constructor(private readonly world: IWorld) {
    injectStyle();
    this.root = el('party');
    this.framesEl = el('party-frames');

    // --- controls ---
    const controls = el('party-controls');
    this.createBtn = button('party-btn', '＋ Criar grupo', () => {
      this.createForm.style.display = this.createForm.style.display === 'none' ? 'flex' : 'none';
    });
    this.createForm = el('party-form');
    this.createForm.style.display = 'none';
    this.expSel = select([
      ['each-get', 'XP: cada um pega o seu (+bônus · máx 4)'],
      ['auto-share', 'XP: dividido por nível (máx 8)'],
    ]);
    this.lootSel = select([
      ['distribution', 'Loot: quem pega, fica'],
      ['auto-share', 'Loot: sorteado no grupo'],
    ]);
    const createConfirm = button('party-btn primary', 'Criar', () => {
      this.world.sendCommand({
        t: 'party-create',
        exp: this.expSel.value as PartyExpMode,
        loot: this.lootSel.value as PartyLootMode,
      });
      this.createForm.style.display = 'none';
    });
    this.createForm.append(this.expSel, this.lootSel, createConfirm);

    this.inviteRow = el('party-invite-row');
    this.nameInput = document.createElement('input');
    this.nameInput.className = 'party-input';
    this.nameInput.type = 'text';
    this.nameInput.maxLength = 24;
    this.nameInput.placeholder = 'nome do jogador…';
    this.nameInput.addEventListener('keydown', (e) => {
      e.stopPropagation(); // typing never reaches the game/HUD listeners
      if (e.key === 'Enter') { e.preventDefault(); this.doInvite(); }
      else if (e.key === 'Escape') { e.preventDefault(); this.nameInput.blur(); }
    });
    const inviteBtn = button('party-btn', 'Convidar', () => this.doInvite());
    this.inviteRow.append(this.nameInput, inviteBtn);

    this.leaveBtn = button('party-btn danger', 'Sair do grupo', () => this.world.sendCommand({ t: 'party-leave' }));

    controls.append(this.createBtn, this.createForm, this.inviteRow, this.leaveBtn);

    // --- invite popup ---
    this.invitePopup = el('party-popup');
    this.inviteText = el('party-popup-text');
    const acceptBtn = button('party-btn primary', 'Aceitar', () => this.world.sendCommand({ t: 'party-accept' }));
    const refuseBtn = button('party-btn', 'Recusar', () => this.world.sendCommand({ t: 'party-refuse' }));
    const popupBtns = el('party-popup-btns');
    popupBtns.append(acceptBtn, refuseBtn);
    this.invitePopup.append(this.inviteText, popupBtns);

    this.root.append(this.framesEl, controls);
    document.body.append(this.root, this.invitePopup);
  }

  private doInvite(): void {
    const name = this.nameInput.value.trim();
    if (name) this.world.sendCommand({ t: 'party-invite', name });
    this.nameInput.value = '';
  }

  update(world: IWorld): void {
    const party = world.localParty();
    const invite = world.localInvite();
    const localId = world.localPlayerId();

    // --- member frames ---
    this.framesEl.innerHTML = '';
    if (party) {
      for (const m of party.members) {
        const row = el('party-row');
        if (m.id === localId) row.classList.add('me');
        if (m.dead) row.classList.add('dead');
        const head = el('party-row-head');
        head.append(
          span('party-lead', m.leader ? '★' : ''),
          span('party-name', m.name),
          span('party-lvl', `Nv ${m.level}`),
        );
        const bars = el('party-bars');
        bars.append(bar('party-hp', m.hp, m.maxHp), bar('party-mp', m.mp, m.maxMp));
        row.append(head, bars);
        this.framesEl.appendChild(row);
      }
    }

    // --- controls ---
    const inParty = !!party;
    const isLeader = !!party && party.members.some((m) => m.leader && m.id === localId);
    const full = !!party && party.members.length >= party.maxMembers;
    this.createBtn.style.display = inParty ? 'none' : 'block';
    if (inParty) this.createForm.style.display = 'none';
    this.inviteRow.style.display = isLeader && !full ? 'flex' : 'none';
    this.leaveBtn.style.display = inParty ? 'block' : 'none';

    // --- invite popup ---
    if (invite) {
      const expTxt = invite.expMode === 'auto-share' ? 'XP dividido' : 'XP cada um';
      const lootTxt = invite.lootMode === 'auto-share' ? 'loot sorteado' : 'loot de quem pega';
      this.inviteText.textContent = `${invite.fromName} te convidou pro grupo (${expTxt} · ${lootTxt}).`;
      this.invitePopup.style.display = 'block';
    } else {
      this.invitePopup.style.display = 'none';
    }
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
  s.textContent = text;
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
function select(options: [string, string][]): HTMLSelectElement {
  const s = document.createElement('select');
  s.className = 'party-select';
  for (const [value, label] of options) {
    const o = document.createElement('option');
    o.value = value;
    o.textContent = label;
    s.appendChild(o);
  }
  return s;
}
function bar(className: string, cur: number, max: number): HTMLDivElement {
  const wrap = el(className);
  const fill = el(`${className}-fill`);
  fill.style.width = `${max > 0 ? Math.max(0, Math.min(100, (cur / max) * 100)) : 0}%`;
  wrap.appendChild(fill);
  return wrap;
}

function injectStyle(): void {
  if (document.getElementById('party-style')) return;
  const s = document.createElement('style');
  s.id = 'party-style';
  s.textContent = `
    .party { position: fixed; left: 14px; top: 116px; z-index: 41; width: 196px;
      display: flex; flex-direction: column; gap: 7px; font-family: system-ui, sans-serif; }
    .party-frames { display: flex; flex-direction: column; gap: 5px; }
    .party-row { padding: 5px 8px; background: rgba(14,19,28,0.82); border: 1px solid rgba(120,160,220,0.4);
      border-radius: 7px; display: flex; flex-direction: column; gap: 4px; }
    .party-row.me { border-color: rgba(242,196,74,0.7); }
    .party-row.dead { opacity: 0.45; }
    .party-row-head { display: flex; align-items: baseline; gap: 5px; }
    .party-lead { color: #ffd24a; font-size: 11px; width: 10px; }
    .party-name { flex: 1; font: 600 12px/1.2 system-ui, sans-serif; color: #eaf1ff;
      text-shadow: 0 1px 2px #000; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
    .party-lvl { font: 600 10px/1 system-ui, sans-serif; color: #9fb2cc; }
    .party-bars { display: flex; flex-direction: column; gap: 2px; }
    .party-hp, .party-mp { height: 5px; background: rgba(0,0,0,0.55); border-radius: 3px; overflow: hidden; }
    .party-hp-fill { height: 100%; background: #4caf50; transition: width 0.12s linear; }
    .party-mp-fill { height: 100%; background: #4a90d9; transition: width 0.12s linear; }
    .party-controls { display: flex; flex-direction: column; gap: 5px; }
    .party-form, .party-invite-row { display: none; flex-direction: column; gap: 5px;
      padding: 7px; background: rgba(14,19,28,0.82); border: 1px solid rgba(120,160,220,0.4); border-radius: 7px; }
    .party-invite-row { flex-direction: row; }
    .party-btn { pointer-events: auto; padding: 5px 9px; font: 600 12px/1.1 system-ui, sans-serif;
      color: #dbe6f7; background: rgba(30,40,56,0.92); border: 1px solid rgba(120,160,220,0.5);
      border-radius: 7px; cursor: pointer; }
    .party-btn:hover { background: rgba(44,58,80,0.95); }
    .party-btn.primary { color: #10202f; background: #ffd24a; border-color: #ffd24a; }
    .party-btn.danger { color: #ffd0d0; border-color: rgba(200,120,120,0.6); }
    .party-select { pointer-events: auto; padding: 4px 6px; font: 500 11px/1.2 system-ui, sans-serif;
      color: #eaf1ff; background: rgba(8,11,16,0.95); border: 1px solid rgba(120,160,220,0.5); border-radius: 6px; }
    .party-input { pointer-events: auto; flex: 1; min-width: 0; padding: 5px 8px;
      font: 500 12px/1.2 system-ui, sans-serif; color: #fff; background: rgba(8,11,16,0.95);
      border: 1px solid rgba(120,160,220,0.6); border-radius: 6px; outline: none; }
    .party-popup { position: fixed; left: 50%; top: 92px; transform: translateX(-50%); z-index: 43;
      display: none; width: min(340px, 80vw); padding: 12px 14px; background: rgba(16,22,32,0.95);
      border: 1px solid rgba(242,196,74,0.7); border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,0.5); }
    .party-popup-text { font: 600 13px/1.4 system-ui, sans-serif; color: #eaf1ff; margin-bottom: 9px; text-shadow: 0 1px 2px #000; }
    .party-popup-btns { display: flex; gap: 8px; justify-content: flex-end; }
  `;
  document.head.appendChild(s);
}
