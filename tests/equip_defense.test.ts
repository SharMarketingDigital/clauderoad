// K3 — defensive stats on equipment. Items carry phyDef/magDef (src/sim/content/items.ts);
// recomputeStats folds them onto the entity (Entity.phyDef/magDef) with the SAME
// rarity -> "+N" -> durability scaling as the offensive stats. These tests verify the AGGREGATION
// (the sheet values); the mitigation that READS them in combat is covered in armor.test.ts. They read
// the internal entity directly via the same `as unknown as` escape hatch the sim suite already uses.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';
import type { Rarity } from '../src/world_api';
import { addToBag } from '../src/sim/inventory';
import { rarityStat } from '../src/sim/sim';

type Internal = { ents: Map<number, Entity> };
const ents = (sim: Sim): Entity[] => [...(sim as unknown as Internal).ents.values()];
const player = (sim: Sim): Entity => ents(sim).find((e) => e.kind === 'player')!;
const give = (sim: Sim, itemId: string, rarity: Rarity = 'normal', plus = 0, qty = 1): void => {
  addToBag(player(sim).bag, itemId, rarity, plus, qty);
};
// Equip a freshly-given bag item and advance one tick so the command is applied.
const equip = (sim: Sim, itemId: string, rarity: Rarity = 'normal', plus = 0): void => {
  give(sim, itemId, rarity, plus);
  sim.sendCommand({ t: 'equip', itemId, rarity, plus });
  sim.step();
};

describe('K3 — defensive stats on equipment', () => {
  it('equipping a protective piece raises phyDef/magDef; maxHp still rises (sibling, not replacement); unequip reverts', () => {
    const sim = new Sim(1);
    const p0 = player(sim);
    expect(p0.phyDef).toBe(0);
    expect(p0.magDef).toBe(0);
    const maxHpBefore = p0.maxHp;

    equip(sim, 'wolf_leather'); // chest: { maxHp: 20, phyDef: 2, magDef: 1 } at Normal +0, full durability
    expect(player(sim).phyDef).toBe(2);
    expect(player(sim).magDef).toBe(1);
    expect(player(sim).maxHp).toBe(maxHpBefore + 20); // defense is a SIBLING of maxHp, never replaces it

    sim.sendCommand({ t: 'unequip', slot: 'chest' });
    sim.step();
    expect(player(sim).phyDef).toBe(0);
    expect(player(sim).magDef).toBe(0);
    expect(player(sim).maxHp).toBe(maxHpBefore);
  });

  it('a full protective set sums defense across slots; accessories and weapons add none', () => {
    const sim = new Sim(2);
    // helmet+chest+hands+legs+feet+shield = phyDef 1+2+1+2+1+2 = 9, magDef 1+1+1+1+1+2 = 7
    equip(sim, 'leather_cap'); // helmet
    equip(sim, 'wolf_leather'); // chest
    equip(sim, 'leather_gloves'); // hands
    equip(sim, 'leather_pants'); // legs
    equip(sim, 'leather_boots'); // feet
    equip(sim, 'wooden_shield'); // shield
    expect(player(sim).phyDef).toBe(9);
    expect(player(sim).magDef).toBe(7);

    // accessories (no defense) and a weapon (no defense) must not change the totals
    equip(sim, 'copper_necklace');
    equip(sim, 'copper_ring');
    equip(sim, 'old_sword');
    expect(player(sim).phyDef).toBe(9);
    expect(player(sim).magDef).toBe(7);
  });

  it('defense scales with rarity (rarer = strictly more), via the same rarityStat used by the other stats', () => {
    const base = new Sim(3);
    equip(base, 'wolf_leather', 'normal');
    const normalPhy = player(base).phyDef;
    expect(normalPhy).toBe(2);

    const sun = new Sim(3);
    equip(sun, 'wolf_leather', 'sun');
    expect(player(sun).phyDef).toBe(rarityStat(2, 'sun')); // exact: rarity-scaled, +0, full durability
    expect(player(sun).phyDef).toBeGreaterThan(normalPhy);
  });

  it('defense scales with "+N" enhancement (higher + = strictly more)', () => {
    const a = new Sim(4);
    equip(a, 'wolf_leather', 'normal', 0);
    const at0 = player(a).phyDef;

    const b = new Sim(4);
    equip(b, 'wolf_leather', 'normal', 3);
    expect(player(b).phyDef).toBeGreaterThan(at0);
  });

  it('worn gear gives less defense (durability scaling), like the other gear stats', () => {
    const sim = new Sim(5);
    equip(sim, 'wolf_leather'); // chest, full durability -> phyDef 2
    expect(player(sim).phyDef).toBe(2);

    // Wear the chest down to 0, then trigger a recompute by equipping a (defense-less) weapon.
    player(sim).equipment.chest!.durability = 0;
    equip(sim, 'old_sword'); // weapon -> recomputeStats runs, folding the now-worn chest
    expect(player(sim).phyDef).toBeLessThan(2); // durabilityFactor(0) = 0.4 -> round(2 * 0.4) = 1
    expect(player(sim).phyDef).toBe(1);
  });

  it('enemies (and the vendor NPC) carry zero defense — combat behaviour is unchanged', () => {
    const sim = new Sim(6);
    for (let i = 0; i < 3; i++) sim.step();
    const enemy = ents(sim).find((e) => e.kind === 'enemy');
    expect(enemy).toBeDefined();
    expect(enemy!.phyDef).toBe(0);
    expect(enemy!.magDef).toBe(0);
    const npc = ents(sim).find((e) => e.kind === 'npc');
    if (npc) {
      expect(npc.phyDef).toBe(0);
      expect(npc.magDef).toBe(0);
    }
  });

  it('defense is DERIVED, not persisted: it is regenerated by recompute on restore', () => {
    const a = new Sim(7);
    equip(a, 'wolf_leather');
    const id = player(a).id;
    expect(player(a).phyDef).toBe(2);
    const save = a.serializePlayer(id)!;
    expect(save).toBeTruthy();

    const b = new Sim(8);
    const bid = player(b).id;
    b.restorePlayer(bid, JSON.parse(JSON.stringify(save))); // through JSON, like the DB
    // The save carries the equipped chest (gear identity), NOT the derived defense; restore
    // recomputes it, so the chest's phyDef/magDef come back exactly.
    expect(player(b).phyDef).toBe(2);
    expect(player(b).magDef).toBe(1);
  });

  it('defense in play does not break determinism (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      equip(sim, 'wolf_leather');
      sim.step();
      return sim.hash();
    };
    expect(run(11)).toBe(run(11));
  });
});
