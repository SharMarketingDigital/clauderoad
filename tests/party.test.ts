import { describe, it, expect } from 'vitest';
import { Sim, xpForLevel, WORLD_HALF } from '../src/sim/sim';
import {
  PARTY_MAX_EACH_GET, PARTY_MAX_AUTO_SHARE, PARTY_SHARE_RANGE, eachGetBonus,
} from '../src/sim/party';
import { ENEMY_TEMPLATE } from '../src/sim/content/enemies';
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

// ---- SF2: XP/SP distribution ----
// Total XP a player has accumulated across all its levels (so a kill that crosses a
// level boundary is still measured exactly).
function totalXp(sim: Sim, id: number): number {
  const e = sim.entities().find((x) => x.id === id);
  if (!e) return 0;
  let t = e.xp;
  for (let L = 1; L < e.level; L++) t += xpForLevel(L);
  return t;
}
function spOf(sim: Sim, id: number): number {
  return sim.entities().find((x) => x.id === id)?.sp ?? 0;
}
// Drive `killerId` to kill ONE specific grey wolf (the nearest, captured up front so only
// THAT mob dies and its reward is measurable). `followers` chase the killer each tick so
// they stay within share range; everyone else is left where they are.
function killOneWolf(sim: Sim, killerId: number, followers: number[] = []): void {
  const find = (id: number) => sim.entities().find((x) => x.id === id);
  const k0 = find(killerId)!;
  const wolves = sim
    .entities()
    .filter((x) => x.kind === 'enemy' && !x.boss && x.species === 'grey_wolf' && x.hp > 0)
    .sort((a, b) => (a.x - k0.x) ** 2 + (a.z - k0.z) ** 2 - ((b.x - k0.x) ** 2 + (b.z - k0.z) ** 2));
  if (wolves.length === 0) return;
  const tid = wolves[0].id;
  for (let g = 0; g < 6000 && sim.entities().some((x) => x.id === tid && x.hp > 0); g++) {
    const w = find(tid);
    const k = find(killerId)!;
    if (!w) break;
    sim.sendCommandFor(killerId, { t: 'set-target', id: tid });
    sim.sendCommandFor(killerId, { t: 'move', dx: w.x - k.x, dz: w.z - k.z });
    sim.sendCommandFor(killerId, { t: 'use-ability', slot: 1 });
    for (const fid of followers) {
      const f = find(fid);
      const kk = find(killerId)!;
      if (f) sim.sendCommandFor(fid, { t: 'move', dx: kk.x - f.x, dz: kk.z - f.z });
    }
    sim.step();
  }
}

describe('party XP/SP distribution (SF2)', () => {
  it('the each-get bonus curve is +0/+2/+5/+10% by size', () => {
    expect(eachGetBonus(1)).toBe(1.0);
    expect(eachGetBonus(2)).toBe(1.02);
    expect(eachGetBonus(3)).toBe(1.05);
    expect(eachGetBonus(4)).toBe(1.1);
    expect(eachGetBonus(9)).toBe(1.1); // clamped to 4
    expect(PARTY_SHARE_RANGE).toBe(50);
  });

  it('each-get: the killer keeps its kill (with the size bonus); the others get nothing', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    run(sim, a, { t: 'party-create', exp: 'each-get', loot: 'distribution' });
    run(sim, a, { t: 'party-invite', name: 'B' });
    run(sim, b, { t: 'party-accept' });
    const xa0 = totalXp(sim, a);
    const xb0 = totalXp(sim, b);
    killOneWolf(sim, a); // A kills a starting (normal) wolf; B does nothing
    const base = ENEMY_TEMPLATE.xp; // a normal grey wolf
    expect(totalXp(sim, a) - xa0).toBe(Math.round(base * eachGetBonus(2))); // 25 * 1.02 -> 26
    expect(totalXp(sim, b) - xb0).toBe(0); // each-get: B earns nothing from A's kill
  });

  it('auto-share: in-range members both gain (split by level), summing to the kill XP', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    run(sim, a, { t: 'party-create', exp: 'auto-share', loot: 'distribution' });
    run(sim, a, { t: 'party-invite', name: 'B' });
    run(sim, b, { t: 'party-accept' });
    const xa0 = totalXp(sim, a);
    const xb0 = totalXp(sim, b);
    const sa0 = spOf(sim, a);
    const sb0 = spOf(sim, b);
    killOneWolf(sim, a, [b]); // B follows A, so both are in range at the kill
    const dxa = totalXp(sim, a) - xa0;
    const dxb = totalXp(sim, b) - xb0;
    expect(dxb).toBeGreaterThan(0); // B shared the kill (it was in range)
    expect(dxa).toBeGreaterThan(0);
    expect(dxa + dxb).toBe(ENEMY_TEMPLATE.xp); // nothing lost: the split sums to the kill XP
    // SP is shared the same way (both gained some, summing to the wolf's SP)
    expect(spOf(sim, a) - sa0 + (spOf(sim, b) - sb0)).toBe(ENEMY_TEMPLATE.sp);
  });

  it('auto-share: a member OUT of range gets nothing', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    run(sim, a, { t: 'party-create', exp: 'auto-share', loot: 'distribution' });
    run(sim, a, { t: 'party-invite', name: 'B' });
    run(sim, b, { t: 'party-accept' });
    // send B to the far corner, well beyond the share range, while A holds position
    for (let i = 0; i < 300; i++) {
      const bb = sim.entities().find((x) => x.id === b)!;
      sim.sendCommandFor(b, { t: 'move', dx: WORLD_HALF - bb.x, dz: WORLD_HALF - bb.z });
      sim.sendCommandFor(a, { t: 'stop' });
      sim.step();
    }
    const xb0 = totalXp(sim, b);
    const xa0 = totalXp(sim, a);
    killOneWolf(sim, a); // A kills near where it stands; B is far away
    const k = sim.entities().find((x) => x.id === a)!;
    const f = sim.entities().find((x) => x.id === b)!;
    expect(Math.hypot(k.x - f.x, k.z - f.z)).toBeGreaterThan(PARTY_SHARE_RANGE); // precondition: out of range
    expect(totalXp(sim, b) - xb0).toBe(0); // B got nothing
    expect(totalXp(sim, a) - xa0).toBe(ENEMY_TEMPLATE.xp); // A (alone in range) got it all
  });
});
