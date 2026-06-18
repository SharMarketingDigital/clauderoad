// Minimal classic-style HUD. Reads the world via IWorld; draws DOM, no framework.
import type { IWorld } from '../world_api';

export class Hud {
  private root: HTMLDivElement;
  private hpFill: HTMLDivElement;
  private hpText: HTMLSpanElement;
  // target frame (shown only while an enemy is selected)
  private targetFrame: HTMLDivElement;
  private targetName: HTMLSpanElement;
  private targetHpFill: HTMLDivElement;
  private targetHpText: HTMLSpanElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'hud';
    this.root.innerHTML = `
      <div class="unit-frame">
        <div class="portrait">&#9733;</div>
        <div class="bars">
          <span class="name">Hero</span>
          <div class="hp"><div class="hp-fill"></div><span class="hp-text"></span></div>
        </div>
      </div>
      <div class="unit-frame target-frame" hidden>
        <div class="portrait portrait-target">&#9876;</div>
        <div class="bars">
          <span class="name target-name"></span>
          <div class="hp"><div class="hp-fill target-hp-fill"></div><span class="hp-text target-hp-text"></span></div>
        </div>
      </div>
      <div class="hint">WASD mover &middot; Tab/clique seleciona alvo &middot; arrastar gira a c&acirc;mera &middot; scroll d&aacute; zoom</div>
    `;
    document.body.appendChild(this.root);
    this.hpFill = this.root.querySelector('.hp-fill') as HTMLDivElement;
    this.hpText = this.root.querySelector('.hp-text') as HTMLSpanElement;
    this.targetFrame = this.root.querySelector('.target-frame') as HTMLDivElement;
    this.targetName = this.root.querySelector('.target-name') as HTMLSpanElement;
    this.targetHpFill = this.root.querySelector('.target-hp-fill') as HTMLDivElement;
    this.targetHpText = this.root.querySelector('.target-hp-text') as HTMLSpanElement;
  }

  update(world: IWorld): void {
    const id = world.localPlayerId();
    if (id == null) return;
    const ents = world.entities();
    const p = ents.find((e) => e.id === id);
    if (!p) return;
    const pct = Math.max(0, Math.min(1, p.hp / p.maxHp));
    this.hpFill.style.width = `${pct * 100}%`;
    this.hpText.textContent = `${Math.round(p.hp)} / ${p.maxHp}`;

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
  }
}
