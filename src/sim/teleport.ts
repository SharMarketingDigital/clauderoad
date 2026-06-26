// Teleporte entre cidades (GDD v0.5) — pure data + helpers; the Sim owns the entity mutation.
// A teleporter NPC sits at each city centre (the visible NPC + the menu are TP3); here we only need
// the city points, the fixed cost, and the proximity rule. Deterministic: no Rng / Date / random.
import { CITIES, type SafeCity } from './zones';

export const TELEPORT_COST = 50; // gold — a cheap, FIXED cost per city-to-city trip (per design)
export const TELEPORT_RANGE = 6; // world units: must be within this of a city centre (the NPC) to use it
export const RETURN_COOLDOWN_SECS = 120; // s — the FREE Return recall has no gold cost, so the cooldown is its only limiter

// The city whose centre the point is within TELEPORT_RANGE of (i.e. you're standing at its
// teleporter), or null when not at any teleport point. Euclidean, like the vendor/warehouse checks.
export function cityNear(x: number, z: number): SafeCity | null {
  for (const c of CITIES) {
    if (Math.hypot(x - c.cx, z - c.cz) <= TELEPORT_RANGE) return c;
  }
  return null;
}

// A city by id, or undefined when unknown.
export function cityById(id: string): SafeCity | undefined {
  return CITIES.find((c) => c.id === id);
}

// The index of a city id in CITIES (0 = the central town), or 0 when unknown. A stable numeric key
// for folding the per-player registered city (returnCity) into the deterministic hash — the id is a
// string, but its CITIES position is a small stable integer that desyncs would diverge on.
export function cityIndex(id: string): number {
  const i = CITIES.findIndex((c) => c.id === id);
  return i < 0 ? 0 : i;
}
