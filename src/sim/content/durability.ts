// Data-as-code death penalty (GDD §B8): a GENTLE but real cost. Today death is free
// (respawn at the safe point, no loss), which makes the boss winnable by cheap
// attrition. Now dying costs you: each death wears your EQUIPPED gear, so there's a
// gold repair bill that grows from the first death, and once a piece is worn low it
// gives less of its stat bonus — so attrition is no longer free. It's gentle — you
// never lose a level or an item, the bonus only fades (to a 40% floor) and is fully
// restorable at the vendor. Provisional — tune later.

export const MAX_DURABILITY = 100; // a fresh or fully-repaired item
export const DEATH_DURABILITY_LOSS = 20; // durability lost per death; the repair bill is felt from death 1, the stat loss by ~death 3
export const DURABILITY_WORN_AT = 50; // at/above this the gear is fine; below it the bonus starts dropping
export const DURABILITY_MIN_FACTOR = 0.4; // a fully-broken (0) item still gives this fraction of its bonus
export const REPAIR_COST_PER_POINT = 1; // gold to restore one point of durability at the vendor

// Fraction of an equipped item's bonus that applies at `durability`: 1.0 while the
// gear is healthy (>= DURABILITY_WORN_AT), then lerping down to DURABILITY_MIN_FACTOR
// at 0 — so death makes you weaker, but never useless, and a repair brings it back.
// Pure & deterministic.
export function durabilityFactor(durability: number): number {
  if (durability >= DURABILITY_WORN_AT) return 1;
  const t = Math.max(0, durability) / DURABILITY_WORN_AT; // 1 at the threshold, 0 when empty
  return DURABILITY_MIN_FACTOR + (1 - DURABILITY_MIN_FACTOR) * t;
}

// Gold to fully repair an item from `durability` back to MAX_DURABILITY. Pure.
export function repairCost(durability: number): number {
  return Math.max(0, MAX_DURABILITY - Math.max(0, durability)) * REPAIR_COST_PER_POINT;
}
