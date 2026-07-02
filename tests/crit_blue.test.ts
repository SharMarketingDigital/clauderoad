// Sistema 3 (azul de CRIT — o eixo MULTIPLICATIVO). O azul mais perigoso: crit = CRIT_MULT× dano, então
// soma poder OFENSIVO que fecha o teto. Só em arma; resolvido LIVE em critChance (não é stat armazenado).
// Magnitude DELIBERADAMENTE conservadora (perLevel 0.01 -> máx +5% num arma g3) até a rebalance (Sistema 5)
// validar o teto. Estes testes fixam: o fold no critChance (+0.01/opt-level), arma-only (drop + socket), o
// readout socketable da arma, a magnitude/teto (guarda contra um bump silencioso furar o teto) e o determinismo
// do rolo de crit em combate com a arma azul.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { addToBag } from '../src/sim/inventory';
import { bluesKey, blueAmount, rollBlues, BLUES } from '../src/sim/content/magic_options';
import { CRIT_MULT } from '../src/sim/combat';
import type { Entity, EquippedItem } from '../src/sim/types';
import type { EquipSlot } from '../src/world_api';
import { MAX_DURABILITY } from '../src/sim/content/durability';
import { Rng } from '../src/sim/rng';

type Internal = { ents: Map<number, Entity>; recomputeStats: (e: Entity) => void; critChance: (e: Entity) => number; enhanceBlue: (p: Entity, slot: EquipSlot, blueId: string) => void };
const inner = (sim: Sim) => sim as unknown as Internal;
const player = (sim: Sim): Entity => [...inner(sim).ents.values()].find((e) => e.kind === 'player')!;
const equipWeapon = (sim: Sim, blues?: { id: string; level: number }[]): Entity => {
  const p = player(sim);
  p.equipment.weapon = { itemId: 'old_sword', rarity: 'sos', plus: 0, durability: MAX_DURABILITY, ...(blues ? { blues } : {}) } as EquippedItem;
  inner(sim).recomputeStats(p);
  return p;
};

describe('Azul de crit — fold LIVE no critChance (+perLevel × level)', () => {
  it('uma arma com crit:5 soma +0.05 de chance sobre a MESMA arma sem crit (delta = só o azul)', () => {
    const sim = new Sim(1);
    const base = inner(sim).critChance(equipWeapon(sim)); // arma sem crit
    const withCrit = inner(sim).critChance(equipWeapon(sim, [{ id: 'crit', level: 5 }]));
    expect(withCrit - base).toBeCloseTo(0.05, 6); // +1%/opt-level × 5
  });

  it('sobe LINEAR no opt-level: crit:2 = +0.02 (metade de crit:4)', () => {
    const sim = new Sim(1);
    const base = inner(sim).critChance(equipWeapon(sim));
    const c2 = inner(sim).critChance(equipWeapon(sim, [{ id: 'crit', level: 2 }])) - base;
    const c4 = inner(sim).critChance(equipWeapon(sim, [{ id: 'crit', level: 4 }])) - base;
    expect(c2).toBeCloseTo(0.02, 6);
    expect(c4).toBeCloseTo(c2 * 2, 6);
  });
});

describe('Azul de crit — MAGNITUDE / TETO (guarda contra furar o teto ofensivo)', () => {
  it('a magnitude é conservadora: crit MÁXIMO (5) = +0.05 de chance; efeito de DPS ≈ +5% (× CRIT_MULT 2.0)', () => {
    expect(BLUES.crit.perLevel).toBe(0.01); // dimensionado à escala 0..1 do critChance
    expect(BLUES.crit.maxLevel).toBe(5);
    const maxCrit = blueAmount({ id: 'crit', level: BLUES.crit.maxLevel }); // 0.05
    expect(maxCrit).toBeCloseTo(0.05, 6);
    // crit = CRIT_MULT× dano => multiplicador de DPS ≈ 1 + c×(CRIT_MULT-1). Com c=0.05: ~+5%. Conservador.
    const dpsMult = 1 + maxCrit * (CRIT_MULT - 1);
    expect(dpsMult).toBeLessThan(1.06); // fica bem abaixo de qualquer teto — o eixo perigoso é pequeno de propósito
  });

  it('o critChance CONTINUA clampado em 1.0 mesmo com o azul de crit somado', () => {
    const sim = new Sim(1);
    const p = equipWeapon(sim, [{ id: 'crit', level: 5 }]);
    (sim as unknown as { applyStatus: (e: Entity, k: string, d: number, m: number) => void }).applyStatus(p, 'crit', 200, 0.99); // buff enorme (via o caminho real) + o azul
    expect(inner(sim).critChance(p)).toBe(1); // 0.99 + 0.05 (+ base) -> clampado ao teto
  });
});

describe('Azul de crit — ARMA-ONLY (drop + socket)', () => {
  it('rollBlues: a arma rola CRIT; a armadura NUNCA rola crit', () => {
    const wpn = rollBlues(new Rng(1), 'weapon', 'sun', 3);
    expect(wpn.every((b) => b.id === 'crit')).toBe(true); // só crit é elegível à arma
    const chest = rollBlues(new Rng(1), 'chest', 'sun', 3);
    expect(chest.some((b) => b.id === 'crit')).toBe(false); // crit não é elegível à armadura
  });

  it('enhanceBlue crit numa ARMA soca a linha; crit numa ARMADURA é recusado (pedra intacta)', () => {
    const sim = new Sim(1);
    const p = equipWeapon(sim); // arma equipada, sem crit
    p.equipment.chest = { itemId: 'plate_armor', rarity: 'sos', plus: 0, durability: MAX_DURABILITY } as EquippedItem;
    addToBag(p.bag, 'magic_stone', 'normal', 0, 2);
    // crit na armadura -> gate de slot recusa (pedra intacta)
    inner(sim).enhanceBlue(p, 'chest', 'crit');
    expect(p.equipment.chest?.blues).toBeUndefined();
    // crit na arma -> soca (força sucesso fixando o rng)
    (sim as unknown as { rng: { next: () => number } }).rng = { next: () => 0 };
    inner(sim).enhanceBlue(p, 'weapon', 'crit');
    expect(bluesKey(p.equipment.weapon?.blues)).toBe('crit:1');
    const stones = p.bag.reduce((n, s) => n + (s?.itemId === 'magic_stone' ? s.qty : 0), 0);
    expect(stones).toBe(1); // só a tentativa da ARMA gastou pedra (a da armadura foi recusada antes)
  });

  it('a view socketable da ARMA inclui crit; a da armadura não', () => {
    const sim = new Sim(1);
    const p = equipWeapon(sim);
    p.equipment.chest = { itemId: 'plate_armor', rarity: 'sos', plus: 0, durability: MAX_DURABILITY } as EquippedItem;
    inner(sim).recomputeStats(p);
    const eqv = sim.inventory().equipment;
    const wpn = eqv.find((e) => e.slot === 'weapon')!;
    const chest = eqv.find((e) => e.slot === 'chest')!;
    expect(wpn.socketable!.some((s) => s.id === 'crit')).toBe(true);
    expect(chest.socketable!.some((s) => s.id === 'crit')).toBe(false);
  });
});

describe('Azul de crit — determinismo (o rolo de crit da arma azul é reproduzível)', () => {
  const critCombat = (seed: number): string => {
    const sim = new Sim(seed);
    equipWeapon(sim, [{ id: 'crit', level: 5 }]); // arma com crit -> critChance>0 -> saca o rolo de crit em cada golpe
    for (let i = 0; i < 200; i++) {
      const p = player(sim);
      let mob: Entity | null = null; let bd = Infinity;
      for (const e of inner(sim).ents.values()) {
        if (e.kind !== 'enemy') continue;
        const d = (e.x - p.x) ** 2 + (e.z - p.z) ** 2;
        if (d < bd) { bd = d; mob = e; }
      }
      if (mob) { sim.sendCommand({ t: 'move', dx: mob.x - p.x, dz: mob.z - p.z }); sim.sendCommand({ t: 'set-target', id: mob.id }); sim.sendCommand({ t: 'use-ability', slot: 1 }); }
      sim.step();
    }
    return sim.hash();
  };
  it('mesma seed + arma de crit em combate => hash idêntico', () => {
    expect(critCombat(4)).toBe(critCombat(4));
  });
});
