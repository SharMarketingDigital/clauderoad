// K4 — the pure alchemy resolver. Outcomes are a strict function of the two INJECTED unit
// draws, so each branch is asserted directly (no Rng, no seed dependency). This OWNS the
// "a sub-RISK_FLOOR failure degrades by exactly 1, never breaks" guarantee that the seeded
// alchemy loop in sim.test.ts used to assert (relocated here so green-ness can't hinge on a seed).
import { describe, it, expect } from 'vitest';
import { enhanceChance, enhanceStat, resolveEnhance } from '../src/sim/enhance';
import {
  MAX_PLUS, RISK_FLOOR, BREAK_CHANCE, DROP_ON_FAIL, PROTECT_DROP_CAP,
} from '../src/sim/content/enhance';

const SUCCEED = 0; // roll1 < any positive chance -> success
const FAIL = 1;    // roll1 >= any chance (chance is always < 1) -> failure

describe('K4 resolveEnhance (pure)', () => {
  it('(a) success raises "+" by one, clamped to MAX_PLUS', () => {
    for (let plus = 0; plus < MAX_PLUS; plus++) {
      expect(resolveEnhance(plus, false, false, SUCCEED, FAIL)).toEqual({
        kind: 'success', nextPlus: Math.min(MAX_PLUS, plus + 1),
      });
    }
  });

  it('(b) below RISK_FLOOR a failure ALWAYS degrades by exactly 1 and NEVER breaks', () => {
    for (let plus = 0; plus < RISK_FLOOR; plus++) {
      // even with the worst possible break roll (0), the low-"+" branch ignores roll2
      expect(resolveEnhance(plus, false, false, FAIL, 0)).toEqual({
        kind: 'degrade', nextPlus: Math.max(0, plus - 1), drop: 1,
      });
    }
  });

  it('(c) at/above RISK_FLOOR an unprotected failure breaks on a low roll2, else multi-drops', () => {
    for (let plus = RISK_FLOOR; plus < MAX_PLUS; plus++) {
      const breakRoll = (BREAK_CHANCE[plus] ?? 0) / 2; // < BREAK_CHANCE -> break
      expect(resolveEnhance(plus, false, false, FAIL, breakRoll)).toEqual({ kind: 'break' });
      const drop = DROP_ON_FAIL[plus] ?? 1;
      expect(resolveEnhance(plus, false, false, FAIL, 0.999)).toEqual({ // >= BREAK_CHANCE -> degrade
        kind: 'degrade', nextPlus: Math.max(0, plus - drop), drop,
      });
    }
  });

  it('(d) protection never breaks and caps the drop to PROTECT_DROP_CAP', () => {
    for (let plus = RISK_FLOOR; plus < MAX_PLUS; plus++) {
      const o = resolveEnhance(plus, false, true, FAIL, 0); // worst break roll, still protected
      const drop = Math.min(DROP_ON_FAIL[plus] ?? 1, PROTECT_DROP_CAP);
      expect(o).toEqual({ kind: 'degrade', nextPlus: Math.max(0, plus - drop), drop });
      expect(drop).toBeLessThanOrEqual(PROTECT_DROP_CAP);
    }
  });

  it('(e) nextPlus stays within [0, MAX_PLUS]; no success past the cap', () => {
    expect(enhanceChance(MAX_PLUS, true)).toBe(0); // cap has 0 success chance
    expect(resolveEnhance(0, false, false, FAIL, 0)).toEqual({ kind: 'degrade', nextPlus: 0, drop: 1 });
    expect(resolveEnhance(MAX_PLUS - 1, false, false, SUCCEED, FAIL)).toEqual({
      kind: 'success', nextPlus: MAX_PLUS,
    });
  });

  it('enhanceStat / enhanceChance still behave after the module move', () => {
    expect(enhanceStat(10, 0)).toBe(10);
    expect(enhanceStat(10, 5)).toBeGreaterThan(enhanceStat(10, 0));
    expect(enhanceChance(0, false)).toBeGreaterThan(enhanceChance(5, false));
    expect(enhanceChance(5, true)).toBeGreaterThan(enhanceChance(5, false));
  });
});
