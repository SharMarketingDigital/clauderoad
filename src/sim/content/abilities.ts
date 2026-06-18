// Data-as-code abilities. The sim reads these; numbers are provisional and
// grounded loosely in a WoW-Classic-style melee builder (instant strike that
// triggers the global cooldown, costs resource, and hits for weapon damage
// scaled up). Tune later — see GDD §B2 (maestria Espada).
export interface AbilityDef {
  id: string;
  name: string;
  slot: number; // action-bar slot (1-based)
  icon: string; // glyph shown on the HUD slot (presentation data, no logic)
  mpCost: number;
  cooldownSecs: number; // the ability's OWN cooldown (on top of the global one)
  damageMultiplier: number; // applied to the base melee hit, so it always out-hits auto-attack
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
  },
];
