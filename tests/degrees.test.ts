import { describe, it, expect } from 'vitest';
import { DEGREES, degreeOf, degreeDef, equipLevelReq, meetsLevelReq } from '../src/sim/content/degrees';
import type { ItemDef } from '../src/sim/content/items';

// Pure-helper tests: degrees.ts has no Sim/Rng/DOM dependency, so we exercise it with
// minimal hand-built ItemDefs (no world needed). These guard the data model + the
// reqLevel derivation that Slice 2's equip gate and Slice 4a's canEquip rely on.
const legacy: ItemDef = { id: 'x', name: 'X', slot: 'weapon' }; // no degree/reqLevel (pre-K2 item)
const d2explicit: ItemDef = { id: 'y', name: 'Y', slot: 'weapon', degree: 2, reqLevel: 4 };
const d3derived: ItemDef = { id: 'z', name: 'Z', slot: 'weapon', degree: 3 }; // reqLevel comes from the band
const potion: ItemDef = { id: 'p', name: 'P', consumable: { healHp: 1 } }; // non-equippable

describe('degrees (modelo de graus)', () => {
  it('DEGREES is the authored 3-band ladder, grounded in the zone curve', () => {
    expect(DEGREES.map((d) => d.degree)).toEqual([1, 2, 3]);
    expect(DEGREES.map((d) => d.reqLevel)).toEqual([1, 4, 8]);
    // the top degree stays BELOW the level-10 cap (headroom to grow into it)
    expect(Math.max(...DEGREES.map((d) => d.reqLevel))).toBeLessThan(10);
    // combined-ceiling guard: statMult never exceeds the value agreed with combat (1.8),
    // so a D-top / SUN / +10 weapon can't blow past the tuned damage curve.
    expect(Math.max(...DEGREES.map((d) => d.statMult))).toBeLessThanOrEqual(1.8);
    // monotonic: each degree is at least as strong and at least as gated as the previous
    for (let i = 1; i < DEGREES.length; i++) {
      expect(DEGREES[i].statMult).toBeGreaterThan(DEGREES[i - 1].statMult);
      expect(DEGREES[i].reqLevel).toBeGreaterThan(DEGREES[i - 1].reqLevel);
    }
  });

  it('degreeOf defaults a legacy item to grau 1', () => {
    expect(degreeOf(legacy)).toBe(1);
    expect(degreeOf(d2explicit)).toBe(2);
  });

  it('degreeDef looks a band up by number', () => {
    expect(degreeDef(2)?.reqLevel).toBe(4);
    expect(degreeDef(3)?.statMult).toBe(1.8);
    expect(degreeDef(99)).toBeUndefined();
  });

  it('equipLevelReq prefers explicit reqLevel, else derives from the degree band, else 0', () => {
    expect(equipLevelReq(legacy)).toBe(0); // no degree, no reqLevel => no requirement
    expect(equipLevelReq(potion)).toBe(0); // non-equippable => no requirement
    expect(equipLevelReq(d2explicit)).toBe(4); // explicit reqLevel wins
    expect(equipLevelReq(d3derived)).toBe(8); // derived from the DEGREES band for degree 3
  });

  it('meetsLevelReq gates strictly at the floor and is inert for legacy items', () => {
    expect(meetsLevelReq(legacy, 1)).toBe(true); // legacy item: always equippable (req 0)
    expect(meetsLevelReq(d3derived, 7)).toBe(false); // below the floor (8)
    expect(meetsLevelReq(d3derived, 8)).toBe(true); // exactly at the floor
    expect(meetsLevelReq(d3derived, 9)).toBe(true); // above the floor
  });
});
