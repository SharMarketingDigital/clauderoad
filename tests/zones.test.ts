// World-zone DATA MODEL tests (GDD v0.3 §G3, Fatia 1). Pure data + geometry — no sim
// behavior yet, so these are independent of the determinism suite.
import { describe, it, expect } from 'vitest';
import { ZONES, SPAWN_ZONES, WORLD_HALF, RING_WIDTH, zoneAt, chebyshev } from '../src/sim/zones';

describe('world zones (data model)', () => {
  it('the center is a safe-zone with no mobs', () => {
    const z = zoneAt(0, 0);
    expect(z.safe).toBe(true);
    expect(z.level).toBe(0);
    expect(z.spots.length).toBe(0);
  });

  it('levels rise outward 1 -> 2 -> 4 -> 10, and every spawn zone has spots', () => {
    expect(SPAWN_ZONES.map((z) => z.level)).toEqual([1, 2, 4, 10]);
    for (const z of SPAWN_ZONES) {
      expect(z.safe).toBe(false);
      expect(z.spots.length).toBeGreaterThan(0);
    }
  });

  it('rings are contiguous from the center outward (no gaps/overlaps); the world extends past them', () => {
    expect(ZONES[0].inner).toBe(0); // first band starts at the center
    for (let i = 1; i < ZONES.length; i++) {
      expect(ZONES[i].inner).toBe(ZONES[i - 1].outer); // band i starts where i-1 ends
      expect(ZONES[i].outer - ZONES[i].inner).toBe(RING_WIDTH); // each ring is one width
    }
    expect(ZONES[ZONES.length - 1].outer).toBe(150); // rings end at 150 (the central city's progression)
    expect(WORLD_HALF).toBeGreaterThan(ZONES[ZONES.length - 1].outer); // world extends past the rings (deep frontier + 2nd city)
  });

  it('zoneAt maps a point to its ring by Chebyshev distance (farther = stronger)', () => {
    expect(zoneAt(15, 0).id).toBe('town'); // cheb 15 -> safe
    expect(zoneAt(45, 0).level).toBe(1); // cheb 45 -> Campina
    expect(zoneAt(0, 75).level).toBe(2); // Bosque
    expect(zoneAt(105, 20).level).toBe(4); // cheb 105 -> Terras Selvagens
    expect(zoneAt(135, -135).level).toBe(10); // corner, cheb 135 -> Ermo Profundo
    // walking straight out, the level never drops
    const levels = [10, 50, 80, 110, 140].map((d) => zoneAt(d, 0).level);
    for (let i = 1; i < levels.length; i++) expect(levels[i]).toBeGreaterThanOrEqual(levels[i - 1]);
  });

  it('every spawn spot lies inside its own ring and within the world', () => {
    for (const z of SPAWN_ZONES) {
      for (const s of z.spots) {
        expect(zoneAt(s.x, s.z).id).toBe(z.id); // the spot belongs to its ring
        expect(chebyshev(s.x, s.z)).toBeLessThanOrEqual(WORLD_HALF); // inside the world
      }
    }
  });

  it('the safe-zone contains the player spawn and the vendor', () => {
    expect(zoneAt(0, 0).safe).toBe(true); // player spawn (PLAYER_SPAWN_X/Z)
    expect(zoneAt(10, 6).safe).toBe(true); // vendor (VENDOR_SPAWN_X/Z)
  });

  it('a second safe city (Vila do Leste) is safe; the deep frontier past the rings reads as the last ring', () => {
    const east = zoneAt(250, 0); // the new city center
    expect(east.safe).toBe(true);
    expect(east.level).toBe(0);
    expect(east.id).toBe('leste');
    expect(zoneAt(0, 0).id).toBe('town'); // the central town still resolves normally (origin unaffected)
    // just outside the city square is open frontier — not safe, at the last ring's level
    expect(zoneAt(200, 0).safe).toBe(false);
    expect(zoneAt(200, 0).level).toBe(10); // deep frontier (cheb 200, past the rings) = Ermo Profundo
  });
});
