// Loja por NPC (Fatia 1 — refactor). The storefront is no longer hardwired to a single global vendor:
// shopFor/buy resolve against the NEAREST shop NPC in range (shopStock map), so the all-in-one vendor can
// later split into specialized shops with no change to the buy path. With ONE shop NPC this is exactly the
// old single-vendor behavior — these tests pin that, plus determinism.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Entity } from '../src/sim/types';

type Internal = { ents: Map<number, Entity> };
const ents = (s: Sim): Entity[] => [...(s as unknown as Internal).ents.values()];
const player = (s: Sim): Entity => ents(s).find((e) => e.kind === 'player')!;
// The boticário sells health_potion, so it's the shop these buy-tests target.
const vendor = (s: Sim): Entity => ents(s).find((e) => e.kind === 'npc' && e.species === 'apothecary')!;

const walkTo = (sim: Sim, tx: number, tz: number, ticks = 600): void => {
  for (let i = 0; i < ticks; i++) {
    const p = player(sim);
    if (Math.hypot(p.x - tx, p.z - tz) <= 1.5) break;
    sim.sendCommand({ t: 'move', dx: tx - p.x, dz: tz - p.z });
    sim.step();
  }
};

describe('Loja por NPC (refactor Fatia 1)', () => {
  it('the storefront is anchored to a shop NPC: out of range you cannot buy, near it you can', () => {
    const sim = new Sim(1);
    const v = vendor(sim);
    expect(v).toBeDefined(); // a shop NPC exists (species 'vendor')

    // far from the shop NPC (spawn at origin, vendor ~11 units away): out of range
    expect(sim.shop().inRange).toBe(false);

    sim.restorePlayer(player(sim).id, { gold: 500 }); // give gold (position is preserved by restore)
    walkTo(sim, v.x, v.z);
    expect(sim.shop().inRange).toBe(true);
    expect(sim.shop().name).toBe(v.name); // the view reads the NPC entity's name, not a constant
    expect(sim.shop().stock.length).toBeGreaterThan(0);

    const before = player(sim).gold;
    sim.sendCommand({ t: 'buy', itemId: 'health_potion' });
    sim.step();
    expect(player(sim).gold).toBeLessThan(before); // bought near the shop NPC -> gold spent
    expect(player(sim).bag.some((b) => b?.itemId === 'health_potion')).toBe(true);
  });

  it('a buy far from any shop NPC is a no-op (the proximity gate routes through the shop NPC)', () => {
    const sim = new Sim(1);
    sim.restorePlayer(player(sim).id, { gold: 500 }); // gold, but standing at spawn (far from the vendor)
    const before = player(sim).gold;
    sim.sendCommand({ t: 'buy', itemId: 'health_potion' });
    sim.step();
    expect(player(sim).gold).toBe(before); // no shop NPC in range -> nothing bought
    expect(player(sim).bag.every((b) => b?.itemId !== 'health_potion')).toBe(true);
  });

  it('determinism: a near-shop buy run hashes identically run-to-run', () => {
    const run = (): string => {
      const sim = new Sim(1);
      const v = vendor(sim);
      sim.restorePlayer(player(sim).id, { gold: 500 });
      walkTo(sim, v.x, v.z, 400);
      sim.sendCommand({ t: 'buy', itemId: 'health_potion' });
      sim.step();
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
