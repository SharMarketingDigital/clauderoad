// Alchemy ("+N" enhancement) LOGIC — pure, deterministic, no DOM/Three, no Rng instance.
// The sim owns the Rng and the world; this module only RESOLVES an attempt from the current
// "+" and two unit draws the caller supplies (so the draw ORDER stays in the deterministic
// sim). The tuning DATA lives in content/enhance.ts. (Distinct file from that one: this is
// src/sim/enhance.ts = logic; src/sim/content/enhance.ts = numbers.)
//
// K4 — alquimia com risco real: a failed attempt at/above RISK_FLOOR can QUEBRAR (destroy)
// the item or drop multiple "+"; a Pedra de Proteção caps the drop to PROTECT_DROP_CAP and
// prevents the break. Below RISK_FLOOR a failure stays the gentle -1 (early game unchanged).
import {
  MAX_PLUS,
  ENHANCE_SUCCESS,
  LUCKY_POWDER_BONUS,
  ENHANCE_CHANCE_CAP,
  ENHANCE_STAT_PER_PLUS,
  RISK_FLOOR,
  BREAK_CHANCE,
  DROP_ON_FAIL,
  PROTECT_DROP_CAP,
} from './content/enhance';

// Success chance of an enhance attempt from `plus` -> plus+1, optionally boosted by a Lucky
// Powder. 0 at the cap. Pure & deterministic. (Moved here from sim.ts in K4.)
export function enhanceChance(plus: number, lucky: boolean): number {
  if (plus < 0 || plus >= MAX_PLUS) return 0;
  const base = ENHANCE_SUCCESS[plus] ?? 0;
  return Math.min(ENHANCE_CHANCE_CAP, base + (lucky ? LUCKY_POWDER_BONUS : 0));
}

// A "+N" item's bonus: the rarity-scaled stat, then +ENHANCE_STAT_PER_PLUS per level.
// Pure & deterministic. (Moved here from sim.ts in K4.)
export function enhanceStat(rarityScaled: number, plus: number): number {
  return Math.round(rarityScaled * (1 + ENHANCE_STAT_PER_PLUS * plus));
}

// The outcome of one enhance attempt. `success` raises "+" by one; `degrade` lowers it by
// `drop` (>= 1, floored at 0); `break` destroys the item (the caller nulls the slot).
export type EnhanceOutcome =
  | { kind: 'success'; nextPlus: number }
  | { kind: 'degrade'; nextPlus: number; drop: number }
  | { kind: 'break' };

// Resolve ONE attempt. PURE — the caller passes the two unit draws in [0,1):
//   roll1: the success draw (always consulted).
//   roll2: the break-vs-degrade draw, consulted ONLY on a failure at/above RISK_FLOOR that
//          is NOT protected; pass any value (e.g. 0) otherwise — it is ignored.
// `protectedAttempt` = the player asked for protection AND a Pedra de Proteção is held.
export function resolveEnhance(
  plus: number,
  lucky: boolean,
  protectedAttempt: boolean,
  roll1: number,
  roll2: number,
): EnhanceOutcome {
  if (roll1 < enhanceChance(plus, lucky)) {
    return { kind: 'success', nextPlus: Math.min(MAX_PLUS, plus + 1) };
  }
  // --- failure ---
  if (plus < RISK_FLOOR) {
    return { kind: 'degrade', nextPlus: Math.max(0, plus - 1), drop: 1 }; // gentle (pre-K4)
  }
  if (protectedAttempt) {
    const drop = Math.min(DROP_ON_FAIL[plus] ?? 1, PROTECT_DROP_CAP); // the "piso": no break
    return { kind: 'degrade', nextPlus: Math.max(0, plus - drop), drop };
  }
  if (roll2 < (BREAK_CHANCE[plus] ?? 0)) {
    return { kind: 'break' };
  }
  const drop = DROP_ON_FAIL[plus] ?? 1;
  return { kind: 'degrade', nextPlus: Math.max(0, plus - drop), drop };
}
