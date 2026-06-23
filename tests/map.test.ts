// World-map coordinate mapping (Fatia 3). The DOM/rendering is verified visually; this
// pins the pure world->map-pixel math (the rest of map.ts only touches the DOM inside
// methods, so importing it here is safe in Node).
import { describe, it, expect } from 'vitest';
import { worldToMapPx } from '../src/ui/map';
import { WORLD_HALF } from '../src/sim/zones';

describe('world map coordinate mapping', () => {
  const PX = 360;

  it('maps the world centre to the map centre', () => {
    expect(worldToMapPx(0, 0, PX, WORLD_HALF)).toEqual({ left: PX / 2, top: PX / 2 });
  });

  it('maps the corners (+x = east/right, +z = north/up)', () => {
    expect(worldToMapPx(-WORLD_HALF, WORLD_HALF, PX, WORLD_HALF)).toEqual({ left: 0, top: 0 }); // NW
    expect(worldToMapPx(WORLD_HALF, WORLD_HALF, PX, WORLD_HALF)).toEqual({ left: PX, top: 0 }); // NE
    expect(worldToMapPx(-WORLD_HALF, -WORLD_HALF, PX, WORLD_HALF)).toEqual({ left: 0, top: PX }); // SW
    expect(worldToMapPx(WORLD_HALF, -WORLD_HALF, PX, WORLD_HALF)).toEqual({ left: PX, top: PX }); // SE
  });

  it('+x moves the dot right; +z moves it up (smaller top)', () => {
    const c = worldToMapPx(0, 0, PX, WORLD_HALF);
    expect(worldToMapPx(10, 0, PX, WORLD_HALF).left).toBeGreaterThan(c.left); // east -> right
    expect(worldToMapPx(0, 10, PX, WORLD_HALF).top).toBeLessThan(c.top); // north -> up
  });
});
