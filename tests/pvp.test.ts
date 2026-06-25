import { describe, it, expect } from 'vitest';
import { Sim, DEATH_RESPAWN_TICKS } from '../src/sim/sim';
import { chebyshev } from '../src/sim/zones';
import type { Command } from '../src/world_api';

// One entity's live view (position / hp / dead), by id.
const ent = (sim: Sim, id: number) => sim.entities().find((e) => e.id === id)!;

// Duels are a MULTIPLAYER feature (Tier 1 A1 — handshake only, no damage yet), so these drive a
// server-mode Sim (no local player; clients join via addPlayer) and apply each command on its own
// tick, exactly like party.test.ts. Duel state is authoritative in the sim, so we inspect it
// directly via duelViewFor / duelInviteViewFor.
function serverSim(seed = 1): Sim {
  return new Sim(seed, /* spawnLocal */ false);
}
function run(sim: Sim, id: number, cmd: Command): void {
  sim.sendCommandFor(id, cmd);
  sim.step(); // queued commands apply inside step()
}

describe('duel handshake (A1)', () => {
  it('challenge -> accept forms a symmetric pair (each sees the other as opponent)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');

    run(sim, a, { t: 'duel-challenge', name: 'B' });
    expect(sim.duelInviteViewFor(b)!.fromName).toBe('A'); // B has a pending challenge from A
    expect(sim.duelViewFor(a)).toBeNull(); // not paired yet
    expect(sim.duelViewFor(b)).toBeNull();

    run(sim, b, { t: 'duel-accept' });
    expect(sim.duelInviteViewFor(b)).toBeNull(); // challenge consumed
    expect(sim.duelViewFor(a)!.opponentName).toBe('B');
    expect(sim.duelViewFor(b)!.opponentName).toBe('A');
    expect(sim.duelViewFor(a)!.opponentId).toBe(b);
    expect(sim.duelViewFor(b)!.opponentId).toBe(a);
  });

  it('decline drops the challenge (no pair forms)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    run(sim, a, { t: 'duel-challenge', name: 'B' });
    run(sim, b, { t: 'duel-decline' });
    expect(sim.duelInviteViewFor(b)).toBeNull();
    expect(sim.duelViewFor(a)).toBeNull();
    expect(sim.duelViewFor(b)).toBeNull();
  });

  it('a player already in a duel cannot start another', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    const c = sim.addPlayer('C');
    run(sim, a, { t: 'duel-challenge', name: 'B' });
    run(sim, b, { t: 'duel-accept' }); // A <-> B now dueling
    run(sim, a, { t: 'duel-challenge', name: 'C' }); // ignored: A is already dueling
    expect(sim.duelInviteViewFor(c)).toBeNull();
    expect(sim.duelViewFor(a)!.opponentName).toBe('B');
  });

  it('a disconnecting duelist dissolves the duel for both', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    run(sim, a, { t: 'duel-challenge', name: 'B' });
    run(sim, b, { t: 'duel-accept' });
    expect(sim.duelViewFor(b)).not.toBeNull();
    sim.removePlayer(a);
    expect(sim.duelViewFor(b)).toBeNull(); // B is no longer dueling a ghost
  });

  it('the handshake is deterministic (same seed + commands => identical hash)', () => {
    const play = (seed: number): string => {
      const sim = serverSim(seed);
      const a = sim.addPlayer('A');
      const b = sim.addPlayer('B');
      run(sim, a, { t: 'duel-challenge', name: 'B' });
      run(sim, b, { t: 'duel-accept' });
      for (let i = 0; i < 20; i++) sim.step();
      return sim.hash();
    };
    expect(play(1337)).toBe(play(1337));
  });

  it('empty duel state is inert: a resolved (declined) handshake hashes identically to one that never dueled', () => {
    const mk = (): { sim: Sim; a: number; b: number } => {
      const sim = serverSim(7);
      const a = sim.addPlayer('A');
      const b = sim.addPlayer('B');
      return { sim, a, b };
    };
    // challenge + decline = 2 ticks, ending with EMPTY duel state.
    const declined = mk();
    run(declined.sim, declined.a, { t: 'duel-challenge', name: 'B' });
    run(declined.sim, declined.b, { t: 'duel-decline' });
    // 2 idle ticks, never touching duels at all.
    const plain = mk();
    plain.sim.step();
    plain.sim.step();
    // Same seed, same players, same tick count, and both end with empty duel maps (0 hash
    // iterations) — so the duel fold contributes nothing and the hashes are byte-identical.
    expect(declined.sim.hash()).toBe(plain.sim.hash());
  });

  it('forming a duel DOES change the hash (the fold observes live duel state)', () => {
    const mk = (): { sim: Sim; a: number; b: number } => {
      const sim = serverSim(7);
      const a = sim.addPlayer('A');
      const b = sim.addPlayer('B');
      return { sim, a, b };
    };
    const declined = mk();
    run(declined.sim, declined.a, { t: 'duel-challenge', name: 'B' });
    run(declined.sim, declined.b, { t: 'duel-decline' });

    const paired = mk();
    run(paired.sim, paired.a, { t: 'duel-challenge', name: 'B' });
    run(paired.sim, paired.b, { t: 'duel-accept' });

    // Identical except for the duel pair (same seed/players/2 ticks): the hashes MUST differ, so an
    // online client/server desync in duel state can never slip past the determinism fingerprint.
    expect(paired.sim.hash()).not.toBe(declined.sim.hash());
  });
});

describe('duel PvP damage (A2)', () => {
  // Walk a set of stacked players out of the central safe-zone, DIAGONALLY (x==z) so they cross the
  // town edge BETWEEN the cardinal spawn packs — keeping the duel free of mob interference. They
  // start stacked at the spawn (0,0), so identical movement keeps them adjacent (melee contact).
  // Step one player out of the central safe-zone, DIAGONALLY (between the cardinal spawn packs, to
  // dodge mob interference), until comfortably past the town edge (Chebyshev > 35).
  const walkOut = (sim: Sim, id: number): void => {
    sim.sendCommandFor(id, { t: 'move', dx: 1, dz: 1 });
    for (let i = 0; i < 600 && chebyshev(ent(sim, id).x, ent(sim, id).z) <= 35; i++) sim.step();
    sim.sendCommandFor(id, { t: 'stop' });
    sim.step();
  };

  // Drive a duel to its end: B steps out of town and waits there; A HUNTS B (walks onto it and
  // auto-attacks each tick, the way the farm helper closes on a mob — the sim separates stacked
  // bodies, so the attacker must approach) until the duel resolves. Deterministic (positions follow
  // from the seed), so it's safe inside the hash test too.
  const duelToDown = (sim: Sim, a: number, b: number): void => {
    walkOut(sim, b);
    for (let i = 0; i < 1500 && sim.duelViewFor(a) !== null; i++) {
      const ea = ent(sim, a); const eb = ent(sim, b);
      sim.sendCommandFor(a, { t: 'move', dx: eb.x - ea.x, dz: eb.z - ea.z });
      sim.sendCommandFor(a, { t: 'set-target', id: b });
      sim.step();
    }
  };

  it('a player is only targetable while you are in an active duel with them', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    sim.sendCommandFor(a, { t: 'set-target', id: b });
    sim.step();
    expect(sim.targetOf(a)).toBeNull(); // no duel -> another player is not a valid target (PvE-only)
    run(sim, a, { t: 'duel-challenge', name: 'B' });
    run(sim, b, { t: 'duel-accept' });
    sim.sendCommandFor(a, { t: 'set-target', id: b });
    sim.step();
    expect(sim.targetOf(a)).toBe(b); // the active opponent is now selectable
  });

  it('no PvP damage inside the town safe-zone, even in a duel', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    sim.restorePlayer(a, { baseStr: 400 }); // would obliterate B if the blow weren't withheld
    run(sim, a, { t: 'duel-challenge', name: 'B' });
    run(sim, b, { t: 'duel-accept' });
    expect(chebyshev(ent(sim, a).x, ent(sim, a).z)).toBeLessThanOrEqual(30); // both spawn in town
    const hp0 = ent(sim, b).hp;
    for (let i = 0; i < 120; i++) { sim.sendCommandFor(a, { t: 'set-target', id: b }); sim.step(); }
    expect(ent(sim, b).hp).toBe(hp0); // town is sanctuary: the blows are withheld
    expect(sim.duelViewFor(a)).not.toBeNull(); // and the duel is untouched
  });

  it('outside town the opponent takes damage; downing them ends the duel with no hard penalty, and the loser revives in town', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    // Give B a worn-able weapon so we can prove a duel loss does NOT cost durability (a PvE death would).
    sim.restorePlayer(b, { equipment: { weapon: { itemId: 'old_sword', rarity: 'normal', plus: 0, durability: 100 } } });
    sim.restorePlayer(a, { baseStr: 400 }); // hits hard -> a quick, deterministic down
    run(sim, a, { t: 'duel-challenge', name: 'B' });
    run(sim, b, { t: 'duel-accept' });
    const durBefore = sim.inventoryFor(b).equipment.find((e) => e.slot === 'weapon')!.durability;
    const hp0 = ent(sim, b).hp;

    duelToDown(sim, a, b);

    expect(ent(sim, b).hp).toBeLessThan(hp0); // PvP damage landed...
    expect(ent(sim, b).dead).toBe(true);      // ...and downed B
    expect(chebyshev(ent(sim, b).x, ent(sim, b).z)).toBeGreaterThan(30); // B fell OUTSIDE town (the safe-zone never let it die there)
    expect(sim.duelViewFor(a)).toBeNull();    // the duel ended when B fell...
    expect(sim.duelViewFor(b)).toBeNull();    // ...for both

    const durAfter = sim.inventoryFor(b).equipment.find((e) => e.slot === 'weapon')!.durability;
    expect(durAfter).toBe(durBefore); // friendly duel: NO durability penalty (a PvE death would wear it)

    for (let i = 0; i < DEATH_RESPAWN_TICKS + 5; i++) sim.step();
    const br = ent(sim, b);
    expect(br.dead).toBe(false); // revived...
    expect(chebyshev(br.x, br.z)).toBeLessThanOrEqual(30); // ...in town (the safe spawn)
  });

  it('PvP damage + duel resolution is deterministic (same seed + commands => identical hash)', () => {
    const play = (): string => {
      const sim = serverSim(7);
      const a = sim.addPlayer('A');
      const b = sim.addPlayer('B');
      sim.restorePlayer(a, { baseStr: 400 });
      run(sim, a, { t: 'duel-challenge', name: 'B' });
      run(sim, b, { t: 'duel-accept' });
      duelToDown(sim, a, b);
      for (let i = 0; i < DEATH_RESPAWN_TICKS + 5; i++) sim.step(); // fold B's respawn too
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});
