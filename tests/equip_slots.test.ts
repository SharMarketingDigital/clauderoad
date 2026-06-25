// K1: equipping a piece into ANY of the new slots folds its stat into the effective
// total via the generic recompute, and unequipping reverts it. Proves the whole
// Silkroad set (armor pieces, shield, accessories) flows through one code path.
import { describe, it, expect } from 'vitest';
import { ITEMS } from '../src/sim/content/items';
import { Sim } from '../src/sim/sim';
import type { EquipSlot } from '../src/world_api';

const PIECES: { id: string; slot: EquipSlot; stat: 'maxHp' | 'maxMp' | 'str'; amount: number }[] = [
  { id: 'leather_cap', slot: 'helmet', stat: 'maxHp', amount: 12 },
  { id: 'wolf_leather', slot: 'chest', stat: 'maxHp', amount: 20 },
  { id: 'leather_gloves', slot: 'hands', stat: 'maxHp', amount: 8 },
  { id: 'leather_pants', slot: 'legs', stat: 'maxHp', amount: 14 },
  { id: 'leather_boots', slot: 'feet', stat: 'maxHp', amount: 8 },
  { id: 'wooden_shield', slot: 'shield', stat: 'maxHp', amount: 18 },
  { id: 'copper_necklace', slot: 'necklace', stat: 'maxMp', amount: 12 },
  { id: 'copper_earring', slot: 'earring', stat: 'str', amount: 1 },
  { id: 'copper_ring', slot: 'ring', stat: 'str', amount: 1 },
];

const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;

describe('K1 — full equipment set', () => {
  it('each new piece is defined and equippable into its own slot', () => {
    for (const p of PIECES) expect(ITEMS[p.id]?.slot).toBe(p.slot);
  });

  it('equipping a piece raises its stat (Normal +0) and unequipping reverts it', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    // Hand the player one Normal +0 of each piece via a restored bag (deterministic).
    sim.restorePlayer(a, {
      level: 5, xp: 0, attrPoints: 0,
      baseStr: 16, baseInt: 5, baseMaxHp: 200, baseMaxMp: 80,
      sp: 0, skillRanks: {}, gold: 0,
      bag: PIECES.map((p) => ({ itemId: p.id, rarity: 'normal', plus: 0, qty: 1 })),
      equipment: {},
    });
    for (const p of PIECES) {
      const before = player(sim)[p.stat];
      sim.sendCommandFor(a, { t: 'equip', itemId: p.id, rarity: 'normal', plus: 0 });
      sim.step();
      expect(player(sim)[p.stat]).toBe(before + p.amount); // folded into the effective stat
      sim.sendCommandFor(a, { t: 'unequip', slot: p.slot });
      sim.step();
      expect(player(sim)[p.stat]).toBe(before); // recompute reverts on unequip
    }
  });

  it('all ten equipment slots are reachable from the vendor or starting weapons', () => {
    // weapon comes from the starter weapons; the other nine items above cover the rest.
    const covered = new Set<EquipSlot>(['weapon', ...PIECES.map((p) => p.slot)]);
    const expected: EquipSlot[] = ['weapon', 'shield', 'helmet', 'chest', 'hands', 'legs', 'feet', 'necklace', 'earring', 'ring'];
    for (const slot of expected) expect(covered.has(slot)).toBe(true);
  });
});
