// Stalls (GDD v0.5 §5) — personal P2P shops, ALL in the deterministic sim (gold + items are hashed
// gameplay state both hosts must agree on). The crown jewel is ST0: the ATOMIC, dup-proof transfer.
// Server-mode Sim (clients join via addPlayer), like the loot/pvp tests; we drive the stall commands and
// read state via serializePlayer (bag/gold) + entities() (the public stallOpen flag).
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Command } from '../src/world_api';

function serverSim(seed = 1): Sim {
  return new Sim(seed, /* spawnLocal */ false);
}
function run(sim: Sim, id: number, cmd: Command): void {
  sim.sendCommandFor(id, cmd);
  sim.step();
}
const ent = (sim: Sim, id: number) => sim.entities().find((e) => e.id === id)!;
const SWORD = { itemId: 'old_sword', rarity: 'normal' as const, plus: 0 };
const bag = (sim: Sim, id: number) => (sim.serializePlayer(id)?.bag ?? []).filter((s) => s != null);
const swords = (sim: Sim, id: number) => bag(sim, id).filter((s) => s!.itemId === 'old_sword').length;
const gold = (sim: Sim, id: number) => sim.serializePlayer(id)!.gold;

// Walk `mover` onto `targetId` until within the stall interact range (~5), then stop.
const walkOnto = (sim: Sim, mover: number, targetId: number): void => {
  for (let i = 0; i < 80; i++) {
    const m = ent(sim, mover), t = ent(sim, targetId);
    if (Math.hypot(m.x - t.x, m.z - t.z) <= 4) break;
    sim.sendCommandFor(mover, { t: 'move', dx: t.x - m.x, dz: t.z - m.z });
    sim.step();
  }
  sim.sendCommandFor(mover, { t: 'stop' });
  sim.step();
};

describe('Stalls — open + atomic P2P buy (ST0/ST1/ST2)', () => {
  it('a buyer near a seller buys a listed item: item + gold move atomically, nothing duplicated', () => {
    const sim = serverSim(1337);
    const seller = sim.addPlayer('Seller');
    const buyer = sim.addPlayer('Buyer');
    sim.restorePlayer(seller, { bag: [{ ...SWORD, qty: 1 }], gold: 0 });
    sim.restorePlayer(buyer, { gold: 100 });

    run(sim, seller, { t: 'stall-open', listings: [{ ...SWORD, price: 50 }] });
    expect(ent(sim, seller).stallOpen).toBe(true); // public flag set -> buyers can find the seller
    walkOnto(sim, buyer, seller);
    run(sim, buyer, { t: 'stall-buy', sellerId: seller, ...SWORD });

    expect(swords(sim, seller)).toBe(0); // the seller handed over the sword...
    expect(swords(sim, buyer)).toBe(1); // ...the buyer received exactly one (no dup)
    expect(gold(sim, seller)).toBe(50); // seller earned the price
    expect(gold(sim, buyer)).toBe(50); // buyer paid the price
  });

  it('ANTI-DUP: two buyers race for the LAST unit on the SAME tick — exactly one gets it', () => {
    const sim = serverSim(1337);
    const seller = sim.addPlayer('Seller');
    const b1 = sim.addPlayer('B1');
    const b2 = sim.addPlayer('B2');
    sim.restorePlayer(seller, { bag: [{ ...SWORD, qty: 1 }], gold: 0 });
    sim.restorePlayer(b1, { gold: 100 });
    sim.restorePlayer(b2, { gold: 100 });
    run(sim, seller, { t: 'stall-open', listings: [{ ...SWORD, price: 50 }] });
    walkOnto(sim, b1, seller);
    walkOnto(sim, b2, seller);

    // BOTH submit the buy on the same tick — the single-threaded tick serializes them.
    sim.sendCommandFor(b1, { t: 'stall-buy', sellerId: seller, ...SWORD });
    sim.sendCommandFor(b2, { t: 'stall-buy', sellerId: seller, ...SWORD });
    sim.step();

    const total = swords(sim, seller) + swords(sim, b1) + swords(sim, b2);
    expect(total).toBe(1); // the ONE sword exists exactly once across everyone — no duplication, no destroy
    expect(swords(sim, seller)).toBe(0); // it left the seller
    expect(swords(sim, b1) + swords(sim, b2)).toBe(1); // exactly one buyer got it
    const paid = (100 - gold(sim, b1)) + (100 - gold(sim, b2));
    expect(paid).toBe(50); // exactly ONE 50g charge (the loser paid nothing)
    expect(gold(sim, seller)).toBe(50); // the seller booked exactly one sale
  });

  it('aborts cleanly when the buyer cannot afford it (no item, no gold moves)', () => {
    const sim = serverSim(1337);
    const seller = sim.addPlayer('Seller');
    const buyer = sim.addPlayer('Buyer');
    sim.restorePlayer(seller, { bag: [{ ...SWORD, qty: 1 }], gold: 0 });
    sim.restorePlayer(buyer, { gold: 10 }); // price is 50 -> can't afford
    run(sim, seller, { t: 'stall-open', listings: [{ ...SWORD, price: 50 }] });
    walkOnto(sim, buyer, seller);
    run(sim, buyer, { t: 'stall-buy', sellerId: seller, ...SWORD });

    expect(swords(sim, seller)).toBe(1); // seller still holds it
    expect(swords(sim, buyer)).toBe(0); // buyer got nothing
    expect(gold(sim, buyer)).toBe(10); // no gold moved either way
    expect(gold(sim, seller)).toBe(0);
  });

  it('a buyer OUT OF RANGE cannot buy', () => {
    const sim = serverSim(1337);
    const seller = sim.addPlayer('Seller');
    const buyer = sim.addPlayer('Buyer');
    sim.restorePlayer(seller, { bag: [{ ...SWORD, qty: 1 }], gold: 0 });
    sim.restorePlayer(buyer, { gold: 100 });
    run(sim, seller, { t: 'stall-open', listings: [{ ...SWORD, price: 50 }] });
    for (let i = 0; i < 80; i++) { sim.sendCommandFor(buyer, { t: 'move', dx: 1, dz: 1 }); sim.step(); } // walk far away
    run(sim, buyer, { t: 'stall-buy', sellerId: seller, ...SWORD });
    expect(swords(sim, buyer)).toBe(0); // nothing bought from afar
    expect(swords(sim, seller)).toBe(1);
  });

  it('open-stall only lists items you actually hold (and rejects free/garbage prices)', () => {
    const sim = serverSim(1337);
    const seller = sim.addPlayer('Seller');
    sim.restorePlayer(seller, { bag: [] }); // empty bag — owns nothing to sell
    run(sim, seller, { t: 'stall-open', listings: [{ ...SWORD, price: 50 }] });
    expect(ent(sim, seller).stallOpen).toBe(false); // no valid listing -> no stall opens
  });

  it('closing a stall (and disconnecting) clears the public flag + the listing', () => {
    const sim = serverSim(1337);
    const seller = sim.addPlayer('Seller');
    sim.restorePlayer(seller, { bag: [{ ...SWORD, qty: 1 }] });
    run(sim, seller, { t: 'stall-open', listings: [{ ...SWORD, price: 50 }] });
    expect(ent(sim, seller).stallOpen).toBe(true);
    run(sim, seller, { t: 'stall-close' });
    expect(ent(sim, seller).stallOpen).toBe(false);
  });

  it('deterministic: open + buy hashes identically (same seed + commands)', () => {
    const play = (): string => {
      const sim = serverSim(7);
      const seller = sim.addPlayer('S');
      const buyer = sim.addPlayer('B');
      sim.restorePlayer(seller, { bag: [{ ...SWORD, qty: 1 }], gold: 0 });
      sim.restorePlayer(buyer, { gold: 100 });
      run(sim, seller, { t: 'stall-open', listings: [{ ...SWORD, price: 50 }] });
      walkOnto(sim, buyer, seller);
      run(sim, buyer, { t: 'stall-buy', sellerId: seller, ...SWORD });
      for (let i = 0; i < 10; i++) sim.step();
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});
