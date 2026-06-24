// K1: the save schema now carries the full Silkroad equipment set (10 slots). These
// tests pin the generalized, DEFENSIVE persistence: every real slot round-trips, and
// unknown / wrong-slot / legacy-'armor' / garbage entries are dropped without throwing.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';

const freshSave = (over: Record<string, unknown>) => ({
  level: 5, xp: 0, attrPoints: 0,
  baseStr: 16, baseInt: 5, baseMaxHp: 200, baseMaxMp: 80,
  sp: 0, skillRanks: {}, gold: 100, bag: [],
  ...over,
});

const allNull = () => ({
  weapon: null, shield: null, helmet: null, chest: null, hands: null,
  legs: null, feet: null, necklace: null, earring: null, ring: null,
});

describe('K1 — equipment save schema (all slots, defensive)', () => {
  it('round-trips the equipped slots and fills the rest with null', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    const equipment = {
      ...allNull(),
      weapon: { itemId: 'old_sword', rarity: 'sos', plus: 2, durability: 70 },
      chest: { itemId: 'wolf_leather', rarity: 'normal', plus: 0, durability: 100 },
    };
    sim.restorePlayer(a, JSON.parse(JSON.stringify(freshSave({ equipment }))));
    expect(sim.serializePlayer(a)!.equipment).toEqual(equipment); // all 10 keys; weapon + chest preserved
  });

  it('drops unknown / wrong-slot / not-equippable items and a legacy "armor" key — never throws, valid slot survives', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, freshSave({
      equipment: {
        weapon: { itemId: 'nope_unknown', rarity: 'normal', plus: 0, durability: 50 }, // unknown id -> drop
        helmet: { itemId: 'old_sword', rarity: 'normal', plus: 0, durability: 50 },     // wrong slot (weapon) -> drop
        ring: { itemId: 'health_potion', rarity: 'normal', plus: 0, durability: 50 },   // not equippable -> drop
        chest: { itemId: 'wolf_leather', rarity: 'normal', plus: 0, durability: 100 },  // valid -> survives
        armor: { itemId: 'wolf_leather', rarity: 'normal', plus: 0, durability: 100 },  // legacy slot key -> ignored
      },
    }));
    const out = sim.serializePlayer(a)!;
    expect(out.equipment.weapon).toBeNull();
    expect(out.equipment.helmet).toBeNull();
    expect(out.equipment.ring).toBeNull();
    expect(out.equipment.chest?.itemId).toBe('wolf_leather'); // the right-slot item still loads
    expect('armor' in out.equipment).toBe(false);             // no legacy slot survives
  });

  it('a non-object / garbage equipment never throws and yields all-null slots', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    for (const bad of [null, undefined, 7, 'x', []]) {
      sim.restorePlayer(a, freshSave({ equipment: bad }));
      expect(sim.serializePlayer(a)!.equipment).toEqual(allNull());
    }
  });
});
