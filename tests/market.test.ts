// Global Marketplace (async) — list an item for sale GLOBALLY; it's ESCROWED out of the bag so it can sell
// while the seller is OFFLINE; the proceeds wait in the seller's MAILBOX to collect on return. All in the
// deterministic sim (gold + items are hashed) — anti-dup is free (single-threaded tick), no DB transaction
// needed. Persistence is a serialize/restore blob (P2). Server-mode Sim, driven by commands.
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

describe('Global Marketplace — escrow + async (sell while offline) + mailbox', () => {
  it('listing ESCROWS the item out of the bag onto the global board', () => {
    const sim = serverSim();
    const s = sim.addPlayer('Seller');
    sim.restorePlayer(s, { bag: [{ ...SWORD, qty: 1 }] });
    run(sim, s, { t: 'market-list', ...SWORD, price: 50 });
    expect(swords(sim, s)).toBe(0); // escrowed -> left the bag
    const l = firstListing(sim, s);
    expect(l.qty).toBe(1);
    expect(l.own).toBe(true);
  });

  it('a buyer buys while the SELLER is OFFLINE; proceeds wait in the mailbox to collect on return', () => {
    const sim = serverSim(1337);
    const s = sim.addPlayer('Seller');
    const b = sim.addPlayer('Buyer');
    sim.restorePlayer(s, { bag: [{ ...SWORD, qty: 1 }], gold: 0 });
    sim.restorePlayer(b, { gold: 100 });
    run(sim, s, { t: 'market-list', ...SWORD, price: 50 });
    const lid = firstListing(sim, b).id;
    sim.removePlayer(s); // the seller LOGS OFF

    run(sim, b, { t: 'market-buy', listingId: lid }); // buy from an OFFLINE seller (the killer feature)
    expect(swords(sim, b)).toBe(1); // buyer got the item (from escrow)
    expect(gold(sim, b)).toBe(50); // buyer paid
    expect(sim.marketFor(b).listings.length).toBe(0); // sold out

    const s2 = sim.addPlayer('Seller'); // the seller returns (new session)
    sim.restorePlayer(s2, { gold: 0 });
    expect(sim.marketFor(s2).mailboxGold).toBe(50); // the proceeds were waiting
    run(sim, s2, { t: 'market-collect' });
    expect(gold(sim, s2)).toBe(50); // collected into gold
    expect(sim.marketFor(s2).mailboxGold).toBe(0);
  });

  it('ANTI-DUP: two buyers race for the LAST unit on the same tick — exactly one gets it', () => {
    const sim = serverSim(1337);
    const s = sim.addPlayer('Seller');
    const b1 = sim.addPlayer('B1');
    const b2 = sim.addPlayer('B2');
    sim.restorePlayer(s, { bag: [{ ...SWORD, qty: 1 }], gold: 0 });
    sim.restorePlayer(b1, { gold: 100 });
    sim.restorePlayer(b2, { gold: 100 });
    run(sim, s, { t: 'market-list', ...SWORD, price: 50 });
    const lid = firstListing(sim, b1).id;
    sim.sendCommandFor(b1, { t: 'market-buy', listingId: lid });
    sim.sendCommandFor(b2, { t: 'market-buy', listingId: lid });
    sim.step();
    expect(swords(sim, b1) + swords(sim, b2)).toBe(1); // no dup, no destroy
    expect((100 - gold(sim, b1)) + (100 - gold(sim, b2))).toBe(50); // exactly one charge
  });

  it('cancel returns the escrowed stack to the bag', () => {
    const sim = serverSim();
    const s = sim.addPlayer('Seller');
    sim.restorePlayer(s, { bag: [{ ...SWORD, qty: 2 }] });
    run(sim, s, { t: 'market-list', ...SWORD, price: 50 });
    expect(swords(sim, s)).toBe(0); // escrowed
    const lid = firstListing(sim, s).id;
    run(sim, s, { t: 'market-cancel', listingId: lid });
    expect(swords(sim, s)).toBe(1); // the stack is back (one stack, qty 2)
    expect(sim.marketFor(s).listings.length).toBe(0);
  });

  it('you cannot buy your OWN listing', () => {
    const sim = serverSim();
    const s = sim.addPlayer('Seller');
    sim.restorePlayer(s, { bag: [{ ...SWORD, qty: 1 }], gold: 100 });
    run(sim, s, { t: 'market-list', ...SWORD, price: 50 });
    const lid = firstListing(sim, s).id;
    run(sim, s, { t: 'market-buy', listingId: lid });
    expect(gold(sim, s)).toBe(100); // unchanged
    expect(sim.marketFor(s).listings.length).toBe(1); // still listed
  });

  it('persistence: serializeMarket -> JSON -> restoreMarket round-trips listings + mailbox', () => {
    const sim = serverSim(1337);
    const s = sim.addPlayer('Seller');
    const b = sim.addPlayer('Buyer');
    sim.restorePlayer(s, { bag: [{ ...SWORD, qty: 2 }], gold: 0 });
    sim.restorePlayer(b, { gold: 100 });
    run(sim, s, { t: 'market-list', ...SWORD, price: 50 });
    run(sim, b, { t: 'market-buy', listingId: firstListing(sim, b).id }); // 1 sold -> mailbox 50g, 1 left
    const blob = JSON.parse(JSON.stringify(sim.serializeMarket())); // through JSON, like the DB

    const sim2 = serverSim(1337); // a fresh boot
    sim2.restoreMarket(blob);
    const s2 = sim2.addPlayer('Seller');
    const b2 = sim2.addPlayer('Buyer');
    sim2.restorePlayer(b2, { gold: 100 });
    const l = sim2.marketFor(b2).listings[0];
    expect(l).toBeDefined();
    expect(l.qty).toBe(1); // the remaining unit survived the restart
    expect(sim2.marketFor(s2).mailboxGold).toBe(50); // the seller's proceeds survived
    run(sim2, b2, { t: 'market-buy', listingId: l.id }); // and a buy still works on the restored listing
    expect(swords(sim2, b2)).toBe(1);
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
