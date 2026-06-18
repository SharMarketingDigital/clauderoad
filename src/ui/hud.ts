// Minimal classic-style HUD. Reads the world via IWorld; draws DOM, no framework.
import type { IWorld, AbilityView, InventoryView } from '../world_api';

export class Hud {
  private root: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpText: HTMLSpanElement;
  private mpFill: HTMLDivElement;
  private mpText: HTMLSpanElement;
  private levelBadge: HTMLSpanElement;
  private xpFill: HTMLDivElement;
  private xpText: HTMLSpanElement;
  // target frame (shown only while an enemy is selected)
  private targetFrame: HTMLDivElement;
  private targetName: HTMLSpanElement;
  private targetHpFill: HTMLDivElement;
  private targetHpText: HTMLSpanElement;
  // action bar: slot number -> its DOM refs (built lazily from world.abilities())
  private actionBar: HTMLDivElement;
  private slots = new Map<number, { root: HTMLDivElement; cd: HTMLDivElement }>();
  // gold + inventory window (toggled with I; pure UI state, not a world command)
  private goldAmt: HTMLSpanElement;
  private bag: HTMLDivElement;
  private bagTitle: HTMLDivElement;
  private bagGrid: HTMLDivElement;
  private bagSlots: HTMLDivElement[] = [];
  private bagOpen = false;

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
      <div class="action-bar"></div>
      <div class="bag" hidden>
        <div class="bag-title">Bolsa</div>
        <div class="bag-grid"></div>
      </div>
      <div class="hint">WASD mover &middot; Tab/clique alvo &middot; 1 Golpe Forte &middot; I bolsa &middot; arrastar gira</div>
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
    this.goldAmt = this.root.querySelector('.gold-amt') as HTMLSpanElement;
    this.bag = this.root.querySelector('.bag') as HTMLDivElement;
    this.bagTitle = this.root.querySelector('.bag-title') as HTMLDivElement;
    this.bagGrid = this.root.querySelector('.bag-grid') as HTMLDivElement;

    // The inventory window is pure UI state — open/close with I (Esc closes).
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (e.key.toLowerCase() === 'i') this.setBag(!this.bagOpen);
      else if (e.key === 'Escape') this.setBag(false);
    });
  }

  private setBag(open: boolean): void {
    this.bagOpen = open;
    this.bag.hidden = !open;
  }

  update(world: IWorld): void {
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

    this.updateActionBar(world.abilities());
    if (this.bagOpen) this.updateBag(world.inventory());
  }

  private updateBag(inv: InventoryView): void {
    // Build the fixed slot grid once (capacity comes from the sim).
    while (this.bagSlots.length < inv.capacity) {
      const slot = document.createElement('div');
      slot.className = 'bag-slot';
      this.bagGrid.appendChild(slot);
      this.bagSlots.push(slot);
    }
    this.bagTitle.textContent = `Bolsa (${inv.stacks.length}/${inv.capacity})`;
    for (let i = 0; i < this.bagSlots.length; i++) {
      const slot = this.bagSlots[i];
      const stack = inv.stacks[i];
      if (stack) {
        slot.classList.add('filled');
        slot.title = stack.name;
        slot.textContent = stack.qty > 1 ? `${stack.name} ×${stack.qty}` : stack.name;
      } else {
        slot.classList.remove('filled');
        slot.title = '';
        slot.textContent = '';
      }
    }
  }

  private updateActionBar(abilities: ReadonlyArray<AbilityView>): void {
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
