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
  ENHANCE_STAT_PER_PLUS,
  RISK_FLOOR,
  BREAK_CHANCE,
  DROP_ON_FAIL,
  PROTECT_DROP_CAP,
} from './content/enhance';

// Success chance of an enhance attempt from `plus` -> plus+1. 0 at the cap. Pure & deterministic.
export function enhanceChance(plus: number): number {
  if (plus < 0 || plus >= MAX_PLUS) return 0;
  return ENHANCE_SUCCESS[plus] ?? 0;
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

// Whether the SECOND draw (roll2 — break vs degrade) is consulted at all: a FAILED attempt
// (roll1 missed the success chance) at/above RISK_FLOOR that is NOT protected. This is the
// SINGLE SOURCE of "do we need roll2" — both sim.enhance() (to decide whether to pull a 2nd
// this.rng.next()) and resolveEnhance() (to decide whether to consume roll2) call it, so the
// draw COUNT and the draw CONSUMPTION can never drift apart. Pure & deterministic.
export function needsBreakRoll(plus: number, protectedAttempt: boolean, roll1: number): boolean {
  return roll1 >= enhanceChance(plus) && plus >= RISK_FLOOR && !protectedAttempt;
}

// Resolve ONE attempt. PURE — the caller passes the two unit draws in [0,1):
//   roll1: the success draw (always consulted).
//   roll2: the break-vs-degrade draw, consulted ONLY when needsBreakRoll(...) is true (an
//          unprotected failure at/above RISK_FLOOR); pass any value (e.g. 0) otherwise.
// `protectedAttempt` = the player asked for protection AND a Pedra de Proteção is held.
export function resolveEnhance(
  plus: number,
  protectedAttempt: boolean,
  roll1: number,
  roll2: number,
): EnhanceOutcome {
  if (roll1 < enhanceChance(plus)) {
    return { kind: 'success', nextPlus: Math.min(MAX_PLUS, plus + 1) };
  }
  // --- failure ---
  // roll2 matters ONLY when needsBreakRoll is true — the SAME gate sim.enhance() uses to decide
  // whether it pulled roll2 from the Rng, so the consumption matches the draw count exactly.
  if (needsBreakRoll(plus, protectedAttempt, roll1)) {
    if (roll2 < (BREAK_CHANCE[plus] ?? 0)) return { kind: 'break' };
    const drop = DROP_ON_FAIL[plus] ?? 1;
    return { kind: 'degrade', nextPlus: Math.max(0, plus - drop), drop };
  }
  // No break roll: a Pedra de Proteção caps the drop (the "piso", no break) at/above the floor;
  // otherwise the gentle pre-K4 -1.
  if (protectedAttempt && plus >= RISK_FLOOR) {
    const drop = Math.min(DROP_ON_FAIL[plus] ?? 1, PROTECT_DROP_CAP);
    return { kind: 'degrade', nextPlus: Math.max(0, plus - drop), drop };
  }
  return { kind: 'degrade', nextPlus: Math.max(0, plus - 1), drop: 1 }; // gentle (pre-K4)
}
