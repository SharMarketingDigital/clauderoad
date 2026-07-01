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
  // Auto-attack ONLY (no ability): per-hit scale so a faster weapon hits softer and a slower one harder,
  // keeping auto-DPS equal across archetypes (Opção A — só o feel muda). Default 1 => abilities and mobs are
  // byte-identical (they never pass it). The crit ROLL is unaffected — it's gated by critChance, not this.
  autoMult?: number;
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
    : Math.round(
        (magical
          ? spellDamage(attacker.baseInt, attacker.weaponDamage)
          : meleeDamage(attacker.str, attacker.weaponDamage)
        ) * (ctx.autoMult ?? 1), // auto-attack: scale per-hit by swingTime/baseline so auto-DPS stays equal
      );
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

// ---- Hit × Parry (Fase 3): a chance de um golpe CONECTAR, antes do dano ----
// Compara a precisão do atacante (hitRate) com a esquiva do alvo (parry). PURO — o ROLL fica no SIM (gated
// por parry>0), preservando o contrato "1 draw gated" de compute() E a ordem canônica miss→crit→block→
// mitigação. Fiel ao SRO (hit-rate vs parry-ratio) na versão enxuta do doc: clamp(BASE + K·(hit−parry),
// MIN, MAX). Números provisórios/tunáveis (o rebalance ofensivo calibra contra a sensação real).
export const HIT_BASE = 0.9;
export const HIT_K = 0.01;
export const HIT_MIN = 0.2;
export const HIT_MAX = 0.98;
export const BASE_HIT_RATE = 10; // precisão-base do atacante (Fatia 1: constante; hit-rate por-arma/mob vem depois)
export function hitChance(attackerHitRate: number, targetParry: number): number {
  const c = HIT_BASE + HIT_K * (attackerHitRate - targetParry);
  return c < HIT_MIN ? HIT_MIN : c > HIT_MAX ? HIT_MAX : c;
}

// ---- Block (Fase 3, Fatia 2): o ESCUDO amortece um golpe que conectou ----
// Distinto da esquiva: a esquiva ANULA o golpe (miss), o block o AMORTECE — o golpe ainda conecta (dá dano
// reduzido, ainda aplica on-hit status), mas o escudo absorve a maior parte. Fração provisória (tunável no
// rebalance). O ROLL (gated por blockRatio>0) e a ordem (miss→crit→block→mitigação) ficam no SIM.
export const BLOCK_DMG_MULT = 0.25; // um golpe bloqueado entrega 25% do dano (o escudo absorve 75%)

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

// Magic resist per point of Intelligence (the defender's). A player gains magic resist by
// investing in Int; this STACKS with the gear's magDef (both feed the same armor curve below).
// Enemies have Int 0 AND magDef 0, so they take FULL magical damage. Tune by play.
export const MAGIC_DEF_PER_INT = 0.25;

// Armor softening constant for the mitigation curve: reduction = armor / (armor + ARMOR_K).
// Grounded in the WoW-style diminishing-returns curve (so high armor never zeroes damage and the
// % reduction is CONSTANT across the whole damage range, unlike flat subtraction which trivializes
// low hits and barely touches big ones). K=50 => leather set (phyDef 9) ~15%, SUN+10 (54) ~52%. Tune by play.
export const ARMOR_K = 50;

// Reduce an incoming hit by the target's effective armor for that damage TYPE:
//   physical -> target.phyDef (gear).
//   magical  -> target.magDef (gear) + the Int-based magic resist (they STACK).
// Mitigation uses the curve `amount * (1 - armor/(armor+K))` so the % reduction is constant across
// the damage range. `armor <= 0` returns the hit EXACTLY (byte-identical passthrough) — so every
// enemy (always 0 armor) and every un-armored player are unchanged; only a geared target is reduced.
// The sim still applies its ">=1 on a landed hit" floor + the Postura-Defensiva buff at the apply step.
export function mitigate(ctx: MitigationContext): number {
  const { hit, target } = ctx;
  const armor =
    hit.type === 'magical'
      ? target.magDef + Math.floor(target.baseInt * MAGIC_DEF_PER_INT)
      : target.phyDef;
  if (armor <= 0) return hit.amount; // no armor => exact passthrough (byte-identical to before)
  return Math.max(0, Math.round(hit.amount * (1 - armor / (armor + ARMOR_K))));
}
