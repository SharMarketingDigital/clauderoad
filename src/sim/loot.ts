// Loot físico (GDD v0.5) — physical ground-loot tuning. Pure data (no Rng / clock / DOM), like
// teleport.ts: the Sim owns the entity mutation; here we only hold the knobs.
export const LOOT_DESPAWN_SECS = 300; // s — a dropped ground item vanishes after this (~5 min)
export const DEATH_DROP_CHANCE = 0.08; // per bag stack on a NON-duel death (~8%, within the 5–10% design)
export const LOOT_PICKUP_RANGE = 4; // world units: a player must be within this of a ground item to pick it up
// GDD v0.5 (Pets): a summoned grab pet auto-collects ground loot within this radius (of the PET) into the
// owner's bag — wider than the manual pickup so it's a real convenience. Silkroad grab pets sweep a small
// area around you; the pet trails the owner, so this is effectively "loot near you is gathered for you".
export const PET_GRAB_RADIUS = 10; // world units
