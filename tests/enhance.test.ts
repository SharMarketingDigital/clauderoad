// K4 — the pure alchemy resolver. Outcomes are a strict function of the two INJECTED unit
// draws, so each branch is asserted directly (no Rng, no seed dependency). This OWNS the
// "a sub-RISK_FLOOR failure degrades by exactly 1, never breaks" guarantee that the seeded
// alchemy loop in sim.test.ts used to assert (relocated here so green-ness can't hinge on a seed).
import { describe, it, expect } from 'vitest';
import { enhanceChance, enhanceStat, resolveEnhance, needsBreakRoll } from '../src/sim/enhance';
import { Rng } from '../src/sim/rng';
import {
  MAX_PLUS, RISK_FLOOR, BREAK_CHANCE, DROP_ON_FAIL, PROTECT_DROP_CAP,
} from '../src/sim/content/enhance';

const SUCCEED = 0; // roll1 < any positive chance -> success
const FAIL = 1;    // roll1 >= any chance (chance is always < 1) -> failure

describe('K4 resolveEnhance (pure)', () => {
  it('(a) success raises "+" by one, clamped to MAX_PLUS', () => {
    for (let plus = 0; plus < MAX_PLUS; plus++) {
      expect(resolveEnhance(plus, false, SUCCEED, FAIL)).toEqual({
        kind: 'success', nextPlus: Math.min(MAX_PLUS, plus + 1),
      });
    }
  });

  it('(b) below RISK_FLOOR a failure ALWAYS degrades by exactly 1 and NEVER breaks', () => {
    for (let plus = 0; plus < RISK_FLOOR; plus++) {
      // even with the worst possible break roll (0), the low-"+" branch ignores roll2
      expect(resolveEnhance(plus, false, FAIL, 0)).toEqual({
        kind: 'degrade', nextPlus: Math.max(0, plus - 1), drop: 1,
      });
    }
  });

  it('(c) at/above RISK_FLOOR an unprotected failure breaks on a low roll2, else multi-drops', () => {
    for (let plus = RISK_FLOOR; plus < MAX_PLUS; plus++) {
      const breakRoll = (BREAK_CHANCE[plus] ?? 0) / 2; // < BREAK_CHANCE -> break
      expect(resolveEnhance(plus, false, FAIL, breakRoll)).toEqual({ kind: 'break' });
      const drop = DROP_ON_FAIL[plus] ?? 1;
      expect(resolveEnhance(plus, false, FAIL, 0.999)).toEqual({ // >= BREAK_CHANCE -> degrade
        kind: 'degrade', nextPlus: Math.max(0, plus - drop), drop,
      });
    }
  });

  it('(d) protection never breaks and caps the drop to PROTECT_DROP_CAP', () => {
    for (let plus = RISK_FLOOR; plus < MAX_PLUS; plus++) {
      const o = resolveEnhance(plus, true, FAIL, 0); // worst break roll, still protected
      const drop = Math.min(DROP_ON_FAIL[plus] ?? 1, PROTECT_DROP_CAP);
      expect(o).toEqual({ kind: 'degrade', nextPlus: Math.max(0, plus - drop), drop });
      expect(drop).toBeLessThanOrEqual(PROTECT_DROP_CAP);
    }
  });

  it('(e) nextPlus stays within [0, MAX_PLUS]; no success past the cap', () => {
    expect(enhanceChance(MAX_PLUS)).toBe(0); // cap has 0 success chance
    expect(resolveEnhance(0, false, FAIL, 0)).toEqual({ kind: 'degrade', nextPlus: 0, drop: 1 });
    expect(resolveEnhance(MAX_PLUS - 1, false, SUCCEED, FAIL)).toEqual({
      kind: 'success', nextPlus: MAX_PLUS,
    });
  });

  it('enhanceStat / enhanceChance still behave after the module move', () => {
    expect(enhanceStat(10, 0)).toBe(10);
    expect(enhanceStat(10, 5)).toBeGreaterThan(enhanceStat(10, 0));
    expect(enhanceChance(0)).toBeGreaterThan(enhanceChance(5)); // chance falls as "+" rises
    expect(enhanceChance(5)).toBeGreaterThan(enhanceChance(9));
  });
});

// T1.2 — needsBreakRoll is the SINGLE source for "does the 2nd draw happen". sim.enhance() uses
// it to gate `this.rng.next()` and resolveEnhance() uses it to consume roll2; testing it here pins
// the contract both sides share, so the draw COUNT and the consumption can't drift apart.
describe('K4 needsBreakRoll — single gate for the break-vs-degrade draw', () => {
  it('is true ONLY for an unprotected FAILURE at/above RISK_FLOOR', () => {
    for (let plus = 0; plus < MAX_PLUS; plus++) {
      expect(needsBreakRoll(plus, false, SUCCEED)).toBe(false); // a success never needs roll2
    }
    for (let plus = 0; plus < RISK_FLOOR; plus++) {
      expect(needsBreakRoll(plus, false, FAIL)).toBe(false); // gentle band: no break roll
    }
    for (let plus = RISK_FLOOR; plus < MAX_PLUS; plus++) {
      expect(needsBreakRoll(plus, false, FAIL)).toBe(true);  // risk band, unprotected
      expect(needsBreakRoll(plus, true, FAIL)).toBe(false);  // protected => never
    }
  });
});

// T1.2 — explicit Rng draw-COUNT check: replicate sim.enhance()'s EXACT draw protocol with the
// production Rng + the production predicate (roll1 always; roll2 ONLY when needsBreakRoll). This
// catches a refactor that adds/drops the conditional 2nd draw and desyncs the deterministic stream.
describe('K4 alchemy draw count — roll2 is pulled iff needsBreakRoll', () => {
  const drawsConsumed = (plus: number, prot: boolean, seed: number): number => {
    const rng = new Rng(seed);
    const roll1 = rng.next(); // always
    let n = 1;
    if (needsBreakRoll(plus, prot, roll1)) { rng.next(); n++; } // conditional roll2
    return n;
  };
  const seedWhere = (pred: (r: number) => boolean): number => {
    for (let s = 1; s < 500; s++) if (pred(new Rng(s).next())) return s;
    return -1;
  };

  it('draws 2 on an unprotected risk-band failure; 1 when protected, below the floor, or on success', () => {
    const chance = enhanceChance(RISK_FLOOR);
    const failSeed = seedWhere((r) => r >= chance); // roll1 fails -> reaches the risk band
    const okSeed = seedWhere((r) => r < chance);    // roll1 succeeds
    expect(failSeed).toBeGreaterThan(0);
    expect(okSeed).toBeGreaterThan(0);

    expect(drawsConsumed(RISK_FLOOR, false, failSeed)).toBe(2);     // unprotected risk-band failure
    expect(drawsConsumed(RISK_FLOOR, true, failSeed)).toBe(1);      // protected -> roll2 never pulled
    expect(drawsConsumed(RISK_FLOOR - 1, false, failSeed)).toBe(1); // below the floor -> 1
    expect(drawsConsumed(RISK_FLOOR, false, okSeed)).toBe(1);       // success -> 1
  });
});
