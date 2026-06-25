// Duel UI (Tier 1, presentation only). Reads the local player's duel + pending challenge from
// IWorld (localDuel / localDuelInvite — the server's authoritative state, mirrored over the
// snapshot) and SENDS duel commands back. It never decides anything: accept / decline / challenge
// are intent the sim validates.
//
// Flow (A3 refinado): the player LEFT-CLICKS another player (the same raycast the mob-targeting
// uses); Input tracks that selection CLIENT-SIDE (the sim's target is enemy-only — canAttack — so a
// player can never be the sim target). While a player is selected, a floating "⚔ Duelar <nome>"
// button shows over their head; clicking it sends the challenge and pops a "Desafio enviado" toast
// (the challenger otherwise sees nothing — the Aceitar/Recusar popup lands on the OTHER player). The
// challenge popup (challenged side) and the active-duel banner are unchanged from A3.
import type { IWorld } from '../world_api';
import type { Renderer } from '../render/renderer';

const DUEL_BTN_Y = 3.1; // world height above the selected player's feet (above the MP name tag at 2.4)
const TOAST_MS = 2500; // how long the "Desafio enviado" feedback stays up

export class DuelHud {
  private banner: HTMLDivElement;
  private popup: HTMLDivElement;
  private popupText: HTMLDivElement;
  private challengeBtn: HTMLButtonElement; // floating "Duelar" button over the selected player
  private toast: HTMLDivElement; // transient "Desafio enviado para X" feedback for the challenger
  private toastTimer: ReturnType<typeof setTimeout> | null = null;
  private challengeName: string | null = null; // the selected player's name, read by the button's click

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

    // The floating challenge button reads the CURRENT selected name at click time (set each frame in
    // update), so it can never send a stale target even as the selection changes under it.
    this.challengeBtn = button('duel-challenge-btn', '⚔ Duelar', () => this.sendChallenge());
    this.challengeBtn.style.display = 'none';

    this.toast = el('duel-toast');
    this.toast.style.display = 'none';

    document.body.append(this.banner, this.popup, this.challengeBtn, this.toast);
  }

  // `selectedPlayerId` is the OTHER player the local player left-click-selected (from Input — pure
  // client/UI state, since the sim's target is enemy-only). `renderer` projects that player's head to
  // screen so the button floats over them, exactly like the MP name tags.
  update(world: IWorld, renderer: Renderer, selectedPlayerId: number | null): void {
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

    // Floating "Duelar" button over the selected player. Shows only for a present OTHER player while
    // NOT already dueling; hides when the selection clears, the player leaves, or a duel begins.
    const me = world.localPlayerId();
    const target = selectedPlayerId != null && !duel
      ? world.entities().find((e) => e.id === selectedPlayerId && e.kind === 'player' && e.id !== me)
      : undefined;
    if (!target) {
      this.challengeBtn.style.display = 'none';
      this.challengeName = null;
      return;
    }
    this.challengeName = target.name; // the click handler challenges THIS name
    const p = renderer.project(target.x, DUEL_BTN_Y, target.z);
    if (!p.visible) {
      this.challengeBtn.style.display = 'none'; // off-screen / behind the camera (name kept, so it returns)
      return;
    }
    this.challengeBtn.textContent = `⚔ Duelar ${target.name}`;
    this.challengeBtn.style.display = 'block';
    this.challengeBtn.style.left = `${p.x}px`;
    this.challengeBtn.style.top = `${p.y}px`;
  }

  // Send the challenge to the currently selected player and confirm it on-screen.
  private sendChallenge(): void {
    const name = this.challengeName;
    if (!name) return;
    this.world.sendCommand({ t: 'duel-challenge', name });
    this.showToast(`Desafio enviado para ${name}`);
  }

  private showToast(text: string): void {
    this.toast.textContent = text;
    this.toast.style.display = 'block';
    if (this.toastTimer) clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { this.toast.style.display = 'none'; }, TOAST_MS);
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
    /* Floating challenge button: anchored over the selected player's head (left/top = projected
       point; the transform lifts it above and centers it, like the MP name tags). */
    .duel-challenge-btn { position: fixed; z-index: 44; transform: translate(-50%, -100%);
      display: none; padding: 5px 12px; font: 700 12px/1.1 system-ui, sans-serif; color: #2a0c0e;
      background: #e2849a; border: 1px solid #e2849a; border-radius: 999px; cursor: pointer;
      box-shadow: 0 3px 12px rgba(0,0,0,0.5); pointer-events: auto; white-space: nowrap; }
    .duel-challenge-btn:hover { background: #ec98ac; }
    /* Challenger-side feedback toast (bottom-centre, clear of the top banners/popups). */
    .duel-toast { position: fixed; left: 50%; bottom: 86px; transform: translateX(-50%); z-index: 44;
      display: none; padding: 7px 16px; background: rgba(40,12,14,0.92);
      border: 1px solid rgba(220,90,90,0.8); border-radius: 8px;
      font: 700 13px/1.2 system-ui, sans-serif; color: #ffd0d0; text-shadow: 0 1px 2px #000;
      box-shadow: 0 4px 18px rgba(0,0,0,0.5); pointer-events: none; }
  `;
  document.head.appendChild(s);
}
