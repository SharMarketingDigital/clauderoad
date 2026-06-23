import { describe, it, expect } from 'vitest';
import { DEGREES, degreeOf, degreeDef, equipLevelReq, meetsLevelReq } from '../src/sim/content/degrees';
import { ITEMS, type ItemDef } from '../src/sim/content/items';

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

// --- Slice 1: degree'd weapon definitions (data-level, no Sim needed) ---
const DEGREE_WEAPONS = [
  { base: 'old_sword', d2: 'iron_sword', d3: 'steel_sword', mastery: 'sword' },
  { base: 'iron_spear', d2: 'steel_spear', d3: 'halberd', mastery: 'spear' },
  { base: 'short_bow', d2: 'hunters_bow', d3: 'composite_bow', mastery: 'bow' },
  { base: 'apprentice_staff', d2: 'adept_staff', d3: 'sorcerer_staff', mastery: 'mage' },
] as const;

describe('degrees — armas com grau (bake honesto + consistência)', () => {
  for (const w of DEGREE_WEAPONS) {
    const base = ITEMS[w.base];
    for (const [deg, id] of [[2, w.d2], [3, w.d3]] as const) {
      it(`${id}: ${deg}º grau de ${w.base}, stats baked = base × statMult`, () => {
        const item = ITEMS[id];
        expect(item).toBeDefined();
        expect(item.slot).toBe('weapon');
        expect(item.mastery).toBe(w.mastery);
        expect(item.degree).toBe(deg);
        // reqLevel matches the band exactly (catches an authoring typo)
        expect(item.reqLevel).toBe(degreeDef(deg)!.reqLevel);
        // the baked weaponDamage is locked to round(base × statMult) — drift fails CI,
        // since the sim reads this literal and NEVER re-applies statMult at runtime
        const expected = Math.round(base.stats!.weaponDamage! * degreeDef(deg)!.statMult);
        expect(item.stats!.weaponDamage).toBe(expected);
        // strictly stronger than the base, so a higher degree always out-ranks it
        expect(item.stats!.weaponDamage!).toBeGreaterThan(base.stats!.weaponDamage!);
      });
    }
  }

  it('as armas base continuam legadas (sem degree/reqLevel) — equipar segue sem gate', () => {
    for (const w of DEGREE_WEAPONS) {
      expect(ITEMS[w.base].degree).toBeUndefined();
      expect(ITEMS[w.base].reqLevel).toBeUndefined();
    }
  });
});
