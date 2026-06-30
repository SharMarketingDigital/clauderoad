// Set completo de gear dropável (Fatia 1). Every equip slot now has at least one drop source across the
// mob + boss tables; an equippable drop automatically rolls a rarity (the slot != null gate in rollLoot);
// and adding entries keeps run-to-run determinism. Three layers: a pure data coverage check, an
// end-to-end "the new pieces actually drop with a rarity", and a determinism run.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import { ENEMY_TEMPLATE, ROGUE_TEMPLATE, WARRIOR_TEMPLATE, MAGE_TEMPLATE } from '../src/sim/content/enemies';
import { BOSS_TEMPLATE, WARLORD_TEMPLATE } from '../src/sim/content/bosses';
import { ITEMS } from '../src/sim/content/items';
import { EQUIP_SLOTS } from '../src/sim/inventory';
import type { Rarity } from '../src/world_api';

const ALL_DROP_TABLES = [ENEMY_TEMPLATE, ROGUE_TEMPLATE, WARRIOR_TEMPLATE, MAGE_TEMPLATE, BOSS_TEMPLATE, WARLORD_TEMPLATE];
const RARITIES: Rarity[] = ['normal', 'sos', 'som', 'sun'];

describe('Gear dropável — cobertura de slots (dados)', () => {
  it('every equip slot has at least one droppable source across the mob + boss tables', () => {
    // Build slot -> [itemIds that drop into it] from every drop table.
    const coveredBy: Record<string, string[]> = {};
    for (const t of ALL_DROP_TABLES) {
      for (const d of t.drops) {
        const slot = ITEMS[d.itemId]?.slot;
        if (slot) (coveredBy[slot] ??= []).push(d.itemId);
      }
    }
    // Assert all 10 slots are covered (with a helpful message naming any gap).
    const missing = EQUIP_SLOTS.filter((s) => !coveredBy[s]?.length);
    expect(missing).toEqual([]);
    for (const s of EQUIP_SLOTS) expect(coveredBy[s]!.length).toBeGreaterThan(0);
  });

  it('every dropped equippable item id actually exists in ITEMS with that slot (no typos)', () => {
    for (const t of ALL_DROP_TABLES) {
      for (const d of t.drops) {
        const def = ITEMS[d.itemId];
        expect(def, `drop "${d.itemId}" must exist in ITEMS`).toBeDefined();
        expect(d.chance).toBeGreaterThan(0);
        expect(d.chance).toBeLessThanOrEqual(1);
      }
    }
  });
});

type Internal = { ents: Map<number, Entity> };
const ents = (sim: Sim): Entity[] => [...(sim as unknown as Internal).ents.values()];
const player = (sim: Sim): Entity => ents(sim).find((e) => e.kind === 'player')!;
const nearestWolf = (sim: Sim): Entity | undefined => {
  const p = player(sim);
  let best: Entity | undefined;
  let bd = Infinity;
  for (const e of ents(sim)) {
    if (e.kind !== 'enemy') continue;
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
};
// Farm ring-1 Lacaios for a window WITHOUT picking up loot (so the drops pile on the ground to inspect).
const farm = (sim: Sim, ticks: number): void => {
  for (let i = 0; i < ticks; i++) {
    const p = player(sim);
    const w = nearestWolf(sim);
    if (w) {
      sim.sendCommand({ t: 'set-target', id: w.id });
      sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      sim.sendCommand({ t: 'use-ability', slot: 1 }); // Golpe Forte when off cooldown (faster kills)
    }
    sim.step();
  }
};

describe('Gear dropável — os drops novos caem com raridade (end-to-end)', () => {
  it('farming ring 1 drops the new leather pieces, each carrying a valid rarity', () => {
    const sim = new Sim(7);
    farm(sim, 3000); // kills many Lacaios; ground loot accumulates (never picked up)
    const groundLoot = ents(sim).filter((e) => e.kind === 'loot' && e.loot != null);
    const equippable = groundLoot.filter((e) => ITEMS[e.loot!.stack.itemId]?.slot != null);

    expect(equippable.length).toBeGreaterThan(0); // gear did drop
    for (const e of equippable) {
      expect(RARITIES).toContain(e.loot!.stack.rarity); // every equippable drop has a rolled rarity
    }
    // ...and at least one of the NEW ring-1 pieces (not the pre-existing wolf_leather/old_sword) dropped.
    const newRing1 = new Set(['leather_cap', 'leather_gloves']);
    expect(equippable.some((e) => newRing1.has(e.loot!.stack.itemId))).toBe(true);
  });
});

describe('Gear dropável — determinismo', () => {
  it('a farm run hashes identically run-to-run (adding drops keeps the gate byte-identical)', () => {
    const run = (): string => {
      const sim = new Sim(7);
      farm(sim, 600);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
