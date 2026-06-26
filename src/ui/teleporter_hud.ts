// Teleporter UI (GDD v0.5 TP3, presentation only). Reads the local player's TeleporterView from IWorld
// (the city list + fixed cost, the registered Return city, and Return readiness) and SENDS the
// teleport / register-city / return commands the sim validates — it never decides anything itself.
//
// Two pieces:
//   • the hub MENU — opens when the player LEFT-CLICKS a teleporter NPC (Input hands us that one-shot
//     click); lists the cities to travel to (with the fixed gold cost) and a "Cadastrar nesta cidade"
//     button. Gated by being AT a hub (the view's `inRange`); closes on Esc / ✕ / walking away.
//   • the RETURN button — always in the HUD (Return works anywhere); enabled only when the view says
//     it's ready, otherwise greyed with the reason (combat / cooldown). One click = recall.
import type { IWorld } from '../world_api';
import type { Input } from '../game/input';
import { registerOverlay } from './overlays';

export class TeleporterHud {
  private menu: HTMLDivElement;
  private registeredLine: HTMLDivElement;
  private registerBtn: HTMLButtonElement;
  private cityList: HTMLDivElement;
  private returnBtn: HTMLButtonElement;
  private menuOpen = false;
  private cityIds: string[] = []; // ids backing the built city buttons (rebuilt only if the set changes)

  constructor(private readonly world: IWorld) {
    injectStyle();

    // Always-visible Return (recall) button. Works anywhere; the sim gates cooldown + combat.
    this.returnBtn = button('tp-return-btn', '↩ Return', () => this.world.sendCommand({ t: 'return' }));

    // The hub menu (hidden until you click a teleporter NPC).
    this.menu = el('tp-menu');
    this.menu.style.display = 'none';
    const title = el('tp-title');
    title.textContent = 'Teleporte';
    const close = button('tp-close', '✕', () => this.setOpen(false));
    title.append(close);
    this.registeredLine = el('tp-registered');
    this.registerBtn = button('tp-btn', 'Cadastrar nesta cidade', () => this.world.sendCommand({ t: 'register-city' }));
    const citiesLabel = el('tp-cities-label');
    citiesLabel.textContent = 'Viajar para:';
    this.cityList = el('tp-cities');
    this.menu.append(title, this.registeredLine, this.registerBtn, citiesLabel, this.cityList);

    document.body.append(this.returnBtn, this.menu);

    window.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.menuOpen) { e.preventDefault(); this.setOpen(false); }
    });
    // ESC priority: while the menu is open, the central Esc menu must not also pop.
    registerOverlay(() => this.menuOpen);
  }

  // Called once per frame from the host loop. `input` provides the one-shot "clicked a teleporter NPC"
  // signal; `world.teleporter()` provides all the live state.
  update(world: IWorld, input: Input): void {
    const v = world.teleporter();
    // Clicking a teleporter NPC opens the menu — but only when actually AT a hub, so a raycast that
    // passes through a distant NPC doesn't pop an empty menu.
    if (input.takeTeleporterClick() && v.inRange) this.setOpen(true);
    if (this.menuOpen && !v.inRange) this.setOpen(false); // walked away from the hub

    // --- Return button (always visible) ---
    this.returnBtn.disabled = !v.returnReady;
    // Show the blocked reason only when there IS one; the connecting/empty state (no reason) just reads "Return".
    this.returnBtn.textContent = !v.returnReady && v.returnBlockedReason ? `↩ Return — ${v.returnBlockedReason}` : '↩ Return';

    if (!this.menuOpen) return;

    // --- menu contents (build the city buttons once; then update text/disabled in place) ---
    const regName = v.cities.find((c) => c.id === v.registeredCityId)?.name ?? v.registeredCityId;
    this.registeredLine.textContent = `Cadastrado em: ${regName}`;
    this.registerBtn.disabled = !v.inRange;

    const ids = v.cities.map((c) => c.id);
    if (JSON.stringify(ids) !== JSON.stringify(this.cityIds)) this.rebuildCities(ids); // robust vs any id contents

    for (let i = 0; i < v.cities.length; i++) {
      const c = v.cities[i];
      const btn = this.cityList.children[i] as HTMLButtonElement;
      btn.textContent = c.current ? `${c.name} — você está aqui` : `${c.name} — ${c.cost} ouro`;
      btn.disabled = c.current || !v.inRange; // can't travel to yourself, or while not at a hub
    }
  }

  private setOpen(open: boolean): void {
    this.menuOpen = open;
    this.menu.style.display = open ? 'block' : 'none';
  }

  // (Re)build one button per city. Each captures its city id; the sim validates proximity/gold/dest.
  private rebuildCities(ids: string[]): void {
    this.cityIds = ids;
    this.cityList.replaceChildren();
    for (const id of ids) {
      this.cityList.append(button('tp-city-btn', '', () => this.world.sendCommand({ t: 'teleport', cityId: id })));
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
  if (document.getElementById('tp-style')) return;
  const s = document.createElement('style');
  s.id = 'tp-style';
  s.textContent = `
    /* Always-visible Return (recall) button. Teal theme to match the teleporter hub. */
    .tp-return-btn { position: fixed; right: 18px; bottom: 150px; z-index: 40; pointer-events: auto;
      padding: 7px 14px; font: 700 12px/1.1 system-ui, sans-serif; color: #06222b;
      background: #6fd3e6; border: 1px solid #6fd3e6; border-radius: 999px; cursor: pointer;
      box-shadow: 0 3px 12px rgba(0,0,0,0.5); white-space: nowrap; }
    .tp-return-btn:hover:not(:disabled) { background: #8fe0ef; }
    .tp-return-btn:disabled { color: #9fb6bd; background: rgba(20,34,40,0.92);
      border-color: rgba(111,211,230,0.35); cursor: default; }
    /* Hub menu: a centred panel (opened by clicking the teleporter NPC). */
    .tp-menu { position: fixed; left: 50%; top: 50%; transform: translate(-50%, -50%); z-index: 45;
      display: none; width: min(320px, 86vw); padding: 14px 16px; background: rgba(12,24,30,0.97);
      border: 1px solid rgba(111,211,230,0.7); border-radius: 12px; box-shadow: 0 8px 30px rgba(0,0,0,0.55); }
    .tp-title { display: flex; align-items: center; justify-content: space-between;
      font: 800 15px/1.2 system-ui, sans-serif; color: #c8f3ff; letter-spacing: 0.02em;
      text-shadow: 0 1px 2px #000; margin-bottom: 10px; }
    .tp-close { pointer-events: auto; width: 24px; height: 24px; padding: 0; line-height: 1;
      font: 700 13px/1 system-ui, sans-serif; color: #c8f3ff; background: rgba(30,50,58,0.9);
      border: 1px solid rgba(111,211,230,0.5); border-radius: 6px; cursor: pointer; }
    .tp-close:hover { background: rgba(44,70,80,0.95); }
    .tp-registered { font: 600 12px/1.4 system-ui, sans-serif; color: #bfe9ff; margin-bottom: 10px;
      text-shadow: 0 1px 2px #000; }
    .tp-cities-label { font: 700 11px/1.2 system-ui, sans-serif; color: #8fb6c2;
      text-transform: uppercase; letter-spacing: 0.06em; margin: 12px 0 6px; }
    .tp-cities { display: flex; flex-direction: column; gap: 6px; }
    .tp-btn, .tp-city-btn { pointer-events: auto; width: 100%; padding: 8px 12px; text-align: left;
      font: 600 13px/1.2 system-ui, sans-serif; color: #06222b; background: #6fd3e6;
      border: 1px solid #6fd3e6; border-radius: 8px; cursor: pointer; }
    .tp-btn:hover:not(:disabled), .tp-city-btn:hover:not(:disabled) { background: #8fe0ef; }
    .tp-btn:disabled, .tp-city-btn:disabled { color: #9fb6bd; background: rgba(20,34,40,0.92);
      border-color: rgba(111,211,230,0.35); cursor: default; }
  `;
  document.head.appendChild(s);
}
