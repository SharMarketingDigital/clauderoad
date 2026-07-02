// Gear defense reduces incoming damage (Balde A). mitigate() now reads the target's effective armor:
//   physical -> phyDef ; magical -> magDef + Int-based resist (they STACK), both through the WoW-style
//   curve `amount * (1 - armor/(armor+ARMOR_K))`. `armor <= 0` is an EXACT passthrough, so every enemy
//   (always 0 armor) and un-armored player is byte-identical — only a geared target is reduced.
// Two layers: pure unit tests of mitigate() (exact numbers), then an end-to-end "armor makes me tank more".
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { mitigate, ARMOR_K, MAGIC_DEF_PER_INT } from '../src/sim/combat';
import type { Entity } from '../src/sim/types';
import type { Damage } from '../src/sim/combat';
import { addToBag } from '../src/sim/inventory';

// mitigate() only reads target.phyDef / magDef / baseInt — a tiny stub stands in for the full Entity.
const target = (phyDef: number, magDef: number, baseInt: number): Entity =>
  ({ phyDef, magDef, baseInt }) as unknown as Entity;
const phys = (amount: number): Damage => ({ amount, type: 'physical', crit: false });
const magic = (amount: number): Damage => ({ amount, type: 'magical', crit: false });

describe('Armor curve — mitigate() (pure)', () => {
  it('ARMOR_K is 50 and the magic-resist-per-Int constant is unchanged (0.25)', () => {
    expect(ARMOR_K).toBe(50);
    expect(MAGIC_DEF_PER_INT).toBe(0.25);
  });

  it('zero armor is an EXACT passthrough (byte-identical to the old code)', () => {
    expect(mitigate({ hit: phys(100), target: target(0, 0, 0) })).toBe(100);
    expect(mitigate({ hit: phys(137), target: target(0, 0, 0) })).toBe(137);
    expect(mitigate({ hit: magic(100), target: target(0, 0, 0) })).toBe(100); // magDef 0 AND Int 0
    expect(mitigate({ hit: magic(53), target: target(0, 0, 0) })).toBe(53);
  });

  it('physical: phyDef reduces by the curve (phyDef 9 => ~15% on any hit size)', () => {
    // 100 * (1 - 9/59) = 84.745 -> 85 ; 6 * (1 - 9/59) = 5.085 -> 5
    expect(mitigate({ hit: phys(100), target: target(9, 0, 0) })).toBe(85);
    expect(mitigate({ hit: phys(6), target: target(9, 0, 0) })).toBe(5);
    // higher armor (full SUN+10 set = 54) reduces more: 100 * (1 - 54/104) = 48.07 -> 48
    expect(mitigate({ hit: phys(100), target: target(54, 0, 0) })).toBe(48);
  });

  it('magical: magDef and the Int-resist STACK (add) into the same curve', () => {
    // magDef 7 alone: 100 * (1 - 7/57) = 87.7 -> 88
    expect(mitigate({ hit: magic(100), target: target(0, 7, 0) })).toBe(88);
    // Int 28 alone: floor(28*0.25)=7 -> armor 7 -> SAME 88 (Int and magDef are interchangeable in the sum)
    expect(mitigate({ hit: magic(100), target: target(0, 0, 28) })).toBe(88);
    // both: armor 7+7=14 -> 100 * (1 - 14/64) = 78.1 -> 78 (strictly MORE reduction than either alone)
    expect(mitigate({ hit: magic(100), target: target(0, 7, 28) })).toBe(78);
    expect(mitigate({ hit: magic(100), target: target(0, 7, 28) })).toBeLessThan(88);
  });

  it('magical does NOT use phyDef, and physical does NOT use magDef/Int', () => {
    expect(mitigate({ hit: magic(100), target: target(9, 0, 0) })).toBe(100); // phyDef ignored for magic
    expect(mitigate({ hit: phys(100), target: target(0, 9, 99) })).toBe(100); // magDef + Int ignored for physical
  });

  it('mitigate can return 0 on a tiny hit vs heavy armor — the >=1 floor is the apply step, not here', () => {
    // 1 * (1 - 54/104) = 0.48 -> round 0. The sim floors player damage to >=1 at hitPlayer; enemies (armor 0) never reach here.
    expect(mitigate({ hit: phys(1), target: target(54, 0, 0) })).toBe(0);
  });
});

// ---- end-to-end: a geared player tanks a wolf and loses LESS HP than an un-geared one ----
type Internal = { ents: Map<number, Entity> };
const player = (sim: Sim): Entity => [...(sim as unknown as Internal).ents.values()].find((e) => e.kind === 'player')!;
const nearestWolf = (sim: Sim): Entity | undefined => {
  const p = player(sim);
  let best: Entity | undefined;
  let bd = Infinity;
  for (const e of (sim as unknown as Internal).ents.values()) {
    if (e.kind !== 'enemy') continue;
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
};
const LEATHER = ['leather_cap', 'wolf_leather', 'leather_gloves', 'leather_pants', 'leather_boots', 'wooden_shield'];

describe('Armor in real combat — vesting gear reduces the damage taken', () => {
  it('a geared player loses LESS HP tanking a wolf than an un-geared one (same seed, tick-aligned)', () => {
    // Both runs do the SAME 6 setup ticks (so the combat that follows lines up); only `armor` equips.
    const hpLostTanking = (armor: boolean): { lost: number; alive: boolean } => {
      const sim = new Sim(7);
      for (const it of LEATHER) {
        if (armor) {
          addToBag(player(sim).bag, it, 'normal', 0, 1);
          sim.sendCommand({ t: 'equip', itemId: it, rarity: 'normal', plus: 0 });
        }
        sim.step();
      }
      const startHp = player(sim).hp; // full HP (the armored one has more maxHp — we compare HP LOST)
      // Walk into the nearest wolf and tank its bites (no target set => we never kill it).
      for (let i = 0; i < 500; i++) {
        const p = player(sim);
        const w = nearestWolf(sim);
        if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        sim.step();
      }
      return { lost: startHp - player(sim).hp, alive: player(sim).deadUntil === 0 };
    };

    const bare = hpLostTanking(false);
    const geared = hpLostTanking(true);
    expect(bare.alive).toBe(true); // both survive the window, so the bite pattern is identical
    expect(geared.alive).toBe(true);
    expect(bare.lost).toBeGreaterThan(0); // the wolf actually bit the BARE player (net loss)
    // Sistema 4: com o SET couro completo (4/4 -> +3 phyDef, +3 magDef, +20 maxHp) o geared fica tão tanky que
    // a regen supera as mordidas mitigadas — pode fechar a janela com net POSITIVO (lost <= 0). Isso é evidência
    // ainda MAIS forte de que a armadura reduz o dano; a alegação central segue exata:
    expect(geared.lost).toBeLessThan(bare.lost); // armadura (peça + set) reduziu o dano líquido tomado
  });

  it('determinism: a geared-player combat run hashes identically run-to-run', () => {
    const run = (): string => {
      const sim = new Sim(7);
      for (const it of LEATHER) {
        addToBag(player(sim).bag, it, 'normal', 0, 1);
        sim.sendCommand({ t: 'equip', itemId: it, rarity: 'normal', plus: 0 });
        sim.step();
      }
      for (let i = 0; i < 200; i++) {
        const p = player(sim);
        const w = nearestWolf(sim);
        if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        sim.step();
      }
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
