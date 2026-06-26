// World zones (GDD v0.3 §G3) — the map is concentric SQUARE RINGS around a central
// safe-zone, measured by Chebyshev distance from the origin (cheb = max(|x|, |z|)).
// Farther from center = higher level. This is the DATA MODEL ONLY (Fatia 1): pure typed
// data + pure geometry helpers, no behavior. The sim ADOPTS it (world size, spawn-by-zone,
// mob levels) in a later slice — today nothing here is wired into the running sim.
//
// INVARIANTS (src/sim/CLAUDE.md): no DOM/render/ui/net imports; no Rng / Date.now /
// Math.random / performance.now — this is static data + deterministic geometry, identical
// in Node and the browser, on every host.

// One spawn anchor. In the spawn-by-zone slice the sim scatters a mob NEAR this point
// using its own Rng (per-spot, separate stream) — so determinism stays intact.
export interface SpawnSpot {
  readonly x: number;
  readonly z: number;
}

// A world region: the square band  inner < cheb(x,z) <= outer. Regions are concentric
// squares centered on the origin, so "outer" is each ring's half-extent.
export interface ZoneDef {
  readonly id: string;
  readonly name: string;
  readonly level: number; // mob level in this region (0 = the safe-zone: no mobs)
  readonly inner: number; // ring start (exclusive): cheb > inner
  readonly outer: number; // ring end (inclusive): cheb <= outer  (Chebyshev half-extent)
  readonly safe: boolean; // central town — no spawns, no aggro
  readonly spots: ReadonlyArray<SpawnSpot>; // spawn anchors (empty for the safe-zone)
}

// Each ring (and the central safe-zone) spans this many units of Chebyshev distance.
export const RING_WIDTH = 30;

// Four spawn anchors around a ring at its mid-radius (N/S/E/W). The sim spawns a small
// PACK at each spot, so the ring has a handful of clusters to roam between. Pure data
// construction (no Rng); each anchor's Chebyshev distance is exactly r, so it lands
// squarely inside the ring's band.
function ringSpots(inner: number, outer: number): SpawnSpot[] {
  const r = (inner + outer) / 2;
  return [
    { x: r, z: 0 }, { x: -r, z: 0 }, { x: 0, z: r }, { x: 0, z: -r },
  ];
}

// The regions, innermost (safe town) to outermost (the world edge). Contiguous bands:
// each ring starts exactly where the previous one ends. Levels rise 1 -> 2 -> 4 -> 10.
export const ZONES: ReadonlyArray<ZoneDef> = [
  { id: 'town',   name: 'Vila Central',     level: 0,  inner: 0,   outer: 30,  safe: true,  spots: [] },
  { id: 'ring1',  name: 'Campina',          level: 1,  inner: 30,  outer: 60,  safe: false, spots: ringSpots(30, 60) },
  { id: 'ring2',  name: 'Bosque',           level: 2,  inner: 60,  outer: 90,  safe: false, spots: ringSpots(60, 90) },
  { id: 'ring4',  name: 'Terras Selvagens', level: 4,  inner: 90,  outer: 120, safe: false, spots: ringSpots(90, 120) },
  { id: 'ring10', name: 'Ermo Profundo',    level: 10, inner: 120, outer: 150, safe: false, spots: ringSpots(120, 150) },
];

// Extra safe-zone cities beyond the central town (ZONES[0]). Unlike the concentric rings, a second
// city sits at an arbitrary center — so it can't be a Chebyshev band in ZONES; it lives here as a
// square safe region centered at (cx, cz) with Chebyshev half-extent `half`. zoneAt() checks these
// FIRST, then falls back to the concentric rings. (v0.5 — teleporte: the world now has >1 city.)
export interface SafeCity {
  readonly id: string;
  readonly name: string;
  readonly cx: number; // center X
  readonly cz: number; // center Z
  readonly half: number; // Chebyshev half-extent of the safe square (same size as the central town)
}

export const SAFE_CITIES: ReadonlyArray<SafeCity> = [
  // Vila do Leste — a frontier town out in the deep wilderness (east edge), the second teleport hub.
  { id: 'leste', name: 'Vila do Leste', cx: 250, cz: 0, half: 30 },
];

// Each extra city as a ready ZoneDef (safe, level 0, no spawns), precomputed so zoneAt() returns a
// stable object with no per-call allocation. inner/outer hold the city's own square half-extent (the
// concentric-band meaning doesn't apply off-origin); consumers read safe/level/name, and the map
// draws these separately from the concentric rings.
const SAFE_CITY_REGIONS: ReadonlyArray<{ city: SafeCity; zone: ZoneDef }> = SAFE_CITIES.map((c) => ({
  city: c,
  zone: { id: c.id, name: c.name, level: 0, inner: 0, outer: c.half, safe: true, spots: [] },
}));

// The world half-extent. The concentric rings end at 150 (the central city's progression), but the
// WORLD extends to 300 (a 600x600 map): the outer band (cheb 150–300) is the deep frontier — it
// reads as the last ring's level via zoneAt's fallback — and holds the second city (Vila do Leste).
// DECOUPLED from the rings on purpose: the rings no longer reach the world edge.
export const WORLD_HALF = 300;

// Only the spawnable (non-safe) regions — the sim iterates these in the spawn slice.
export const SPAWN_ZONES: ReadonlyArray<ZoneDef> = ZONES.filter((z) => !z.safe);

// Chebyshev distance from the world center (the origin). Pure.
export function chebyshev(x: number, z: number): number {
  return Math.max(Math.abs(x), Math.abs(z));
}

// The region a point falls in. Explicit safe cities (off-origin, like Vila do Leste) win FIRST —
// they aren't concentric bands. Otherwise it's the concentric ring by Chebyshev distance from the
// origin; a point past the last ring (the deep frontier, cheb 150–300) clamps to the outermost
// region (the sim never lets an entity leave ±WORLD_HALF anyway). Pure.
export function zoneAt(x: number, z: number): ZoneDef {
  for (const { city, zone } of SAFE_CITY_REGIONS) {
    if (Math.max(Math.abs(x - city.cx), Math.abs(z - city.cz)) <= city.half) return zone;
  }
  const d = chebyshev(x, z);
  for (const zone of ZONES) {
    if (d <= zone.outer) return zone;
  }
  return ZONES[ZONES.length - 1];
}
