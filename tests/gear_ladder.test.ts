// Sistema 3 (gear-por-mob), Fatia 1: a escada de gear por grau. Garante que TODO slot equipável tem um
// item em cada grau 1/2/3, com o reqLevel certo da faixa (g1≤1 / g2=4 / g3=8), que cada grau é um upgrade
// estrito (nenhum item dominado), e que os stats de armadura seguem a regra baked round(base × statMult).
import { describe, it, expect } from 'vitest';
import { ITEMS, type ItemDef, type ItemStats } from '../src/sim/content/items';
import { DEGREES, degreeOf, equipLevelReq } from '../src/sim/content/degrees';
import type { EquipSlot } from '../src/world_api';

describe('escada de gear por grau (Sistema 3 — cobertura slot×grau)', () => {
  const equippable = Object.values(ITEMS).filter((i): i is ItemDef & { slot: EquipSlot } => i.slot != null);

  // Poder total do item (soma dos bônus) — usado só p/ comparar graus (upgrade estrito).
  const power = (i: ItemDef): number => {
    const s: ItemStats = i.stats ?? {};
    return (s.weaponDamage ?? 0) + (s.str ?? 0) + (s.maxHp ?? 0) + (s.maxMp ?? 0) + (s.phyDef ?? 0) + (s.magDef ?? 0);
  };

  // Cada arma é uma escada própria POR MAESTRIA; os demais slots, uma escada por slot.
  const groupKey = (i: ItemDef): string => (i.slot === 'weapon' ? `weapon:${i.mastery}` : i.slot!);
  const groups = new Map<string, ItemDef[]>();
  for (const i of equippable) {
    const k = groupKey(i);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(i);
  }

  it('todo slot equipável tem um item em cada grau 1/2/3', () => {
    for (const [k, items] of groups) {
      const degs = new Set(items.map(degreeOf));
      expect(degs.has(1), `${k} sem grau 1`).toBe(true);
      expect(degs.has(2), `${k} sem grau 2`).toBe(true);
      expect(degs.has(3), `${k} sem grau 3`).toBe(true);
    }
    // 9 slots de armadura/acessório (helmet/chest/hands/legs/feet/shield/necklace/earring/ring)
    // + 4 maestrias de arma (sword/spear/bow/mage) = 13 escadas.
    expect(groups.size).toBe(13);
  });

  it('o reqLevel de equipar bate com o grau (g1≤1, g2=4, g3=8)', () => {
    for (const i of equippable) {
      const deg = degreeOf(i);
      const req = equipLevelReq(i);
      if (deg === 1) expect(req, `${i.id} g1`).toBeLessThanOrEqual(1);
      if (deg === 2) expect(req, `${i.id} g2`).toBe(4);
      if (deg === 3) expect(req, `${i.id} g3`).toBe(8);
    }
  });

  it('cada grau é um upgrade ESTRITO (g1 < g2 < g3 em poder) — nenhum item dominado', () => {
    for (const [k, items] of groups) {
      const at = (d: number) => items.find((i) => degreeOf(i) === d)!;
      expect(power(at(2)), `${k}: g2 não supera g1`).toBeGreaterThan(power(at(1)));
      expect(power(at(3)), `${k}: g3 não supera g2`).toBeGreaterThan(power(at(2)));
    }
  });

  it('os stats de ARMADURA seguem a regra baked round(base × statMult) (degrees 1.4/1.8)', () => {
    const mult = (d: number) => DEGREES.find((x) => x.degree === d)!.statMult;
    // Só armadura defensiva: os acessórios de str (brinco/anel) usam ladder 1→2→3 de propósito (ver items.ts).
    const armorSlots: EquipSlot[] = ['helmet', 'chest', 'hands', 'legs', 'feet', 'shield'];
    for (const slot of armorSlots) {
      const items = groups.get(slot)!;
      const g1 = items.find((i) => degreeOf(i) === 1)!;
      for (const deg of [2, 3] as const) {
        const g = items.find((i) => degreeOf(i) === deg)!;
        for (const stat of ['maxHp', 'phyDef', 'magDef'] as const) {
          const base = g1.stats?.[stat] ?? 0;
          if (base > 0) expect(g.stats?.[stat], `${slot} g${deg} ${stat}`).toBe(Math.round(base * mult(deg)));
        }
      }
    }
  });
});
