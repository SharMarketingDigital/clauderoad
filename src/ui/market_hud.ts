// Global Marketplace — a central buy/sell board, reachable from ANYWHERE (toggle with J). Top: every
// active listing (Buy on others', Cancel on your own). Bottom: your bag — click an item, set a per-unit
// price (browser prompt), and it's listed globally. Pure presentation — reads IWorld + sends market-* ;
// the sim re-validates ownership/gold and moves item + gold atomically (anti-dup). Wired into the online
// loop (the market is a multiplayer exchange). MVP UI; the seller must be online (async/offline = later).
import type { IWorld, ItemStackView, Rarity } from '../world_api';
import { isTyping } from './typing';

const RARITY_COLOR: Record<Rarity, string> = {
  normal: '#cdd5e0', sos: '#bfe0ff', som: '#e6ccff', sun: '#ffe9a8',
};

export class MarketHud {
  private panel = document.createElement('div');
  private open = false;

  constructor() {
    this.panel.style.cssText = [
      'position:absolute', 'top:56px', 'left:50%', 'transform:translateX(-50%)', 'width:380px',
      'max-height:70vh', 'overflow:auto', 'padding:12px 14px', 'border-radius:8px',
      'font:500 13px system-ui,sans-serif', 'color:#eef3ff', 'background:rgba(12,16,24,0.95)',
      'border:1px solid rgba(120,160,220,0.5)', 'z-index:35', 'display:none', 'box-shadow:0 6px 22px rgba(0,0,0,0.55)',
    ].join(';');
    document.body.append(this.panel);
    // J toggles the market (ignored while typing). J is free (P=party, B=bot, H=warehouse, F=pet, N=stall, O=pet bag).
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'j' && !isTyping() && !e.repeat) {
        this.open = !this.open;
        if (!this.open) this.panel.style.display = 'none';
      }
    });
  }

  update(world: IWorld): void {
    if (!this.open) { this.panel.style.display = 'none'; return; }
    this.panel.style.display = 'block';
    const market = world.market();
    this.panel.replaceChildren(title('Mercado Global (J fecha)'));

    // Mailbox: sale proceeds (and any returned/unsold items) waiting to be collected.
    if (market.mailboxGold > 0 || market.mailboxItems > 0) {
      const mb = document.createElement('div');
      mb.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:4px 0 8px;padding:6px 8px;border-radius:6px;background:rgba(40,60,40,0.55);';
      const lbl = document.createElement('span');
      lbl.textContent = `📬 Proventos: ${market.mailboxGold}g${market.mailboxItems > 0 ? ` + ${market.mailboxItems} item(ns)` : ''}`;
      lbl.style.cssText = 'color:#7ee0a0;font-weight:600;';
      mb.append(lbl, button('Coletar', () => world.sendCommand({ t: 'market-collect' })));
      this.panel.append(mb);
    }

    if (market.listings.length === 0) {
      const empty = document.createElement('div');
      empty.textContent = 'Nenhum item à venda no momento.';
      empty.style.cssText = 'color:#9fb0c8;font-size:12px;';
      this.panel.append(empty);
    }
    for (const it of market.listings) {
      const row = document.createElement('div');
      row.style.cssText = 'display:flex;align-items:center;justify-content:space-between;gap:8px;margin:5px 0;';
      const label = document.createElement('span');
      label.textContent = `${it.name}${it.plus > 0 ? ` +${it.plus}` : ''} ×${it.qty} — ${it.price}g  · ${it.sellerName}`;
      label.style.color = RARITY_COLOR[it.rarity];
      const btn = it.own
        ? button('Cancelar', () => world.sendCommand({ t: 'market-cancel', listingId: it.id }))
        : button(`Comprar ${it.price}g`, () => world.sendCommand({ t: 'market-buy', listingId: it.id }));
      row.append(label, btn);
      this.panel.append(row);
    }

    this.panel.append(section('Vender — clique num item da bolsa pra listar'));
    for (const st of world.inventory().stacks) {
      if (st.itemId === 'pet_grab') continue; // don't sell the pet token by accident
      this.panel.append(itemRow(st, () => {
        const raw = window.prompt(`Preço por unidade de ${st.name} (gold):`, '');
        if (raw == null) return;
        const price = Math.floor(Number(raw));
        if (Number.isInteger(price) && price > 0) {
          world.sendCommand({ t: 'market-list', itemId: st.itemId, rarity: st.rarity, plus: st.plus, price });
        }
      }));
    }
  }
}

function title(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = 'font-weight:700;color:#ffe9a8;margin-bottom:8px;border-bottom:1px solid rgba(120,160,220,0.3);padding-bottom:5px;';
  return d;
}
function section(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = 'color:#9fb0c8;font-size:11px;margin:10px 0 3px;text-transform:uppercase;letter-spacing:0.04em;';
  return d;
}
function itemRow(st: ItemStackView, onClick: () => void): HTMLDivElement {
  const row = document.createElement('div');
  row.style.cssText = 'padding:3px 6px;margin:2px 0;border-radius:5px;cursor:pointer;background:rgba(30,40,60,0.5);';
  row.textContent = `${st.name}${st.plus > 0 ? ` +${st.plus}` : ''} ×${st.qty}`;
  row.style.color = RARITY_COLOR[st.rarity];
  row.onclick = onClick;
  return row;
}
function button(text: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement('button');
  b.textContent = text;
  b.style.cssText = 'padding:4px 10px;border-radius:6px;border:1px solid rgba(120,160,220,0.6);' +
    'background:rgba(30,40,60,0.9);color:#eef3ff;font:600 12px system-ui,sans-serif;cursor:pointer;white-space:nowrap;';
  b.onclick = onClick;
  return b;
}
