// Connection overlay (online only) — covers the world until the first server snapshot arrives, so a
// new player never stares at an empty world wondering if the game is broken. Reads the ClientWorld's
// connection lifecycle (status / everConnected / gotSnapshot / gaveUp) each frame and shows:
//   • "Conectando ao servidor…" (spinner) on the first connect — with a note the server may be waking;
//   • "Conexão perdida — reconectando…" if a live session drops (auto-reconnect with backoff);
//   • "Não foi possível conectar" + a "Tentar de novo" button once auto-reconnect gives up.
// Pure UI; it never touches the sim. z-index 55 sits ABOVE the HUD/canvas but BELOW the name/class
// modals (z-60), so picking a name/class still works while the socket opens in the background.
import type { ClientWorld } from '../net/client_world';

export class ConnectionOverlay {
  private readonly root: HTMLDivElement;
  private readonly titleEl: HTMLDivElement;
  private readonly subEl: HTMLDivElement;
  private readonly spinner: HTMLDivElement;
  private readonly retryBtn: HTMLButtonElement;
  private shown = false;

  constructor(world: ClientWorld) {
    injectStyle();
    this.root = document.createElement('div');
    this.root.className = 'conn-overlay';
    this.spinner = div('conn-spinner');
    this.titleEl = div('conn-title');
    this.subEl = div('conn-sub');
    this.retryBtn = document.createElement('button');
    this.retryBtn.className = 'conn-retry';
    this.retryBtn.type = 'button';
    // A taken name can't be retried (it would just be refused again) — reload to the name screen instead.
    this.retryBtn.onclick = () => (world.rejectedReason != null ? window.location.reload() : world.retry());
    const box = div('conn-box');
    box.append(this.spinner, this.titleEl, this.subEl, this.retryBtn);
    this.root.append(box);
    this.root.style.display = 'none';
    document.body.append(this.root);
  }

  update(world: ClientWorld): void {
    const ready = world.status === 'online' && world.gotSnapshot;
    if (ready) {
      if (this.shown) {
        this.root.style.display = 'none';
        this.shown = false;
      }
      return;
    }
    if (!this.shown) {
      this.root.style.display = 'grid';
      this.shown = true;
    }
    if (world.rejectedReason === 'name-taken') {
      this.titleEl.textContent = 'Esse nome já está em uso';
      this.subEl.textContent = 'Outro jogador online está usando esse nome. Escolha outro para entrar.';
      this.spinner.style.display = 'none';
      this.retryBtn.textContent = 'Trocar de nome';
      this.retryBtn.style.display = 'inline-block';
    } else if (world.gaveUp) {
      this.titleEl.textContent = 'Não foi possível conectar';
      this.subEl.textContent = 'O servidor pode estar dormindo ou indisponível. Tente novamente em instantes.';
      this.spinner.style.display = 'none';
      this.retryBtn.textContent = 'Tentar de novo';
      this.retryBtn.style.display = 'inline-block';
    } else {
      this.titleEl.textContent = world.everConnected ? 'Conexão perdida — reconectando…' : 'Conectando ao servidor…';
      this.subEl.textContent = 'O servidor pode levar alguns segundos para acordar.';
      this.spinner.style.display = 'block';
      this.retryBtn.style.display = 'none';
    }
  }
}

function div(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}

function injectStyle(): void {
  if (document.getElementById('conn-style')) return;
  const s = document.createElement('style');
  s.id = 'conn-style';
  s.textContent = `
    .conn-overlay { position: fixed; inset: 0; z-index: 55; display: none; place-items: center;
      background: rgba(6,9,14,0.92); backdrop-filter: blur(3px); font-family: system-ui, sans-serif; }
    .conn-box { display: flex; flex-direction: column; align-items: center; gap: 12px; padding: 30px 40px;
      text-align: center; max-width: min(440px, 90vw); }
    .conn-spinner { width: 38px; height: 38px; border-radius: 50%;
      border: 4px solid rgba(255,210,74,0.18); border-top-color: #ffd24a; animation: conn-spin 0.9s linear infinite; }
    .conn-title { font: 800 22px/1.2 system-ui, sans-serif; color: #ffd24a; }
    .conn-sub { font: 500 14px/1.5 system-ui, sans-serif; color: #b8c6dc; }
    .conn-retry { margin-top: 6px; padding: 9px 20px; cursor: pointer; font: 700 14px/1 system-ui, sans-serif;
      color: #0c1018; background: #ffd24a; border: none; border-radius: 9px; transition: filter 0.1s; }
    .conn-retry:hover { filter: brightness(1.08); }
    @keyframes conn-spin { to { transform: rotate(360deg); } }
  `;
  document.head.appendChild(s);
}
