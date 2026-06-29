// Stalls (GDD v0.5 §5) — a personal-shop UI. Two parts:
//  • "Minha Barraca" (toggle with N): your bag items; click one to set a price (themed dialog), then
//    "Abrir barraca" lists them all. The sim validates ownership + price; "Fechar barraca" takes it down.
//  • "Comprar" (auto-shows when you stand next to a seller's open stall): the seller's items with a buy
//    button each. The sim moves item + gold ATOMICALLY (anti-dup) on the click.
// Pure presentation — reads IWorld + sends commands; never touches the sim. Inline-styled + self-contained,
// like the duel/pk HUDs. Wired into the online loop (P2P needs two players).
import type { IWorld, Rarity } from '../world_api';
import { isTyping } from './typing';
import { askPrice } from './price_prompt';

// Stack identity for the pending-listing map (matches the sim's stack key).
function key(itemId: string, rarity: Rarity, plus: number): string {
  return `${itemId}|${rarity}|${plus}`;
}

const RARITY_COLOR: Record<Rarity, string> = {
  normal: '#cdd5e0', sos: '#bfe0ff', som: '#e6ccff', sun: '#ffe9a8',
};

export class StallHud {
  private own = document.createElement('div'); // "Minha Barraca" panel (toggled with N)
  private buy = document.createElement('div'); // "Comprar" panel (auto when near a stall)
  private ownOpen = false;
  // Pending listings the player is assembling before opening the stall: stack key -> { ref, price }.
  private pending = new Map<string, { itemId: string; rarity: Rarity; plus: number; price: number }>();

  constructor() {
    for (const p of [this.own, this.buy]) {
      p.style.cssText = [
        'position:absolute', 'top:64px', 'width:300px', 'max-height:60vh', 'overflow:auto',
        'padding:10px 12px', 'border-radius:8px', 'font:500 13px system-ui,sans-serif', 'color:#eef3ff',
        'background:rgba(12,16,24,0.92)', 'border:1px solid rgba(120,160,220,0.5)', 'z-index:34',
        'display:none', 'box-shadow:0 4px 18px rgba(0,0,0,0.5)',
      ].join(';');
      document.body.append(p);
    }
    this.own.style.left = '16px';
    this.buy.style.right = '16px';

    // N toggles your own stall panel (ignored while typing). (N, not B: B is the bot toggle — ui/hud.ts.)
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'n' && !isTyping() && !e.repeat) {
        this.ownOpen = !this.ownOpen;
        if (!this.ownOpen) this.own.style.display = 'none';
      }
    });
  }

  update(world: IWorld): void {
    this.renderBuy(world);
    this.renderOwn(world);
  }

  // The buy panel: auto-shown when the local player is in range of a seller's open stall.
  private renderBuy(world: IWorld): void {
    const stall = world.stall();
    if (!stall || stall.entries.length === 0) { this.buy.style.display = 'none'; return; }
    this.buy.style.display = 'block';
    this.buy.replaceChildren(title(`Barraca de ${stall.sellerName}`));
    for (const it of stall.entries) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:5px 0;';
      const label = document.createElement('span');
      label.textContent = `${it.name}${it.plus > 0 ? ` +${it.plus}` : ''} ×${it.qty}`;
      label.style.color = RARITY_COLOR[it.rarity];
      const btn = button(`Comprar ${it.price}g`, () =>
        world.sendCommand({ t: 'stall-buy', sellerId: stall.sellerId, itemId: it.itemId, rarity: it.rarity, plus: it.plus }));
      row.append(label, btn);
      this.buy.append(row);
    }
  }

  // The own-stall panel: your bag items + the prices you set, and open/close buttons.
  private renderOwn(world: IWorld): void {
    if (!this.ownOpen) { this.own.style.display = 'none'; return; }
    this.own.style.display = 'block';
    const mySent = this.isMyStallOpen(world);
    this.own.replaceChildren(title('Minha Barraca (N fecha)'));
    const hint = document.createElement('div');
    hint.style.cssText = 'color:#9fb0c8;font-size:12px;margin-bottom:6px;';
    hint.textContent = mySent ? 'Barraca ABERTA. Fique perto de outro jogador pra vender.'
                              : 'Clique num item pra definir o preço, depois "Abrir barraca".';
    this.own.append(hint);

    for (const st of world.inventory().stacks) {
      if (st.itemId === 'pet_grab') continue; // don't sell the pet token by accident
      const k = key(st.itemId, st.rarity, st.plus);
      const priced = this.pending.get(k);
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0;cursor:pointer;';
      const label = document.createElement('span');
      label.textContent = `${st.name}${st.plus > 0 ? ` +${st.plus}` : ''} ×${st.qty}${priced ? `  →  ${priced.price}g` : ''}`;
      label.style.color = priced ? '#7ee0a0' : RARITY_COLOR[st.rarity];
      row.append(label);
      row.onclick = () => this.promptPrice(st.itemId, st.rarity, st.plus);
      this.own.append(row);
    }

    const actions = document.createElement('div');
    actions.style.cssText = 'display:flex;gap:8px;margin-top:10px;';
    actions.append(
      button(`Abrir barraca (${this.pending.size})`, () => {
        world.sendCommand({ t: 'stall-open', listings: [...this.pending.values()] });
      }),
      button('Fechar barraca', () => {
        this.pending.clear();
        world.sendCommand({ t: 'stall-close' });
      }),
    );
    this.own.append(actions);
  }

  // Set/clear the asking price for a bag stack (a 0 / blank / invalid price removes it from the listing).
  private promptPrice(itemId: string, rarity: Rarity, plus: number): void {
    const k = key(itemId, rarity, plus);
    askPrice({
      title: 'Preço de venda',
      hint: '0 remove o item da barraca',
      initial: this.pending.get(k)?.price,
      allowZero: true,
      confirmLabel: 'OK',
      onSubmit: (price) => {
        if (price > 0) this.pending.set(k, { itemId, rarity, plus, price });
        else this.pending.delete(k);
      },
    });
  }

  // Is the local player's OWN stall currently open? Read off its public entity flag.
  private isMyStallOpen(world: IWorld): boolean {
    const id = world.localPlayerId();
    if (id == null) return false;
    return world.entities().find((e) => e.id === id)?.stallOpen === true;
  }
}

function title(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = 'font-weight:700;color:#ffe9a8;margin-bottom:8px;border-bottom:1px solid rgba(120,160,220,0.3);padding-bottom:5px;';
  return d;
}

function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = 'padding:4px 10px;border-radius:6px;border:1px solid rgba(120,160,220,0.6);' +
    'background:rgba(30,40,60,0.9);color:#eef3ff;font:600 12px system-ui,sans-serif;cursor:pointer;';
  b.onclick = onClick;
  return b;
}
