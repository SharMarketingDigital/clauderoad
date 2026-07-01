// K6 — Ficha de personagem: uma TELA dedicada e SOMENTE LEITURA dos stats (a janela "C" do
// Silkroad). Promove a linha única da bolsa (`Força X · Int Y · …`) a um painel completo:
// identidade, vitais, ataque, DEFESA (phyDef/magDef do K3), atributos e progressão.
//
// Lê APENAS o EntityView do jogador local — nenhum comando: gastar pontos continua na bolsa
// (um único emissor de `spend-attr`). É auto-contida no espírito de map.ts/party_hud.ts:
// registra a PRÓPRIA tecla (C abre/fecha, Esc fecha), monta o próprio DOM via textContent
// (nunca innerHTML com dados de entidade — regra anti-injeção do HUD) e não toca o sim.
import type { EntityView } from '../world_api';
import { isTyping } from './typing';
import { registerOverlay } from './overlays';
import { decoratePanel } from './theme';

export class CharacterSheet {
  private root: HTMLDivElement;
  private nameEl: HTMLSpanElement;
  private levelEl: HTMLSpanElement;
  private body: HTMLDivElement;
  private open = false;
  private lastSig = ''; // só reconstrói as linhas quando um valor exibido muda

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'sheet';
    this.root.hidden = true;
    this.root.innerHTML = `
      <div class="sheet-head">
        <span class="sheet-portrait">&#9733;</span>
        <span class="sheet-name"></span>
        <span class="sheet-level"></span>
      </div>
      <div class="sheet-body"></div>
    `;
    document.body.appendChild(this.root);
    decoratePanel(this.root); // medieval stone frame (read-only ficha)
    this.nameEl = this.root.querySelector('.sheet-name') as HTMLSpanElement;
    this.levelEl = this.root.querySelector('.sheet-level') as HTMLSpanElement;
    this.body = this.root.querySelector('.sheet-body') as HTMLDivElement;

    // Própria hotkey (C), com os mesmos guards do HUD: não dispara repetindo a tecla nem
    // enquanto o jogador digita no chat. Esc também fecha (consistente com os outros painéis).
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      if (isTyping()) return;
      if (e.key.toLowerCase() === 'c') this.setOpen(!this.open);
      else if (e.key === 'Escape') this.setOpen(false);
    });

    // Take part in Esc priority so the central Esc menu (and other windows) respect an open ficha.
    registerOverlay(() => this.open);
  }

  isOpen(): boolean {
    return this.open;
  }

  setOpen(open: boolean): void {
    this.open = open;
    this.root.hidden = !open;
    if (open) this.lastSig = ''; // força um rebuild ao (re)abrir
  }

  // Render SOMENTE LEITURA dos stats efetivos do jogador local. O Hud chama isto a cada frame
  // enquanto a ficha está aberta (passando o EntityView do jogador).
  update(p: EntityView): void {
    const sig = [
      p.name, p.level, p.hp, p.maxHp, Math.round(p.mp), p.maxMp, p.str, p.int,
      p.weaponDamage, p.weaponPlus, p.phyDef, p.magDef, p.attrPoints, p.sp, p.gold,
      Math.round(p.xp), p.xpToNext,
    ].join('|');
    if (sig === this.lastSig) return; // nada mudou -> não martela o DOM
    this.lastSig = sig;

    this.nameEl.textContent = p.name;
    this.levelEl.textContent = `Nível ${p.level}`;

    this.body.textContent = '';
    // Vitais (com barras, reusando o visual de HP/MP do HUD)
    this.body.append(section('Vitais'));
    this.body.append(bar('HP', p.hp, p.maxHp, 'hp'));
    this.body.append(bar('MP', p.mp, p.maxMp, 'mp'));
    // Ataque
    this.body.append(section('Ataque'));
    this.body.append(
      row('Dano de arma', p.weaponPlus > 0 ? `${p.weaponDamage}  (+${p.weaponPlus})` : String(p.weaponDamage)),
    );
    // Defesa — os stats do K3, expostos pela ficha (K6)
    this.body.append(section('Defesa'));
    this.body.append(row('Defesa física', String(p.phyDef)));
    this.body.append(row('Defesa mágica', String(p.magDef)));
    // Atributos (só leitura; distribuir pontos é na bolsa, o emissor único)
    this.body.append(section('Atributos'));
    this.body.append(row('Força', String(p.str)));
    this.body.append(row('Inteligência', String(p.int)));
    this.body.append(
      row('Pontos disponíveis', p.attrPoints > 0 ? `${p.attrPoints} · distribua na bolsa (I)` : '0'),
    );
    // Progressão
    this.body.append(section('Progressão'));
    this.body.append(bar('XP', p.xp, p.xpToNext, 'xp'));
    this.body.append(row('SP', String(p.sp)));
    this.body.append(row('Ouro', String(p.gold)));
  }
}

function section(title: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'sheet-section';
  d.textContent = title;
  return d;
}

function row(label: string, value: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'sheet-row';
  const l = document.createElement('span');
  l.className = 'sheet-label';
  l.textContent = label;
  const v = document.createElement('span');
  v.className = 'sheet-val';
  v.textContent = value;
  d.append(l, v);
  return d;
}

// A bar row reuses the existing .hp/.mp/.xp HUD classes (track + fill + centered text) so the
// sheet matches the rest of the HUD; the label sits in a fixed first column.
function bar(label: string, cur: number, max: number, kind: 'hp' | 'mp' | 'xp'): HTMLDivElement {
  const d = document.createElement('div');
  d.className = 'sheet-barrow';
  const l = document.createElement('span');
  l.className = 'sheet-label';
  l.textContent = label;
  const track = document.createElement('div');
  track.className = kind;
  const fill = document.createElement('div');
  fill.className = `${kind}-fill`;
  // Round cur for the fill width too (the readout text below already rounds), so a fractional
  // vital can't desync the bar from the rebuild signature (which compares rounded values).
  // max <= 0 is the XP level-cap sentinel (xpToNext === 0): render a full "MÁX" bar. HP/MP never
  // reach here, so this only affects the XP row at the cap.
  const pct = max > 0 ? Math.max(0, Math.min(1, Math.round(cur) / max)) : 1;
  fill.style.width = `${pct * 100}%`;
  const txt = document.createElement('span');
  txt.className = `${kind}-text`;
  txt.textContent = max > 0 ? `${Math.round(cur)} / ${max}` : 'MÁX';
  track.append(fill, txt);
  d.append(l, track);
  return d;
}
