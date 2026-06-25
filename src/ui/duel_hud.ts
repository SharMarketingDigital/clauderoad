// Duel UI (Tier 1 A3, presentation only). Reads the local player's duel + pending challenge from
// IWorld (localDuel / localDuelInvite — the server's authoritative state, mirrored over the
// snapshot) and SENDS duel commands back. It never decides anything: accept / decline are intent
// the sim validates; the CHALLENGE itself is sent by right-clicking a player (see game/input.ts).
//
// Two pieces:
//   • a top-centre BANNER while a duel is active ("⚔ Duelo — vs <opponent>");
//   • a CHALLENGE popup (Aceitar / Recusar) when someone challenges you, mirroring the party-invite
//     popup so the interaction is familiar.
import type { IWorld } from '../world_api';

export class DuelHud {
  private banner: HTMLDivElement;
  private popup: HTMLDivElement;
  private popupText: HTMLDivElement;

  constructor(private readonly world: IWorld) {
    injectStyle();

    this.banner = el('duel-banner');
    this.banner.style.display = 'none';

    this.popup = el('duel-popup');
    this.popup.style.display = 'none';
    this.popupText = el('duel-popup-text');
    const accept = button('duel-btn primary', 'Aceitar', () => this.world.sendCommand({ t: 'duel-accept' }));
    const decline = button('duel-btn', 'Recusar', () => this.world.sendCommand({ t: 'duel-decline' }));
    const btns = el('duel-popup-btns');
    btns.append(accept, decline);
    this.popup.append(this.popupText, btns);

    document.body.append(this.banner, this.popup);
  }

  update(world: IWorld): void {
    const duel = world.localDuel();
    const invite = world.localDuelInvite();

    // Active-duel banner.
    if (duel) {
      this.banner.textContent = `⚔ Duelo — vs ${duel.opponentName}`;
      this.banner.style.display = 'block';
    } else {
      this.banner.style.display = 'none';
    }

    // Incoming-challenge popup (hidden once a duel is active, i.e. after you accept).
    if (invite && !duel) {
      this.popupText.textContent = `${invite.fromName} te desafiou para um duelo.`;
      this.popup.style.display = 'block';
    } else {
      this.popup.style.display = 'none';
    }
  }
}

function el(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}
function button(className: string, text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.className = className;
  b.type = 'button';
  b.textContent = text;
  b.addEventListener('click', onClick);
  return b;
}

function injectStyle(): void {
  if (document.getElementById('duel-style')) return;
  const s = document.createElement('style');
  s.id = 'duel-style';
  s.textContent = `
    .duel-banner { position: fixed; left: 50%; top: 54px; transform: translateX(-50%); z-index: 42;
      display: none; padding: 6px 16px; background: rgba(40,12,14,0.92);
      border: 1px solid rgba(220,90,90,0.8); border-radius: 999px;
      font: 800 13px/1.2 system-ui, sans-serif; color: #ffd0d0; letter-spacing: 0.02em;
      text-shadow: 0 1px 2px #000; box-shadow: 0 4px 18px rgba(0,0,0,0.5); pointer-events: none; }
    /* The challenge popup sits just below the party-invite popup (top:92) so the two never stack. */
    .duel-popup { position: fixed; left: 50%; top: 150px; transform: translateX(-50%); z-index: 43;
      display: none; width: min(340px, 80vw); padding: 12px 14px; background: rgba(28,14,16,0.96);
      border: 1px solid rgba(220,90,90,0.8); border-radius: 10px; box-shadow: 0 6px 24px rgba(0,0,0,0.5); }
    .duel-popup-text { font: 600 13px/1.4 system-ui, sans-serif; color: #ffe6e6; margin-bottom: 9px; text-shadow: 0 1px 2px #000; }
    .duel-popup-btns { display: flex; gap: 8px; justify-content: flex-end; }
    .duel-btn { pointer-events: auto; padding: 5px 11px; font: 600 12px/1.1 system-ui, sans-serif;
      color: #f3dede; background: rgba(40,22,24,0.92); border: 1px solid rgba(220,90,90,0.6);
      border-radius: 7px; cursor: pointer; }
    .duel-btn:hover { background: rgba(60,30,32,0.95); }
    .duel-btn.primary { color: #2a0c0e; background: #e2849a; border-color: #e2849a; }
  `;
  document.head.appendChild(s);
}
