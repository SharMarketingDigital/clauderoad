// Pets PET2 (GDD v0.5 §4) — the TRANSPORT pet's portable bag UI. Toggle with O: while a pet is summoned
// (F), it's an extra bag that travels with you (carry more loot before a town run). Two lists: what's in
// the pet (click to take back) and your bag (click to stow in the pet). Pure presentation — reads IWorld +
// sends pet-deposit / pet-withdraw; the sim re-validates ownership + that a pet is out. Works offline + MP.
import type { IWorld, ItemStackView, Rarity } from '../world_api';
import { isTyping } from './typing';

const RARITY_COLOR: Record<Rarity, string> = {
  normal: '#cdd5e0', sos: '#bfe0ff', som: '#e6ccff', sun: '#ffe9a8',
};

export class PetBagHud {
  private panel = document.createElement('div');
  private open = false;

  constructor() {
    this.panel.style.cssText = [
      'position:absolute', 'top:64px', 'left:330px', 'width:280px', 'max-height:60vh', 'overflow:auto',
      'padding:10px 12px', 'border-radius:8px', 'font:500 13px system-ui,sans-serif', 'color:#eef3ff',
      'background:rgba(12,16,24,0.92)', 'border:1px solid rgba(70,214,176,0.5)', 'z-index:34',
      'display:none', 'box-shadow:0 4px 18px rgba(0,0,0,0.5)',
    ].join(';');
    document.body.append(this.panel);
    // O toggles the pet bag (ignored while typing). O is free (P=party, B=bot, H=warehouse, F=pet, N=stall).
    window.addEventListener('keydown', (e) => {
      if (e.key.toLowerCase() === 'o' && !isTyping() && !e.repeat) {
        this.open = !this.open;
        if (!this.open) this.panel.style.display = 'none';
      }
    });
  }

  update(world: IWorld): void {
    if (!this.open) { this.panel.style.display = 'none'; return; }
    this.panel.style.display = 'block';
    const pb = world.petBag();
    this.panel.replaceChildren(title('Mochila do Pet (O fecha)'));
    if (!pb.available) {
      const hint = document.createElement('div');
      hint.textContent = 'Invoque um pet (F) pra acessar a mochila.';
      hint.style.cssText = 'color:#9fb0c8;font-size:12px;';
      this.panel.append(hint);
      return;
    }
    this.panel.append(section(`No pet (${pb.stacks.length}/${pb.capacity}) — clique pra tirar`));
    for (const st of pb.stacks) {
      this.panel.append(itemRow(st, () => world.sendCommand({ t: 'pet-withdraw', itemId: st.itemId, rarity: st.rarity, plus: st.plus })));
    }
    this.panel.append(section('Na bolsa — clique pra guardar no pet'));
    for (const st of world.inventory().stacks) {
      this.panel.append(itemRow(st, () => world.sendCommand({ t: 'pet-deposit', itemId: st.itemId, rarity: st.rarity, plus: st.plus })));
    }
  }
}

function title(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = 'font-weight:700;color:#7ee0c0;margin-bottom:8px;border-bottom:1px solid rgba(70,214,176,0.3);padding-bottom:5px;';
  return d;
}
function section(text: string): HTMLDivElement {
  const d = document.createElement('div');
  d.textContent = text;
  d.style.cssText = 'color:#9fb0c8;font-size:11px;margin:8px 0 3px;text-transform:uppercase;letter-spacing:0.04em;';
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
