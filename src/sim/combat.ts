// Combat — the single source of truth for how a hit is GENERATED and REDUCED.
//
// GDD v0.3 (frentes independentes): combat is 100% Gabriel's. It used to be split
// into combat_offense.ts (generation) + combat_defense.ts (mitigation) so two
// owners wouldn't edit the same code; with one owner that split has no purpose, so
// the two live here together. The sim still composes them in the same order:
//     const final = combat.mitigate({ hit: combat.compute(...), target })
//
// DETERMINISM: pure except for ONE gated draw — the crit roll in compute(). It uses
// the sim's MAIN Rng and draws ONLY when critChance > 0 (the old `rollCrit` gate),
// so an unbuffed world's random stream — and the determinism hash — is unaffected.
import type { Entity } from './types';
import type { AbilityDef } from './content/abilities';
import type { Rng } from './rng';
import type { DamageType } from '../world_api';
import { rankDamageMult } from './content/skill_ranks';

// ════════════════════════════════════════════════════════════════════════════
// Shared damage contract
// ════════════════════════════════════════════════════════════════════════════

// DamageType ('physical' | 'magical') is defined at the seam (world_api). Physical
// scales with Str + is reduced by armor (none yet); magical scales with Int + is
// reduced by Int magic-resist below. Re-exported for back-compat with sim imports.
export type { DamageType };

// One outgoing hit, AFTER the crit roll but BEFORE any mitigation. This is the
// contract mitigate() consumes (it reads `amount` + `type`; `crit` is for VFX/feedback).
export interface Damage {
  amount: number; // outgoing damage, post-crit, PRE-mitigation
  type: DamageType; // 'physical' | 'magical' (drives which defense applies)
  crit: boolean; // whether the crit roll landed — presentation only (G2 VFX / feedback)
}

// ════════════════════════════════════════════════════════════════════════════
// OFFENSE — how outgoing damage is generated
// ════════════════════════════════════════════════════════════════════════════

// Everything compute() needs. The sim resolves the live, stateful inputs (the
// attacker's active-mastery crit chance, the ability's rank, the damage type) and
// passes them in, so this module stays free of sim internals.
export interface OffenseContext {
  attacker: Entity; // reads str + weaponDamage (physical) and baseInt (magical — the Mago)
  ability?: AbilityDef; // undefined => a basic auto-attack (raw weapon swing)
  rank: number; // the ability's current rank (1 = base); resolved by the sim from skillRanks
  damageType: DamageType; // resolved by the sim (physical today; 'magical' for the Mago in G1)
  critChance: number; // 0..1, resolved by the sim (mastery baseCrit + crit buffs). 0 => no roll
  rng: Rng; // the sim's MAIN rng — the crit roll draws from it ONLY when critChance > 0
}

// Generate one outgoing hit. The PHYSICAL path mirrors the old inline code exactly
// (Str + weapon); the MAGICAL path is its mirror with Intelligence (the Mago):
//   physical ability -> round(abilityDamage(def, str, wpn)      * rankDamageMult(rank))
//   magical  ability -> round(spellAbilityDamage(def, int, wpn) * rankDamageMult(rank))
//   physical auto    -> meleeDamage(str, wpn)
//   magical  auto    -> spellDamage(int, wpn)
// then the same gated crit roll (crit comes from the WEAPON via critChance, not the
// attribute, so it applies to both types identically).
export function compute(ctx: OffenseContext): Damage {
  const { attacker, ability, rank, damageType, critChance, rng } = ctx;
  const magical = damageType === 'magical';
  const base = ability
    ? Math.round(
        (magical
          ? spellAbilityDamage(ability, attacker.baseInt, attacker.weaponDamage)
          : abilityDamage(ability, attacker.str, attacker.weaponDamage)
        ) * rankDamageMult(rank),
      )
    : magical
      ? spellDamage(attacker.baseInt, attacker.weaponDamage)
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

// ---- pure damage helpers ----

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

// ---- magical mirror (the Mago, G1): Intelligence scales spell damage ----

// Int's contribution to magical damage — a direct mirror of STR_TO_DAMAGE. A pure-Int
// build starts weak (a fresh character has Int 0, so it's just the staff's weapon
// damage) but scales as points go into Int, à la Silkroad. Tune by play.
export const INT_TO_DAMAGE = 0.5;

// Magical basic hit: the staff's weapon damage + an Int contribution. Mirror of
// meleeDamage (Str), used for the Mago's auto-attack and as the spell-ability base.
export function spellDamage(int: number, weaponDamage: number): number {
  return weaponDamage + Math.floor(int * INT_TO_DAMAGE);
}

// A magical ability's hit: the spell base scaled by the ability multiplier. Mirror
// of abilityDamage, but Int-based. Pure & deterministic (no RNG).
export function spellAbilityDamage(def: AbilityDef, int: number, weaponDamage: number): number {
  return Math.round(spellDamage(int, weaponDamage) * (def.damageMultiplier ?? 0));
}

// ════════════════════════════════════════════════════════════════════════════
// DEFENSE — how incoming damage is reduced
// ════════════════════════════════════════════════════════════════════════════

// mitigate(ctx) takes the raw outgoing hit (post-crit, PRE-mitigation) + the target,
// and returns the FINAL damage to subtract from the target's HP. The sim applies the
// ">=1 on a landed hit" rule + rounding at the apply step, NOT here. The temporary
// Postura-Defensiva BUFF is also a STATUS effect handled at the sim's apply step
// (GDD option A), not here — mitigate() concerns gear/attribute defense only.
export interface MitigationContext {
  hit: Damage; // the outgoing hit from compute (amount post-crit; type physical/magical)
  target: Entity; // the entity RECEIVING the damage — read its armor / magic-def here
}

// Magic resist per point of Intelligence (the defender's). Simple linear base — the
// magical counterpart to (future) armor. Enemies have Int 0, so they take FULL magical
// damage; a player gains magic resist by investing in Int. Tune by play.
export const MAGIC_DEF_PER_INT = 0.25;

// Reduce an incoming hit by the target's defense. PHYSICAL stays a passthrough (no armor
// yet) — byte-identical to before. MAGICAL is reduced by the target's Int magic-resist,
// floored at 0; the sim still applies its ">=1 on a landed hit" rule at the apply step.
export function mitigate(ctx: MitigationContext): number {
  const { hit, target } = ctx;
  if (hit.type === 'magical') {
    const resist = Math.floor(target.baseInt * MAGIC_DEF_PER_INT);
    return Math.max(0, hit.amount - resist);
  }
  return hit.amount;
}
