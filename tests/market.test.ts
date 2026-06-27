// Global Marketplace — a central buy/sell board, all in the deterministic sim (gold + items are hashed).
// The defining difference from stalls is GLOBAL reach: list once, buy from ANYWHERE (no proximity). The
// atomic anti-dup transfer is the same transferItem the stalls use. Server-mode Sim, driven by commands.
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
const SWORD = { itemId: 'old_sword', rarity: 'normal' as const, plus: 0 };
const swords = (sim: Sim, id: number) => (sim.serializePlayer(id)?.bag ?? []).filter((s) => s != null && s.itemId === 'old_sword').length;
const gold = (sim: Sim, id: number) => sim.serializePlayer(id)!.gold;
const firstListing = (sim: Sim, viewerId: number) => sim.marketFor(viewerId).listings[0];

describe('Global Marketplace — list / browse / buy from anywhere', () => {
  it('a buyer FAR from the seller buys a globally-listed item: item + gold move atomically', () => {
    const sim = serverSim(1337);
    const seller = sim.addPlayer('Seller');
    const buyer = sim.addPlayer('Buyer');
    sim.restorePlayer(seller, { bag: [{ ...SWORD, qty: 1 }], gold: 0 });
    sim.restorePlayer(buyer, { gold: 100 });
    run(sim, seller, { t: 'market-list', ...SWORD, price: 50 });

    // walk the buyer FAR from the seller — a global market needs NO proximity (unlike a stall)
    for (let i = 0; i < 80; i++) { sim.sendCommandFor(buyer, { t: 'move', dx: 1, dz: 1 }); sim.step(); }
    const l = firstListing(sim, buyer);
    expect(l).toBeDefined();
    expect(l.own).toBe(false); // it's the seller's listing, seen by the buyer
    run(sim, buyer, { t: 'market-buy', listingId: l.id });

    expect(swords(sim, seller)).toBe(0); // item left the seller...
    expect(swords(sim, buyer)).toBe(1); // ...reached the (distant) buyer, exactly once
    expect(gold(sim, seller)).toBe(50);
    expect(gold(sim, buyer)).toBe(50);
  });

  it('ANTI-DUP: two buyers race for the last unit on the same tick — exactly one gets it', () => {
    const sim = serverSim(1337);
    const seller = sim.addPlayer('Seller');
    const b1 = sim.addPlayer('B1');
    const b2 = sim.addPlayer('B2');
    sim.restorePlayer(seller, { bag: [{ ...SWORD, qty: 1 }], gold: 0 });
    sim.restorePlayer(b1, { gold: 100 });
    sim.restorePlayer(b2, { gold: 100 });
    run(sim, seller, { t: 'market-list', ...SWORD, price: 50 });
    const lid = firstListing(sim, b1).id;

    sim.sendCommandFor(b1, { t: 'market-buy', listingId: lid });
    sim.sendCommandFor(b2, { t: 'market-buy', listingId: lid });
    sim.step();

    expect(swords(sim, seller) + swords(sim, b1) + swords(sim, b2)).toBe(1); // no dup, no destroy
    expect(swords(sim, b1) + swords(sim, b2)).toBe(1); // exactly one buyer got it
    expect((100 - gold(sim, b1)) + (100 - gold(sim, b2))).toBe(50); // exactly one charge
  });

  it('you cannot buy your OWN listing (self-trade rejected)', () => {
    const sim = serverSim(1337);
    const seller = sim.addPlayer('Seller');
    sim.restorePlayer(seller, { bag: [{ ...SWORD, qty: 1 }], gold: 0 });
    run(sim, seller, { t: 'market-list', ...SWORD, price: 50 });
    const l = firstListing(sim, seller);
    expect(l.own).toBe(true);
    run(sim, seller, { t: 'market-buy', listingId: l.id });
    expect(swords(sim, seller)).toBe(1); // unchanged
    expect(gold(sim, seller)).toBe(0);
  });

  it('only the owner can cancel a listing (the item was never escrowed — it stays in the bag)', () => {
    const sim = serverSim(1337);
    const seller = sim.addPlayer('Seller');
    const other = sim.addPlayer('Other');
    sim.restorePlayer(seller, { bag: [{ ...SWORD, qty: 1 }] });
    run(sim, seller, { t: 'market-list', ...SWORD, price: 50 });
    const lid = firstListing(sim, seller).id;
    run(sim, other, { t: 'market-cancel', listingId: lid }); // not the owner -> no-op
    expect(sim.marketFor(seller).listings.length).toBe(1);
    run(sim, seller, { t: 'market-cancel', listingId: lid }); // owner cancels
    expect(sim.marketFor(seller).listings.length).toBe(0);
    expect(swords(sim, seller)).toBe(1); // still in the bag (no escrow)
  });

  it('a listing self-removes once the seller runs out of the item', () => {
    const sim = serverSim(1337);
    const seller = sim.addPlayer('Seller');
    const buyer = sim.addPlayer('Buyer');
    sim.restorePlayer(seller, { bag: [{ ...SWORD, qty: 1 }], gold: 0 });
    sim.restorePlayer(buyer, { gold: 100 });
    run(sim, seller, { t: 'market-list', ...SWORD, price: 50 });
    const lid = firstListing(sim, buyer).id;
    run(sim, buyer, { t: 'market-buy', listingId: lid }); // buys the only one
    expect(sim.marketFor(buyer).listings.length).toBe(0); // gone from the board
  });

  it('deterministic: list + buy hashes identically (same seed + commands)', () => {
    const play = (): string => {
      const sim = serverSim(7);
      const s = sim.addPlayer('S');
      const b = sim.addPlayer('B');
      sim.restorePlayer(s, { bag: [{ ...SWORD, qty: 2 }], gold: 0 });
      sim.restorePlayer(b, { gold: 100 });
      run(sim, s, { t: 'market-list', ...SWORD, price: 50 });
      run(sim, b, { t: 'market-buy', listingId: sim.marketFor(b).listings[0].id });
      for (let i = 0; i < 5; i++) sim.step();
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});
