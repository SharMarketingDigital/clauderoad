import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { PARTY_MAX_EACH_GET, PARTY_MAX_AUTO_SHARE } from '../src/sim/party';
import type { Command } from '../src/world_api';

// Party is a MULTIPLAYER feature, so these drive a server-mode Sim (no local player;
// clients join via addPlayer) and apply each command on its own tick. Party state is
// authoritative in the sim, so we inspect it directly via partyViewFor / inviteViewFor.
function serverSim(seed = 1): Sim {
  return new Sim(seed, /* spawnLocal */ false);
}
function run(sim: Sim, id: number, cmd: Command): void {
  sim.sendCommandFor(id, cmd);
  sim.step(); // queued commands apply inside step()
}
const EACH_GET: Command = { t: 'party-create', exp: 'each-get', loot: 'distribution' };

describe('party structure (SF1)', () => {
  it('create + invite + accept forms a synchronized 2-member party with the right leader', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');

    run(sim, a, EACH_GET);
    let pa = sim.partyViewFor(a)!;
    expect(pa).not.toBeNull();
    expect(pa.members.map((m) => m.name)).toEqual(['A']);
    expect(pa.members[0].leader).toBe(true);
    expect(pa.expMode).toBe('each-get');
    expect(pa.lootMode).toBe('distribution');
    expect(pa.maxMembers).toBe(PARTY_MAX_EACH_GET);

    run(sim, a, { t: 'party-invite', name: 'B' });
    expect(sim.inviteViewFor(b)!.fromName).toBe('A'); // B has a pending invite from A

    run(sim, b, { t: 'party-accept' });
    pa = sim.partyViewFor(a)!;
    expect(pa.members.map((m) => m.name)).toEqual(['A', 'B']);
    expect(sim.partyViewFor(b)!.id).toBe(pa.id); // B sees the SAME party
    expect(sim.inviteViewFor(b)).toBeNull(); // invite consumed
  });

  it('refuse declines the invite (no join)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    run(sim, a, EACH_GET);
    run(sim, a, { t: 'party-invite', name: 'B' });
    run(sim, b, { t: 'party-refuse' });
    expect(sim.inviteViewFor(b)).toBeNull();
    expect(sim.partyViewFor(b)).toBeNull();
    expect(sim.partyViewFor(a)!.members.length).toBe(1);
  });

  it('a party that drops to one member dissolves (both go solo)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    run(sim, a, EACH_GET);
    run(sim, a, { t: 'party-invite', name: 'B' });
    run(sim, b, { t: 'party-accept' });
    run(sim, b, { t: 'party-leave' });
    expect(sim.partyViewFor(b)).toBeNull();
    expect(sim.partyViewFor(a)).toBeNull(); // A is alone -> dissolved
  });

  it('only the leader can kick a member', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    const c = sim.addPlayer('C');
    run(sim, a, EACH_GET);
    run(sim, a, { t: 'party-invite', name: 'B' });
    run(sim, b, { t: 'party-accept' });
    run(sim, a, { t: 'party-invite', name: 'C' });
    run(sim, c, { t: 'party-accept' });
    expect(sim.partyViewFor(a)!.members.length).toBe(3);

    run(sim, b, { t: 'party-kick', id: c }); // a non-leader can't kick
    expect(sim.partyViewFor(a)!.members.length).toBe(3);

    run(sim, a, { t: 'party-kick', id: c }); // the leader can
    expect(sim.partyViewFor(c)).toBeNull();
    expect(sim.partyViewFor(a)!.members.map((m) => m.name)).toEqual(['A', 'B']);
  });

  it('a leaving leader promotes the next member', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    const c = sim.addPlayer('C');
    run(sim, a, EACH_GET);
    run(sim, a, { t: 'party-invite', name: 'B' });
    run(sim, b, { t: 'party-accept' });
    run(sim, a, { t: 'party-invite', name: 'C' });
    run(sim, c, { t: 'party-accept' });
    run(sim, a, { t: 'party-leave' });
    const pb = sim.partyViewFor(b)!;
    expect(pb.members.map((m) => m.name)).toEqual(['B', 'C']);
    expect(pb.members.find((m) => m.leader)!.name).toBe('B'); // B promoted
    expect(sim.partyViewFor(a)).toBeNull();
  });

  it('respects the each-get cap of 4 (the 5th cannot join)', () => {
    const sim = serverSim();
    const names = ['A', 'B', 'C', 'D', 'E'];
    const ids = names.map((n) => sim.addPlayer(n));
    run(sim, ids[0], EACH_GET);
    for (let i = 1; i < ids.length; i++) {
      run(sim, ids[0], { t: 'party-invite', name: names[i] });
      run(sim, ids[i], { t: 'party-accept' });
    }
    expect(sim.partyViewFor(ids[0])!.members.length).toBe(PARTY_MAX_EACH_GET); // 4
    expect(sim.partyViewFor(ids[4])).toBeNull(); // E never got in
  });

  it('allows up to 8 members in auto-share', () => {
    const sim = serverSim();
    const names = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I'];
    const ids = names.map((n) => sim.addPlayer(n));
    run(sim, ids[0], { t: 'party-create', exp: 'auto-share', loot: 'auto-share' });
    for (let i = 1; i < ids.length; i++) {
      run(sim, ids[0], { t: 'party-invite', name: names[i] });
      run(sim, ids[i], { t: 'party-accept' });
    }
    expect(sim.partyViewFor(ids[0])!.members.length).toBe(PARTY_MAX_AUTO_SHARE); // 8 (9th blocked)
  });

  it('a disconnect (removePlayer) leaves the party', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    const c = sim.addPlayer('C');
    run(sim, a, EACH_GET);
    run(sim, a, { t: 'party-invite', name: 'B' });
    run(sim, b, { t: 'party-accept' });
    run(sim, a, { t: 'party-invite', name: 'C' });
    run(sim, c, { t: 'party-accept' });
    sim.removePlayer(b); // B disconnects
    expect(sim.partyViewFor(a)!.members.map((m) => m.name)).toEqual(['A', 'C']);
  });

  it('only the leader invites, and you cannot invite someone already grouped', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    const c = sim.addPlayer('C');
    run(sim, a, EACH_GET);
    run(sim, a, { t: 'party-invite', name: 'B' });
    run(sim, b, { t: 'party-accept' });

    run(sim, b, { t: 'party-invite', name: 'C' }); // B isn't the leader -> ignored
    expect(sim.inviteViewFor(c)).toBeNull();

    run(sim, a, { t: 'party-invite', name: 'B' }); // already grouped -> no new invite
    expect(sim.partyViewFor(a)!.members.length).toBe(2);
  });

  it('a leaving leader cancels the invites it had sent (no stale invite)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    const c = sim.addPlayer('C');
    const d = sim.addPlayer('D');
    run(sim, a, EACH_GET);
    run(sim, a, { t: 'party-invite', name: 'B' });
    run(sim, b, { t: 'party-accept' });
    run(sim, a, { t: 'party-invite', name: 'C' });
    run(sim, c, { t: 'party-accept' });
    run(sim, a, { t: 'party-invite', name: 'D' }); // D has a pending invite from A
    expect(sim.inviteViewFor(d)!.fromName).toBe('A');
    run(sim, a, { t: 'party-leave' }); // A leaves (B promoted); its pending invite to D dies
    expect(sim.inviteViewFor(d)).toBeNull();
    expect(sim.partyViewFor(b)!.members.map((m) => m.name)).toEqual(['B', 'C']);
  });

  it('a bot-driven player can still accept a party invite (auto-play owns only combat)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    run(sim, a, EACH_GET);
    run(sim, a, { t: 'party-invite', name: 'B' });
    run(sim, b, { t: 'set-bot', on: true }); // B turns auto-play ON
    run(sim, b, { t: 'party-accept' }); // still joins
    expect(sim.partyViewFor(b)!.members.map((m) => m.name)).toEqual(['A', 'B']);
  });

  it('party commands keep the sim deterministic (same seed + commands => identical hash)', () => {
    const scenario = (): string => {
      const sim = new Sim(7, false);
      const a = sim.addPlayer('A');
      const b = sim.addPlayer('B');
      const c = sim.addPlayer('C');
      run(sim, a, { t: 'party-create', exp: 'auto-share', loot: 'auto-share' });
      run(sim, a, { t: 'party-invite', name: 'B' });
      run(sim, b, { t: 'party-accept' });
      run(sim, a, { t: 'party-invite', name: 'C' });
      run(sim, c, { t: 'party-accept' });
      run(sim, a, { t: 'party-leave' }); // promote B
      for (let i = 0; i < 50; i++) sim.step();
      return sim.hash();
    };
    expect(scenario()).toBe(scenario());
  });
});
