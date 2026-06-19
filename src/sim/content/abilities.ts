// Data-as-code abilities. The sim reads these; numbers are provisional and
// grounded loosely in a WoW-Classic-style melee builder (instant strike that
// triggers the global cooldown, costs resource, and hits for weapon damage
// scaled up). Tune later — see GDD §B2 (maestria Espada).
import type { StatusKind } from '../../world_api';

// A status effect an ability applies to its target on hit. Durations in seconds
// (the sim converts to ticks). magnitude: slow speed factor / dot damage.
export interface AbilityEffectDef {
  kind: StatusKind;
  durationSecs: number;
  magnitude?: number; // slow: speed factor in (0,1]; dot: damage per tick
  periodSecs?: number; // dot: seconds between damage ticks
}

export interface AbilityDef {
  id: string;
  name: string;
  slot: number; // action-bar slot (1-based)
  icon: string; // glyph shown on the HUD slot (presentation data, no logic)
  mpCost: number;
  cooldownSecs: number; // the ability's OWN cooldown (on top of the global one)
  damageMultiplier: number; // applied to the base melee hit, so it always out-hits auto-attack
  effects?: AbilityEffectDef[]; // status effects applied to the (surviving) target on hit
}

export const ABILITIES: AbilityDef[] = [
  {
    id: 'strong_strike',
    name: 'Golpe Forte',
    slot: 1,
    icon: '⚔', // crossed swords
    mpCost: 15,
    cooldownSecs: 6,
    damageMultiplier: 2.0,
    // PROVISIONAL: a heavy blow that staggers (stun), slows, and causes bleeding.
    // Demonstrates the status system end-to-end; the Sword-kit slice rebalances this.
    effects: [
      { kind: 'stun', durationSecs: 1.0 },
      { kind: 'slow', durationSecs: 3.0, magnitude: 0.5 },
      { kind: 'dot', durationSecs: 2.0, magnitude: 2, periodSecs: 0.5 },
    ],
  },
];
