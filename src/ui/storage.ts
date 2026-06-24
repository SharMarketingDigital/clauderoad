// K5 — Painel do Armazém (banco da cidade). Grade DUPLA: bolsa (esquerda) ↔ armazém (direita).
// Auto-contido, no espírito de character_sheet.ts / map.ts / party_hud.ts: registra a PRÓPRIA
// tecla (H abre/fecha, Esc fecha) com os guards isTyping()+e.repeat, monta o próprio DOM e fala
// só com a IWorld — NÃO toca o hud.ts além de ser hospedado por ele. Clicar um item da bolsa o
// DEPOSITA; clicar um do armazém o SACA (stack inteiro). Só perto do NPC do armazém
// (storage().inRange) — senão mostra a dica e desabilita os cliques.
import type { IWorld, InventoryView, StorageView, ItemStackView } from '../world_api';
import { isTyping } from './typing';

export class StoragePanel {
  private root: HTMLDivElement;
  private hint: HTMLDivElement;
  private bagTitle: HTMLDivElement;
  private storeTitle: HTMLDivElement;
  private bagGrid: HTMLDivElement;
  private storeGrid: HTMLDivElement;
  private bagSlots: HTMLDivElement[] = [];
  private storeSlots: HTMLDivElement[] = [];
  private open = false;
  private world: IWorld | null = null;
  private lastInv: InventoryView | null = null;
  private lastStore: StorageView | null = null;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'storage';
    this.root.hidden = true;
    // estrutura ESTÁTICA via innerHTML (sem dados de entidade); os rótulos com dados usam
    // textContent (regra anti-injeção do HUD).
    this.root.innerHTML = `
      <div class="storage-titlebar">Armazém</div>
      <div class="storage-hint"></div>
      <div class="storage-dual">
        <div class="storage-col">
          <div class="storage-col-title bag-title"></div>
          <div class="storage-grid bag-side"></div>
        </div>
        <div class="storage-col">
          <div class="storage-col-title store-title"></div>
          <div class="storage-grid store-side"></div>
        </div>
      </div>
    `;
    document.body.appendChild(this.root);
    this.hint = this.root.querySelector('.storage-hint') as HTMLDivElement;
    this.bagTitle = this.root.querySelector('.bag-title') as HTMLDivElement;
    this.storeTitle = this.root.querySelector('.store-title') as HTMLDivElement;
    this.bagGrid = this.root.querySelector('.bag-side') as HTMLDivElement;
    this.storeGrid = this.root.querySelector('.store-side') as HTMLDivElement;

    // própria hotkey (H), mesmos guards do HUD: não repete a tecla nem dispara digitando no chat.
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (isTyping()) return;
      if (e.key.toLowerCase() === 'h') this.setOpen(!this.open);
      else if (e.key === 'Escape') this.setOpen(false);
    });
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.hidden = !open;
  }

  // O Hud chama isto a cada frame enquanto o painel está aberto (passando a IWorld).
  update(world: IWorld): void {
    this.world = world;
    const inv = world.inventory();
    const store = world.storage();
    this.lastInv = inv;
    this.lastStore = store;

    this.hint.textContent = store.inRange
      ? 'Clique um item para guardá-lo / retirá-lo (stack inteiro).'
      : 'Aproxime-se do armazém para depositar e sacar.';
    this.bagTitle.textContent = `Bolsa (${inv.stacks.length}) — clique p/ guardar`;
    this.storeTitle.textContent = `${store.name || 'Armazém'} (${store.stacks.length}/${store.capacity}) — clique p/ retirar`;

    // capacidade lida da view A CADA frame (online o 1º frame vem vazio antes do snapshot).
    this.fillGrid(this.bagGrid, this.bagSlots, inv.stacks, inv.capacity, store.inRange, (i) => this.onBagClick(i));
    this.fillGrid(this.storeGrid, this.storeSlots, store.stacks, store.capacity, store.inRange, (i) => this.onStoreClick(i));
  }

  // "build once, update in place": cria as células uma vez (cresce com a capacidade), depois só
  // atualiza — os handlers leem o stack ATUAL por índice (lastInv/lastStore) no clique.
  private fillGrid(
    grid: HTMLDivElement,
    slots: HTMLDivElement[],
    stacks: ReadonlyArray<ItemStackView>,
    capacity: number,
    enabled: boolean,
    onClick: (i: number) => void,
  ): void {
    while (slots.length < capacity) {
      const i = slots.length;
      const slot = document.createElement('div');
      slot.className = 'bag-slot'; // reusa todo o visual de célula da bolsa (tamanho, borda, raridade)
      slot.addEventListener('click', () => onClick(i));
      grid.appendChild(slot);
      slots.push(slot);
    }
    for (let i = 0; i < slots.length; i++) {
      const slot = slots[i];
      const st = stacks[i];
      if (st) {
        slot.classList.add('filled');
        slot.classList.toggle('disabled', !enabled); // longe do armazém: célula esmaecida, clique inerte
        slot.dataset.rarity = st.rarity; // a cor da borda/texto vem da raridade (+ o nome, não só cor)
        const label = `${st.name}${st.plus > 0 ? ` +${st.plus}` : ''}`;
        slot.textContent = st.qty > 1 ? `${label} ×${st.qty}` : label;
      } else {
        slot.classList.remove('filled', 'disabled');
        delete slot.dataset.rarity;
        slot.textContent = '';
      }
    }
  }

  private onBagClick(i: number): void {
    const st = this.lastInv?.stacks[i];
    if (st && this.world && this.lastStore?.inRange) {
      this.world.sendCommand({ t: 'deposit', itemId: st.itemId, rarity: st.rarity, plus: st.plus });
    }
  }

  private onStoreClick(i: number): void {
    const st = this.lastStore?.stacks[i];
    if (st && this.world && this.lastStore?.inRange) {
      this.world.sendCommand({ t: 'withdraw', itemId: st.itemId, rarity: st.rarity, plus: st.plus });
    }
  }
}
