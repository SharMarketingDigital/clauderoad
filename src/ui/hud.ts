// Minimal classic-style HUD. Reads the world via IWorld; draws DOM, no framework.
import type { IWorld, AbilityView, InventoryView, EntityView, ShopView } from '../world_api';
import { isTyping } from './typing';
import { SLOT_LABELS } from './inventory';
import { CharacterSheet } from './character_sheet';

export class Hud {
  private root: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpText: HTMLSpanElement;
  private mpFill: HTMLDivElement;
  private mpText: HTMLSpanElement;
  private levelBadge: HTMLSpanElement;
  private xpFill: HTMLDivElement;
  private xpText: HTMLSpanElement;
  private announceEl: HTMLDivElement; // center-screen boss announcements
  // target frame (shown only while an enemy is selected)
  private targetFrame: HTMLDivElement;
  private targetName: HTMLSpanElement;
  private targetHpFill: HTMLDivElement;
  private targetHpText: HTMLSpanElement;
  // action bar: slot number -> its DOM refs (built lazily from world.abilities())
  private actionBar: HTMLDivElement;
  private slots = new Map<number, { root: HTMLDivElement; cd: HTMLDivElement }>();
  private lastBarSig = ''; // rebuild the bar when the active kit changes (weapon swap)
  // gold + inventory window (toggled with I; pure UI state, not a world command)
  private goldAmt: HTMLSpanElement;
  private bag: HTMLDivElement;
  private bagTitle: HTMLDivElement;
  private bagGrid: HTMLDivElement;
  private bagSlots: HTMLDivElement[] = [];
  private bagStats: HTMLDivElement;
  // attribute spending (inside the bag window)
  private attrPointsEl: HTMLSpanElement;
  private attrStrBtn: HTMLButtonElement;
  private attrIntBtn: HTMLButtonElement;
  private equipRow: HTMLDivElement;
  private equipCells: HTMLDivElement[] = [];
  // alchemy ("+N") controls inside the bag window
  private refineRow: HTMLDivElement;
  private refineBtns: HTMLButtonElement[] = [];
  private luckyToggle: HTMLButtonElement;
  private protectToggle: HTMLButtonElement;
  private matLine: HTMLDivElement;
  private luckyOn = false; // UI state: whether to spend a Lucky Powder
  private protectOn = false; // UI state (K4): whether to spend a Pedra de Proteção
  private bagOpen = false;
  // vendor shop window (toggled with V)
  private shopEl: HTMLDivElement;
  private shopTitle: HTMLDivElement;
  private shopHint: HTMLDivElement;
  private shopBuy: HTMLDivElement;
  private shopSell: HTMLDivElement;
  private shopRepair: HTMLDivElement; // vendor repair buttons for worn equipped gear (GDD B8)
  private shopOpen = false;
  // Buy/sell/repair buttons are built ONCE and updated in place (the same robust pattern
  // as the bag), so a refresh never destroys a button mid-click and the player's clicks
  // stay reliable. Handlers read the CURRENT data by index (lastShopStock / lastInv) at
  // click time, so they never go stale.
  private shopBuyCells: HTMLButtonElement[] = [];
  private shopSellCells: HTMLButtonElement[] = [];
  private shopRepairCells: HTMLButtonElement[] = [];
  private lastShopStock: ShopView['stock'] | null = null;
  // SP wallet + skills panel (toggled with K): spend SP to rank up abilities (GDD B4)
  private spAmt: HTMLSpanElement;
  private skillsEl: HTMLDivElement;
  private skillsSp: HTMLSpanElement;
  private skillsList: HTMLDivElement;
  private skillsOpen = false;
  private lastSkillsSig = '';
  // auto-play (bot) toggle + indicator
  private botToggleBtn: HTMLButtonElement;
  private botIndicator: HTMLDivElement;
  // latest world + inventory, captured each frame so click handlers (equip /
  // unequip) can send commands against the current state.
  private world: IWorld | null = null;
  private lastInv: InventoryView | null = null;
  // K6 — ficha de personagem (tecla C); auto-contida, registra a própria hotkey e lê o EntityView.
  private sheet = new CharacterSheet();

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="unit-frame">
        <div class="portrait">&#9733;</div>
        <div class="bars">
          <span class="name">Hero</span><span class="level"></span>
          <div class="hp"><div class="hp-fill"></div><span class="hp-text"></span></div>
          <div class="mp"><div class="mp-fill"></div><span class="mp-text"></span></div>
          <div class="xp"><div class="xp-fill"></div><span class="xp-text"></span></div>
        </div>
      </div>
      <div class="unit-frame target-frame" hidden>
        <div class="portrait portrait-target">&#9876;</div>
        <div class="bars">
          <span class="name target-name"></span>
          <div class="hp"><div class="hp-fill target-hp-fill"></div><span class="hp-text target-hp-text"></span></div>
        </div>
      </div>
      <div class="gold">&#9679; <span class="gold-amt">0</span></div>
      <div class="sp-line">SP <span class="sp-amt">0</span></div>
      <button class="bot-toggle">Bot: OFF (B)</button>
      <div class="bot-indicator" hidden>&#9679; AUTO-PLAY</div>
      <div class="action-bar"></div>
      <div class="bag" hidden>
        <div class="bag-title">Bolsa</div>
        <div class="equip-row"></div>
        <div class="bag-stats"></div>
        <div class="attrs">
          <span class="attr-points"></span>
          <button class="attr-btn attr-str">+ Força</button>
          <button class="attr-btn attr-int">+ Inteligência</button>
        </div>
        <div class="alchemy">
          <button class="lucky-toggle">Pó da Sorte: OFF</button>
          <button class="protect-toggle">Proteção: OFF</button>
          <div class="refine-row"></div>
          <div class="mat-line"></div>
        </div>
        <div class="bag-grid"></div>
      </div>
      <div class="shop" hidden>
        <div class="shop-title"></div>
        <div class="shop-hint"></div>
        <div class="shop-repair"></div>
        <div class="shop-buy"></div>
        <div class="shop-sell"></div>
      </div>
      <div class="skills" hidden>
        <div class="skills-title">Habilidades — SP: <span class="skills-sp">0</span></div>
        <div class="skills-list"></div>
      </div>
      <div class="hint">WASD mover &middot; Tab/clique alvo &middot; 1 Golpe Forte &middot; I bolsa &middot; K habilidades &middot; V loja &middot; arrastar gira</div>
      <div class="announce"></div>
    `;
    document.body.appendChild(this.root);
    this.hpFill = this.root.querySelector('.hp-fill') as HTMLDivElement;
    this.hpText = this.root.querySelector('.hp-text') as HTMLSpanElement;
    this.mpFill = this.root.querySelector('.mp-fill') as HTMLDivElement;
    this.mpText = this.root.querySelector('.mp-text') as HTMLSpanElement;
    this.levelBadge = this.root.querySelector('.level') as HTMLSpanElement;
    this.xpFill = this.root.querySelector('.xp-fill') as HTMLDivElement;
    this.xpText = this.root.querySelector('.xp-text') as HTMLSpanElement;
    this.targetFrame = this.root.querySelector('.target-frame') as HTMLDivElement;
    this.targetName = this.root.querySelector('.target-name') as HTMLSpanElement;
    this.targetHpFill = this.root.querySelector('.target-hp-fill') as HTMLDivElement;
    this.targetHpText = this.root.querySelector('.target-hp-text') as HTMLSpanElement;
    this.actionBar = this.root.querySelector('.action-bar') as HTMLDivElement;
    this.announceEl = this.root.querySelector('.announce') as HTMLDivElement;
    this.goldAmt = this.root.querySelector('.gold-amt') as HTMLSpanElement;
    this.spAmt = this.root.querySelector('.sp-amt') as HTMLSpanElement;
    this.skillsEl = this.root.querySelector('.skills') as HTMLDivElement;
    this.skillsSp = this.root.querySelector('.skills-sp') as HTMLSpanElement;
    this.skillsList = this.root.querySelector('.skills-list') as HTMLDivElement;
    this.bag = this.root.querySelector('.bag') as HTMLDivElement;
    this.bagTitle = this.root.querySelector('.bag-title') as HTMLDivElement;
    this.bagGrid = this.root.querySelector('.bag-grid') as HTMLDivElement;
    this.bagStats = this.root.querySelector('.bag-stats') as HTMLDivElement;
    this.attrPointsEl = this.root.querySelector('.attr-points') as HTMLSpanElement;
    this.attrStrBtn = this.root.querySelector('.attr-str') as HTMLButtonElement;
    this.attrIntBtn = this.root.querySelector('.attr-int') as HTMLButtonElement;
    this.attrStrBtn.addEventListener('click', () => this.world?.sendCommand({ t: 'spend-attr', attr: 'str' }));
    this.attrIntBtn.addEventListener('click', () => this.world?.sendCommand({ t: 'spend-attr', attr: 'int' }));
    this.shopEl = this.root.querySelector('.shop') as HTMLDivElement;
    this.shopTitle = this.root.querySelector('.shop-title') as HTMLDivElement;
    this.shopHint = this.root.querySelector('.shop-hint') as HTMLDivElement;
    this.shopBuy = this.root.querySelector('.shop-buy') as HTMLDivElement;
    this.shopSell = this.root.querySelector('.shop-sell') as HTMLDivElement;
    this.shopRepair = this.root.querySelector('.shop-repair') as HTMLDivElement;
    this.equipRow = this.root.querySelector('.equip-row') as HTMLDivElement;
    this.refineRow = this.root.querySelector('.refine-row') as HTMLDivElement;
    this.luckyToggle = this.root.querySelector('.lucky-toggle') as HTMLButtonElement;
    this.matLine = this.root.querySelector('.mat-line') as HTMLDivElement;
    this.luckyToggle.addEventListener('click', () => {
      this.luckyOn = !this.luckyOn;
      this.luckyToggle.textContent = `Pó da Sorte: ${this.luckyOn ? 'ON' : 'OFF'}`;
      this.luckyToggle.classList.toggle('on', this.luckyOn);
    });
    this.protectToggle = this.root.querySelector('.protect-toggle') as HTMLButtonElement;
    this.protectToggle.addEventListener('click', () => {
      this.protectOn = !this.protectOn;
      this.protectToggle.textContent = `Proteção: ${this.protectOn ? 'ON' : 'OFF'}`;
      this.protectToggle.classList.toggle('on', this.protectOn);
    });
    this.botToggleBtn = this.root.querySelector('.bot-toggle') as HTMLButtonElement;
    this.botIndicator = this.root.querySelector('.bot-indicator') as HTMLDivElement;
    this.botToggleBtn.addEventListener('click', () => this.toggleBot());

    // The inventory window is pure UI state — open/close with I (Esc closes).
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (isTyping()) return; // don't fire HUD hotkeys while typing in the chat
      if (e.key.toLowerCase() === 'i') this.setBag(!this.bagOpen);
      else if (e.key.toLowerCase() === 'v') this.setShop(!this.shopOpen);
      else if (e.key.toLowerCase() === 'k') this.setSkills(!this.skillsOpen);
      else if (e.key.toLowerCase() === 'b') this.toggleBot();
      else if (e.key === 'Escape') {
        this.setBag(false);
        this.setShop(false);
        this.setSkills(false);
      }
    });
  }

  // Flip auto-play on/off via the same command a click on the button sends.
  private toggleBot(): void {
    if (this.world) this.world.sendCommand({ t: 'set-bot', on: !this.world.botActive() });
  }

  private setBag(open: boolean): void {
    this.bagOpen = open;
    this.bag.hidden = !open;
  }

  private setShop(open: boolean): void {
    this.shopOpen = open;
    this.shopEl.hidden = !open;
  }

  private setSkills(open: boolean): void {
    this.skillsOpen = open;
    this.skillsEl.hidden = !open;
    if (open) this.lastSkillsSig = ''; // force a rebuild on (re)open
  }

  // Show a brief center-screen announcement (e.g. a world boss appearing).
  announce(text: string): void {
    this.announceEl.textContent = text;
    this.announceEl.classList.remove('show'); // restart the CSS fade...
    void this.announceEl.offsetWidth; // ...by forcing a reflow
    this.announceEl.classList.add('show');
  }

  update(world: IWorld): void {
    this.world = world; // so bag click handlers can send equip/unequip commands
    // Auto-play state: light up the button + show the "AUTO-PLAY" indicator.
    const bot = world.botActive();
    this.botToggleBtn.textContent = `Bot: ${bot ? 'ON' : 'OFF'} (B)`;
    this.botToggleBtn.classList.toggle('on', bot);
    this.botIndicator.hidden = !bot;
    const id = world.localPlayerId();
    if (id == null) return;
    const ents = world.entities();
    const p = ents.find((e) => e.id === id);
    if (!p) return;

    const hpPct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    this.hpFill.style.width = `${hpPct * 100}%`;
    this.hpText.textContent = `${Math.round(p.hp)} / ${p.maxHp}`;
    const mpPct = p.maxMp > 0 ? Math.max(0, Math.min(1, p.mp / p.maxMp)) : 0;
    this.mpFill.style.width = `${mpPct * 100}%`;
    this.mpText.textContent = `${Math.round(p.mp)} / ${p.maxMp}`;

    this.levelBadge.textContent = `Nv ${p.level}`;
    const xpPct = p.xpToNext > 0 ? Math.max(0, Math.min(1, p.xp / p.xpToNext)) : 0;
    this.xpFill.style.width = `${xpPct * 100}%`;
    this.xpText.textContent =
      `XP ${Math.round(p.xp)} / ${p.xpToNext}` + (p.attrPoints > 0 ? ` · ${p.attrPoints} pts` : '');

    const tid = world.localTargetId();
    const t = tid != null ? ents.find((e) => e.id === tid) : undefined;
    if (t) {
      this.targetFrame.hidden = false;
      this.targetName.textContent = t.name;
      const tpct = Math.max(0, Math.min(1, t.hp / t.maxHp));
      this.targetHpFill.style.width = `${tpct * 100}%`;
      this.targetHpText.textContent = `${Math.round(t.hp)} / ${t.maxHp}`;
    } else {
      this.targetFrame.hidden = true;
    }

    this.goldAmt.textContent = String(p.gold);
    this.spAmt.textContent = String(p.sp);

    this.updateActionBar(world.abilities());
    if (this.bagOpen) this.updateBag(world.inventory(), p);
    if (this.shopOpen) this.updateShop(world, p);
    if (this.skillsOpen) this.updateSkills(world, p);
    if (this.sheet.isOpen()) this.sheet.update(p); // K6: ficha (só leitura)
  }

  // Skills panel (GDD B4): each ability's rank + the SP cost to raise it, with a
  // "Subir" button gated on SP and the rank cap. Rebuilt only when something changed.
  private updateSkills(world: IWorld, p: EntityView): void {
    const abilities = world.abilities();
    this.skillsSp.textContent = String(p.sp);
    const sig =
      `${p.sp}|` + abilities.map((a) => `${a.slot}:${a.name}:${a.rank}:${a.maxRank}:${a.rankCost}`).join(',');
    if (sig === this.lastSkillsSig) return; // nothing changed -> don't thrash the DOM
    this.lastSkillsSig = sig;

    this.skillsList.textContent = '';
    for (const a of abilities) {
      const row = document.createElement('div');
      row.className = 'skill-row';
      const info = makeSpan('skill-info', `${a.name} — Rank ${a.rank}/${a.maxRank}`);
      const btn = document.createElement('button');
      btn.className = 'skill-up-btn';
      if (a.rank >= a.maxRank) {
        btn.textContent = 'MÁX';
        btn.disabled = true;
      } else {
        btn.textContent = `Subir (${a.rankCost} SP)`;
        btn.disabled = p.sp < a.rankCost;
        btn.addEventListener('click', () => world.sendCommand({ t: 'rank-up', slot: a.slot }));
      }
      row.append(info, btn);
      this.skillsList.appendChild(row);
    }
  }

  // Vendor shop: lists what the vendor sells (buy buttons, gated on gold) and the
  // player's sellable bag stacks (sell buttons). Only usable while in range. Buttons
  // are built ONCE and updated IN PLACE (the same pattern as the bag) — never torn
  // down — so a player's click is never lost to a refresh landing between mousedown
  // and mouseup. Handlers read the CURRENT data by index, so they can't go stale.
  private updateShop(world: IWorld, p: EntityView): void {
    const s = world.shop();
    this.shopTitle.textContent = `${s.name} · Ouro: ${p.gold}`;
    const near = s.inRange;
    this.shopHint.textContent = near
      ? 'Comprar / Vender:'
      : 'Aproxime-se do mercador para negociar.';
    // Hide the groups when out of range (inline display so .shop-btn CSS can't override
    // it). The buttons PERSIST — nothing is destroyed — so clicks survive every refresh.
    this.shopBuy.style.display = near ? '' : 'none';
    this.shopSell.style.display = near ? '' : 'none';
    this.shopRepair.style.display = near ? '' : 'none';
    if (!near) return;

    const inv = world.inventory();
    this.lastInv = inv; // sell/repair handlers read the CURRENT bag/gear by index
    this.lastShopStock = s.stock; // buy handlers read the CURRENT stock by index

    // Buy: one button per stock entry, created once and then reused.
    while (this.shopBuyCells.length < s.stock.length) {
      const i = this.shopBuyCells.length;
      const btn = document.createElement('button');
      btn.className = 'shop-btn';
      btn.addEventListener('click', () => this.onShopBuyClick(i));
      this.shopBuy.appendChild(btn);
      this.shopBuyCells.push(btn);
    }
    for (let i = 0; i < this.shopBuyCells.length; i++) {
      const e = s.stock[i];
      const btn = this.shopBuyCells[i];
      if (e) {
        btn.style.display = '';
        btn.textContent = `Comprar ${e.name} — ${e.price}`;
        btn.disabled = p.gold < e.price;
      } else {
        btn.style.display = 'none';
      }
    }

    // Repair: one button per equip slot, created once. Only damaged gear shows.
    while (this.shopRepairCells.length < inv.equipment.length) {
      const j = this.shopRepairCells.length;
      const btn = document.createElement('button');
      btn.className = 'shop-btn repair';
      btn.addEventListener('click', () => this.onShopRepairClick(j));
      this.shopRepair.appendChild(btn);
      this.shopRepairCells.push(btn);
    }
    for (let j = 0; j < this.shopRepairCells.length; j++) {
      const eq = inv.equipment[j];
      const btn = this.shopRepairCells[j];
      if (eq && eq.itemId != null && eq.durability < eq.maxDurability) {
        btn.style.display = '';
        const slotName = SLOT_LABELS[eq.slot];
        btn.textContent = `Reparar ${slotName} [${eq.durability}/${eq.maxDurability}] — ${eq.repairCost}`;
        btn.disabled = p.gold < eq.repairCost;
      } else {
        btn.style.display = 'none';
      }
    }

    // Sell: one button per bag slot, created once. Only stacks worth gold show.
    while (this.shopSellCells.length < inv.capacity) {
      const i = this.shopSellCells.length;
      const btn = document.createElement('button');
      btn.className = 'shop-btn sell';
      btn.addEventListener('click', () => this.onShopSellClick(i));
      this.shopSell.appendChild(btn);
      this.shopSellCells.push(btn);
    }
    for (let i = 0; i < this.shopSellCells.length; i++) {
      const st = inv.stacks[i];
      const btn = this.shopSellCells[i];
      if (st && st.sellValue > 0) {
        btn.style.display = '';
        const tag = st.plus > 0 ? ` +${st.plus}` : '';
        btn.textContent = `Vender ${st.name}${tag} — ${st.sellValue}`;
      } else {
        btn.style.display = 'none';
      }
    }
  }

  // Click a vendor button -> send the trade. Each reads the CURRENT data by index
  // (never a value captured at build time), so an in-place-updated button always acts
  // on the right item. No-op if the slot is empty / not sellable / not repairable.
  private onShopBuyClick(i: number): void {
    const e = this.lastShopStock?.[i];
    if (e && this.world) this.world.sendCommand({ t: 'buy', itemId: e.itemId });
  }
  private onShopSellClick(i: number): void {
    const st = this.lastInv?.stacks[i];
    if (st && st.sellValue > 0 && this.world) {
      this.world.sendCommand({ t: 'sell', itemId: st.itemId, rarity: st.rarity, plus: st.plus });
    }
  }
  private onShopRepairClick(j: number): void {
    const eq = this.lastInv?.equipment[j];
    if (eq?.itemId != null && eq.durability < eq.maxDurability && this.world) {
      this.world.sendCommand({ t: 'repair', slot: eq.slot });
    }
  }

  private updateBag(inv: InventoryView, p: EntityView): void {
    this.lastInv = inv; // click handlers read this to know what's where

    // Equipment slots (click an occupied one to unequip). Built once.
    while (this.equipCells.length < inv.equipment.length) {
      const j = this.equipCells.length;
      const cell = document.createElement('div');
      cell.className = 'equip-slot';
      cell.addEventListener('click', () => this.onEquipClick(j));
      this.equipRow.appendChild(cell);
      this.equipCells.push(cell);
    }
    for (let j = 0; j < this.equipCells.length; j++) {
      const eq = inv.equipment[j];
      const cell = this.equipCells[j];
      const label = SLOT_LABELS[eq.slot];
      cell.classList.toggle('filled', eq.itemId != null);
      if (eq.itemId) {
        cell.dataset.rarity = eq.rarity ?? '';
        const plusTag = eq.plus > 0 ? ` +${eq.plus}` : '';
        const durTag = ` · Dur ${eq.durability}/${eq.maxDurability}`;
        // "worn" once the bonus starts dropping (below half) — a cue to repair.
        cell.classList.toggle('worn', eq.durability < eq.maxDurability * 0.5);
        const text = `${label}: ${eq.name}${plusTag} (${eq.rarityName})${durTag}`;
        cell.title = text;
        cell.textContent = text;
      } else {
        delete cell.dataset.rarity;
        cell.classList.remove('worn');
        cell.title = label;
        cell.textContent = `${label}: —`;
      }
    }

    // Tiny "ficha": the effective stats Strength/Intelligence + gear drive.
    this.bagStats.textContent =
      `Força ${p.str} · Int ${p.int} · Dano ${p.weaponDamage} · MP ${Math.round(p.mp)}/${p.maxMp}`;

    // Attribute spending: show available points and gate the "+" buttons on them.
    this.attrPointsEl.textContent = `Pontos: ${p.attrPoints}`;
    this.attrStrBtn.disabled = p.attrPoints <= 0;
    this.attrIntBtn.disabled = p.attrPoints <= 0;

    this.updateAlchemy(inv);

    // Bag grid (click an equippable stack to equip it). Slots built once.
    while (this.bagSlots.length < inv.capacity) {
      const i = this.bagSlots.length;
      const slot = document.createElement('div');
      slot.className = 'bag-slot';
      slot.addEventListener('click', () => this.onBagClick(i));
      this.bagGrid.appendChild(slot);
      this.bagSlots.push(slot);
    }
    this.bagTitle.textContent = `Bolsa (${inv.stacks.length}/${inv.capacity})`;
    for (let i = 0; i < this.bagSlots.length; i++) {
      const slot = this.bagSlots[i];
      const stack = inv.stacks[i];
      if (stack) {
        slot.classList.add('filled');
        // K2 degrees: a below-level equippable is LOCKED — no equip affordance, and the click
        // is dead (the sim silently refuses it anyway). canEquip is undefined for non-equippables
        // and true/false for gear (back-compat: undefined => treat as wearable).
        const locked = stack.equipSlot != null && stack.canEquip === false;
        slot.classList.toggle('equippable', stack.equipSlot != null && !locked);
        slot.classList.toggle('locked', locked);
        slot.classList.toggle('usable', stack.consumable);
        slot.dataset.rarity = stack.rarity; // UI colors the border/text by this
        const plusTag = stack.plus > 0 ? ` +${stack.plus}` : '';
        const label = `${stack.name}${plusTag} (${stack.rarityName})`;
        slot.title = locked
          ? `${label} — requer nível ${stack.reqLevel}`
          : stack.equipSlot
            ? `${label} — clique p/ equipar`
            : stack.consumable
              ? `${label} — clique p/ usar`
              : label;
        slot.textContent = stack.qty > 1 ? `${label} ×${stack.qty}` : label;
      } else {
        slot.classList.remove('filled', 'equippable', 'usable', 'locked');
        delete slot.dataset.rarity;
        slot.title = '';
        slot.textContent = '';
      }
    }
  }

  // Click a bag stack -> equip equippable gear, or use a consumable (potion).
  // No-op for anything else (materials, etc.).
  private onBagClick(i: number): void {
    const stack = this.lastInv?.stacks[i];
    if (!stack || !this.world) return;
    if (stack.equipSlot) {
      if (stack.canEquip === false) return; // K2: below required level — dead click (the sim would refuse it)
      this.world.sendCommand({
        t: 'equip',
        itemId: stack.itemId,
        rarity: stack.rarity,
        plus: stack.plus,
      });
    } else if (stack.consumable) {
      this.world.sendCommand({
        t: 'use-item',
        itemId: stack.itemId,
        rarity: stack.rarity,
        plus: stack.plus,
      });
    }
  }

  // Click an equipped slot -> unequip it back to the bag.
  private onEquipClick(j: number): void {
    const eq = this.lastInv?.equipment[j];
    if (eq?.itemId && this.world) this.world.sendCommand({ t: 'unequip', slot: eq.slot });
  }

  private updateAlchemy(inv: InventoryView): void {
    // One "Refinar" button per equip slot, built once.
    while (this.refineBtns.length < inv.equipment.length) {
      const j = this.refineBtns.length;
      const btn = document.createElement('button');
      btn.className = 'refine-btn';
      btn.addEventListener('click', () => this.onRefineClick(j));
      this.refineRow.appendChild(btn);
      this.refineBtns.push(btn);
    }
    const count = (id: string): number =>
      inv.stacks.filter((s) => s.itemId === id).reduce((n, s) => n + s.qty, 0);
    const powder = count('lucky_powder');
    for (let j = 0; j < this.refineBtns.length; j++) {
      const eq = inv.equipment[j];
      const btn = this.refineBtns[j];
      const slotName = SLOT_LABELS[eq.slot];
      const elixirId = eq.slot === 'weapon' ? 'elixir_weapon' : 'elixir_armor';
      btn.dataset.risk = 'safe'; // K4: risk tier for styling; overridden in the risk band below
      if (eq.itemId == null) {
        btn.textContent = `${slotName}: vazio`;
        btn.disabled = true;
      } else if (eq.enhanceChance <= 0) {
        btn.textContent = `${slotName} +${eq.plus} (máx)`;
        btn.disabled = true;
      } else if (count(elixirId) <= 0) {
        btn.textContent = `${slotName} +${eq.plus} (sem Elixir)`;
        btn.disabled = true;
      } else {
        // Success chance (matching the toggle + held powder). In the risk band (+ >= RISK_FLOOR)
        // also state the break danger as TEXT — never color alone: protected => capped -1, else
        // the break % and the multi-drop. CSS reinforces the tier via [data-risk].
        const ch = this.luckyOn && powder > 0 ? eq.enhanceChanceLucky : eq.enhanceChance;
        const warn = eq.breakChance > 0
          ? (this.protectOn
            ? ' · protegido (−1)'
            : ` · PODE QUEBRAR −${eq.dropOnFail} (quebra ${Math.round(eq.breakChance * 100)}%)`)
          : '';
        btn.textContent = `Refinar ${slotName} +${eq.plus} (${Math.round(ch * 100)}%)${warn}`;
        btn.disabled = false;
        btn.dataset.risk = eq.breakChance <= 0 ? 'safe' : this.protectOn ? 'protected' : 'danger';
      }
    }
    this.matLine.textContent =
      `Elixir Arma ${count('elixir_weapon')} · Elixir Armadura ${count('elixir_armor')} · Pó ${powder}`;
  }

  // Click "Refinar" -> attempt the "+N" upgrade on that slot (sim rolls it).
  private onRefineClick(j: number): void {
    const eq = this.lastInv?.equipment[j];
    if (!eq?.itemId || eq.enhanceChance <= 0 || !this.world) return;
    // K4: a risky attempt (can break) with protection OFF is irreversible — confirm first.
    // Protected attempts (and sub-RISK_FLOOR ones) skip the prompt. (Simple native guard; a
    // styled in-panel modal is a future polish.)
    if (eq.breakChance > 0 && !this.protectOn) {
      const ok = window.confirm(
        `Refinar ${SLOT_LABELS[eq.slot]} +${eq.plus} pode QUEBRAR o item (chance ${Math.round(eq.breakChance * 100)}%) `
        + `ou cair −${eq.dropOnFail} níveis, e você não está usando Pedra de Proteção. Continuar?`,
      );
      if (!ok) return;
    }
    this.world.sendCommand({ t: 'enhance', slot: eq.slot, useLuckyPowder: this.luckyOn, useProtection: this.protectOn });
  }

  private updateActionBar(abilities: ReadonlyArray<AbilityView>): void {
    // When the active kit changes (e.g. equipping a spear swaps the whole bar),
    // the cached slots show stale icons/names — wipe and rebuild from scratch.
    const sig = abilities.map((a) => `${a.slot}:${a.name}:${a.icon}:${a.mpCost}`).join('|');
    if (sig !== this.lastBarSig) {
      this.lastBarSig = sig;
      this.actionBar.textContent = '';
      this.slots.clear();
    }
    for (const a of abilities) {
      const slot = this.slots.get(a.slot) ?? this.createSlot(a);
      // Sweep the dark overlay clockwise as the cooldown runs down.
      const frac =
        a.cooldownTotal > 0 ? Math.max(0, Math.min(1, a.cooldownRemaining / a.cooldownTotal)) : 0;
      if (frac > 0) {
        slot.cd.style.display = 'block';
        slot.cd.style.background = `conic-gradient(rgba(8,10,14,0.72) ${frac * 360}deg, transparent 0deg)`;
      } else {
        slot.cd.style.display = 'none';
      }
      slot.root.classList.toggle('ready', a.ready);
    }
  }

  private createSlot(a: AbilityView): { root: HTMLDivElement; cd: HTMLDivElement } {
    const el = document.createElement('div');
    el.className = 'slot';
    el.title = a.name;
    // Build via textContent (not innerHTML) so ability data — which may later
    // come from server snapshots — can never inject markup.
    const key = makeSpan('slot-key', String(a.slot));
    const icon = makeSpan('slot-icon', a.icon);
    const cost = makeSpan('slot-cost', String(a.mpCost));
    const cd = document.createElement('div');
    cd.className = 'slot-cd';
    el.append(key, icon, cost, cd);
    this.actionBar.appendChild(el);
    const refs = { root: el, cd };
    this.slots.set(a.slot, refs);
    return refs;
  }
}

function makeSpan(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  return s;
}
