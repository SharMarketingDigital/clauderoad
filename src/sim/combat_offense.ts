// Combat — OFFENSE: how outgoing damage is GENERATED (Gabriel's module, GDD v0.3 §2/§3.0).
//
// This owns the OUTGOING side of a hit: the base damage from the attacker's stats + the
// ability's multiplier/rank, the critical roll, and the damage TYPE (physical vs magical —
// the latter is introduced with the Mago in G1). It produces a `Damage` that the sim then
// hands to combat_defense.mitigate() (Kevin's module). The sim only does:
//     const final = defense.mitigate(offense.compute(...))
// so neither front edits the other's damage code.
//
// DETERMINISM: pure except for ONE gated draw — the crit roll. It uses the sim's MAIN Rng
// and draws ONLY when critChance > 0 (exactly the old `rollCrit` gate), so an unbuffed
// world's random stream — and the determinism hash — is byte-identical to before.
import type { Entity } from './types';
import type { AbilityDef } from './content/abilities';
import type { Rng } from './rng';
import { rankDamageMult } from './content/skill_ranks';

// Physical (today: weapons/Str) vs magical (the Mago — G1). The matching mitigation for
// each type is combat_defense's job (armor for physical, Int magic-def for magical — K3).
export type DamageType = 'physical' | 'magical';

// One outgoing hit, AFTER the crit roll but BEFORE any mitigation. This is the contract
// combat_defense.mitigate() consumes (it reads `amount` + `type`; `crit` is for VFX/feedback).
export interface Damage {
  amount: number; // outgoing damage, post-crit, PRE-mitigation
  type: DamageType; // 'physical' | 'magical' (drives which defense applies in K3)
  crit: boolean; // whether the crit roll landed — presentation only (G2 VFX / feedback)
}

// Everything compute() needs. The sim resolves the live, stateful inputs (the attacker's
// active-mastery crit chance, the ability's rank, the damage type) and passes them in, so
// this module stays free of sim internals.
export interface OffenseContext {
  attacker: Entity; // reads str + weaponDamage (and int later, to scale magical damage)
  ability?: AbilityDef; // undefined => a basic auto-attack (raw weapon swing)
  rank: number; // the ability's current rank (1 = base); resolved by the sim from skillRanks
  damageType: DamageType; // resolved by the sim (physical today; 'magical' for the Mago in G1)
  critChance: number; // 0..1, resolved by the sim (mastery baseCrit + crit buffs). 0 => no roll
  rng: Rng; // the sim's MAIN rng — the crit roll draws from it ONLY when critChance > 0
}

// Generate one outgoing hit. Mirrors the OLD inline path exactly:
//   ability  -> round(abilityDamage(def, str, wpn) * rankDamageMult(rank))   (old rankedAbilityDamage)
//   auto     -> meleeDamage(str, wpn)
//   then the same gated crit roll (old rollCrit).
export function compute(ctx: OffenseContext): Damage {
  const { attacker, ability, rank, damageType, critChance, rng } = ctx;
  const base = ability
    ? Math.round(abilityDamage(ability, attacker.str, attacker.weaponDamage) * rankDamageMult(rank))
    : meleeDamage(attacker.str, attacker.weaponDamage);
  // Crit: draw from the main rng ONLY when there's a chance (so an unbuffed world never
  // touches the stream — the determinism invariant). Identical to the old `rollCrit`.
  let crit = false;
  let amount = base;
  if (critChance > 0 && rng.next() < critChance) {
    crit = true;
    amount = Math.round(base * CRIT_MULT);
  }
  return { amount, type: damageType, crit };
}

// ---- pure damage helpers (moved here from sim.ts; re-exported there for back-compat) ----

// A critical hit deals this multiple (Spear's Fúria buff; the Arco precision crits).
export const CRIT_MULT = 2.0;

// Provisional melee hit. Grounded loosely in WoW Classic, where a swing deals weapon damage
// plus a contribution from attack power, and Strength feeds AP (~1 AP per STR for warriors).
// Simplified to weapon + floor(STR * k). No RNG, so it's deterministic; tune later (GDD §B1).
export const STR_TO_DAMAGE = 0.5;
export function meleeDamage(str: number, weaponDamage: number): number {
  return weaponDamage + Math.floor(str * STR_TO_DAMAGE);
}

// An ability's hit: the base melee swing scaled up, so it always out-damages the
// auto-attack. Pure & deterministic (no RNG); tune the multiplier later.
export function abilityDamage(def: AbilityDef, str: number, weaponDamage: number): number {
  return Math.round(meleeDamage(str, weaponDamage) * (def.damageMultiplier ?? 0));
}
