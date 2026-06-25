import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Command } from '../src/world_api';

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
