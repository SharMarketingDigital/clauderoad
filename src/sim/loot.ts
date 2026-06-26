// Loot físico (GDD v0.5) — physical ground-loot tuning. Pure data (no Rng / clock / DOM), like
// teleport.ts: the Sim owns the entity mutation; here we only hold the knobs.
export const LOOT_DESPAWN_SECS = 300; // s — a dropped ground item vanishes after this (~5 min)
export const DEATH_DROP_CHANCE = 0.08; // per bag stack on a NON-duel death (~8%, within the 5–10% design)
