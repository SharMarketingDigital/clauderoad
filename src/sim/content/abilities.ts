// Data-as-code abilities — the full Sword kit (GDD §B2: "golpe básico · golpe
// forte · postura defensiva · atordoamento"). The sim reads these; numbers are
// provisional and grounded loosely in a WoW-Classic warrior (instant strikes on
// the global cooldown that cost resource and out-hit the auto-attack; a defensive
// stance that mitigates incoming damage; a stun for control). Tune later.
//
// "Golpe básico" is the auto-attack the sim already runs; slots 1..3 are the
// active kit. Espada's signature per the GDD is stun + block/absorption.
import type { StatusKind } from '../../world_api';

// A status effect an ability applies on cast. Durations in seconds (the sim
// converts to ticks). magnitude carries the per-kind parameter.
export interface AbilityEffectDef {
  kind: StatusKind;
  durationSecs: number;
  magnitude?: number; // slow/defense: factor in (0,1]; dot: damage per tick
  periodSecs?: number; // dot: seconds between damage ticks
}

export interface AbilityDef {
  id: string;
  name: string;
  slot: number; // action-bar slot (1-based)
  icon: string; // glyph shown on the HUD slot (presentation data, no logic)
  mpCost: number;
  cooldownSecs: number; // the ability's OWN cooldown (on top of the global one)
  // 'strike': melee damage on the current enemy target (effects debuff it).
  // 'buff': self-cast, no target/range — effects apply to the caster.
  kind: 'strike' | 'buff';
  damageMultiplier?: number; // strike only: scales the base melee hit so it out-hits auto-attack
  effects?: AbilityEffectDef[]; // status effects applied on a successful cast
}

export const ABILITIES: AbilityDef[] = [
  {
    id: 'strong_strike',
    name: 'Golpe Forte',
    slot: 1,
    icon: '⚔', // crossed swords
    mpCost: 15,
    cooldownSecs: 6,
    kind: 'strike',
    damageMultiplier: 2.0,
    // A heavy blow: big up-front hit, leaves the target bleeding and hobbled so
    // it can't easily disengage from the durable swordsman.
    effects: [
      { kind: 'slow', durationSecs: 3.0, magnitude: 0.5 },
      { kind: 'dot', durationSecs: 2.0, magnitude: 2, periodSecs: 0.5 },
    ],
  },
  {
    id: 'defensive_stance',
    name: 'Postura Defensiva',
    slot: 2,
    icon: '🛡', // shield — Espada's block/absorption (GDD passive theme, here an active)
    mpCost: 20,
    cooldownSecs: 15,
    kind: 'buff',
    // Brace for 6s, taking half incoming damage — a Shield-Block-style cooldown
    // on a window shorter than its cooldown, so it's a planned mitigation, not always-on.
    effects: [{ kind: 'defense', durationSecs: 6.0, magnitude: 0.5 }],
  },
  {
    id: 'stunning_blow',
    name: 'Atordoamento',
    slot: 3,
    icon: '💫', // dizzy — the Sword's signature control (GDD: "Espada → stun")
    mpCost: 20,
    cooldownSecs: 10,
    kind: 'strike',
    damageMultiplier: 1.0, // a control tool, not a nuke — modest damage, the value is the stun
    effects: [{ kind: 'stun', durationSecs: 1.0 }],
  },
];
