// Data-as-code tuning for ability RANKS (GDD §B4: SP / skill ranks). Mobs grant SP
// (a second currency); the player spends it to raise an ability's rank, which makes
// it hit harder and its effects last longer. The roll/apply logic lives in sim.ts;
// these are just the numbers. Provisional — kinder than Silkroad; tune later.

// Every ability starts at rank 1 and caps here. (Global cap keeps it simple; make it
// per-ability in AbilityDef later if a kit wants different ceilings.)
export const SKILL_MAX_RANK = 5;

// SP cost to go FROM rank r TO r+1 (index r-1): rank1->2 .. rank4->5. Increasing, so
// later ranks are a real investment. ~3-20 wolf kills each at SP_PER_KILL below.
export const SKILL_SP_COST = [10, 25, 45, 70];

// How much each rank ABOVE 1 strengthens the ability. Damage scales the strike's hit;
// effect scales the DURATION of its status effects (longer stun/slow/bleed/buff — and
// a longer bleed deals more total damage). We never touch a slow/defense FACTOR, so a
// higher rank can only ever make an ability stronger, never accidentally weaker.
export const SKILL_DAMAGE_PER_RANK = 0.25; // +25% ability damage per rank
export const SKILL_EFFECT_PER_RANK = 0.15; // +15% effect duration per rank

// SP cost from `rank` to `rank+1`; 0 at (or above) the cap. Pure & deterministic.
export function skillUpgradeCost(rank: number): number {
  if (rank < 1 || rank >= SKILL_MAX_RANK) return 0;
  return SKILL_SP_COST[rank - 1] ?? 0;
}

// Damage multiplier for an ability at `rank` (1.0 at rank 1). Pure & deterministic.
export function rankDamageMult(rank: number): number {
  return 1 + SKILL_DAMAGE_PER_RANK * (Math.max(1, rank) - 1);
}

// Effect-duration multiplier for an ability at `rank` (1.0 at rank 1). Pure.
export function rankEffectMult(rank: number): number {
  return 1 + SKILL_EFFECT_PER_RANK * (Math.max(1, rank) - 1);
}
