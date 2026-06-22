// Combat — DEFENSE: how incoming damage is REDUCED (Kevin's module, GDD v0.3 §3.0 / K3).
//
// This is the DEFENDER side of a hit. The sim composes the two combat modules as:
//     const final = defense.mitigate(offense.compute(...))
// so Gabriel (offense) and Kevin (defense) never edit the same damage code.
//
// ┌─ CONTRACT (for the K3 implementation) ──────────────────────────────────────────────┐
// │ mitigate(ctx) takes the raw outgoing hit (post-crit, PRE-mitigation) + the target,   │
// │ and returns the FINAL damage to subtract from the target's HP.                       │
// │                                                                                      │
// │ • Read `ctx.hit.type` to branch the mitigation:                                      │
// │     'physical' -> armor reduction (the v0.2 gap; e.g. armor/(armor+85*level+400)).    │
// │     'magical'  -> Int-based magic defense (pairs with the Mago's magical damage).     │
// │ • Read defense stats off `ctx.target` (gear armor, Str->phys-def, Int->magic-def).    │
// │ • Return an INTEGER >= 0. Do NOT floor at 1 here — the sim applies the ">=1 on a      │
// │   landed hit" rule + rounding at the apply step (so an over-mitigated blow still      │
// │   registers as at least 1, consistently with how it works today).                    │
// │                                                                                      │
// │ NOT your job here: the temporary Postura-Defensiva BUFF. That is a STATUS effect      │
// │ (not armor/gear), so by design (GDD option A) it stays in the sim's apply step, not   │
// │ in this module. mitigate() concerns gear/attribute defense only.                     │
// └──────────────────────────────────────────────────────────────────────────────────────┘
//
// DETERMINISM: pure (no Rng, no side effects). Runs identically in SP and MP.
import type { Damage } from './combat_offense';
import type { Entity } from './types';

export interface MitigationContext {
  hit: Damage; // the outgoing hit from offense.compute (amount post-crit; type physical/magical)
  target: Entity; // the entity RECEIVING the damage — read its armor / magic-def here (K3)
}

// AÇÃO ZERO SKELETON — pure PASSTHROUGH: no armor/attribute reduction exists yet, so the
// final damage equals the incoming amount. Kevin replaces this body in K3 with the real
// physical/magical mitigation (per the contract above). Keeping it a passthrough means this
// refactor changes ZERO damage numbers (the determinism + combat tests stay green).
export function mitigate(ctx: MitigationContext): number {
  return ctx.hit.amount;
}
