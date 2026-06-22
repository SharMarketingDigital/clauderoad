// Party matching (LFM lobby) tests. Two layers:
//   • MatchingRegistry — the PURE bookkeeping (listings + one-request-per-player + expiry);
//   • ServerWorld      — the SERVER-authoritative flow: register/list, request→approve
//     (which issues the sim's party-admit), deny, level limits, and the self-cleaning
//     reconcile (full / dissolved / expired listings, disconnected requesters).
// The lobby is server state, NOT the sim, so the determinism suite is untouched. We drive
// the wall-clock EXPLICITLY (ServerWorld.step(now)) so the ~1h expiry is deterministic.
import { describe, it, expect } from 'vitest';
import { MatchingRegistry } from '../server/matching';
import { ServerWorld } from '../server/world';

const TTL = 60 * 60 * 1000; // mirror MATCHING_TTL_MS (server-side, not exported)
const T0 = 1_000_000; // a fixed base wall-clock for the integration tests (ms)

describe('MatchingRegistry (lobby bookkeeping)', () => {
  it('register + list + get + has', () => {
    const r = new MatchingRegistry(TTL);
    r.register(1, 10, 'farm', 0, 0, 1000);
    expect(r.has(1)).toBe(true);
    expect(r.get(1)!.title).toBe('farm');
    expect(r.list().map((e) => e.partyId)).toEqual([1]);
  });

  it('unregister drops the listing and every request to it', () => {
    const r = new MatchingRegistry(TTL);
    r.register(1, 10, '', 0, 0, 0);
    r.requestJoin(20, 1);
    r.unregister(1);
    expect(r.has(1)).toBe(false);
    expect(r.requestOf(20)).toBeNull();
  });

  it('one outstanding request per player (a new request supersedes the old)', () => {
    const r = new MatchingRegistry(TTL);
    r.register(1, 10, '', 0, 0, 0);
    r.register(2, 11, '', 0, 0, 0);
    r.requestJoin(20, 1);
    r.requestJoin(20, 2); // moves the request from party 1 to party 2
    expect(r.requestOf(20)).toBe(2);
    expect(r.requestersOf(1)).toEqual([]);
    expect(r.requestersOf(2)).toEqual([20]);
  });

  it('a request to an unlisted party is rejected', () => {
    const r = new MatchingRegistry(TTL);
    expect(r.requestJoin(20, 99)).toBe(false);
    expect(r.requestOf(20)).toBeNull();
  });

  it('expire drops listings at/over the TTL and keeps fresh ones', () => {
    const r = new MatchingRegistry(TTL);
    r.register(1, 10, '', 0, 0, 1000); // becomes exactly TTL old below
    r.register(2, 11, '', 0, 0, 1000 + TTL); // just registered relative to `now`
    expect(r.expire(1000 + TTL)).toEqual([1]);
    expect(r.has(1)).toBe(false);
    expect(r.has(2)).toBe(true);
  });

  it('cancelRequest withdraws just that player', () => {
    const r = new MatchingRegistry(TTL);
    r.register(1, 10, '', 0, 0, 0);
    r.requestJoin(20, 1);
    r.requestJoin(21, 1);
    r.cancelRequest(20);
    expect(r.requestersOf(1)).toEqual([21]);
    expect(r.hasRequest(21, 1)).toBe(true);
  });
});

// ---- ServerWorld integration ----
// All steps use the SAME injected clock T0 (so a fresh listing never expires mid-test); the
// expiry test alone advances it past the TTL. Create a party via the normal command path.
function makeParty(w: ServerWorld, id: number, exp: 'each-get' | 'auto-share', loot: 'distribution' | 'auto-share'): number {
  w.command(id, { t: 'party-create', exp, loot });
  w.step(T0);
  return w.selfState(id).party!.id;
}
// Join `member` into `leader`'s party via the (already-tested) invite/accept path.
function joinViaInvite(w: ServerWorld, leader: number, member: number, name: string): void {
  w.command(leader, { t: 'party-invite', name });
  w.step(T0);
  w.command(member, { t: 'party-accept' });
  w.step(T0);
}

describe('ServerWorld — party matching (lobby)', () => {
  it('a leader registers the party and everyone sees it in the list', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    const pid = makeParty(w, a, 'each-get', 'distribution');
    w.registerMatching(a, 'farm de lobos', 0, 0, T0);
    const list = w.matchingList();
    expect(list.length).toBe(1);
    expect(list[0].partyId).toBe(pid);
    expect(list[0].leaderName).toBe('A');
    expect(list[0].title).toBe('farm de lobos');
    expect(list[0].expMode).toBe('each-get');
    expect(list[0].members).toBe(1);
    expect(list[0].maxMembers).toBe(4);
    expect(w.selfState(b).matching.length).toBe(1); // B sees the same shared list
  });

  it('only a leader can register; a solo player cannot', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    w.registerMatching(a, 'x', 0, 0, T0); // A is solo -> ignored
    expect(w.matchingList().length).toBe(0);
  });

  it('normalizes an inverted level range (50-10 -> 10-50) and clamps junk to 0', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    makeParty(w, a, 'each-get', 'distribution');
    w.registerMatching(a, 'faixa', 50, 10, T0); // typo: min > max -> swapped
    const e = w.matchingList()[0];
    expect(e.minLevel).toBe(10);
    expect(e.maxLevel).toBe(50);
    w.registerMatching(a, 'faixa', -5, Number.NaN, T0); // junk -> 0/0 (no bounds)
    const e2 = w.matchingList()[0];
    expect(e2.minLevel).toBe(0);
    expect(e2.maxLevel).toBe(0);
  });

  it('request -> the leader sees the pending request; approve admits the player', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    const pid = makeParty(w, a, 'each-get', 'distribution');
    w.registerMatching(a, 'lfm', 0, 0, T0);
    w.requestJoin(b, pid);
    expect(w.myRequestPartyId(b)).toBe(pid);
    expect(w.requestsFor(a).map((r) => r.name)).toEqual(['B']);
    w.approveJoin(a, b); // issues party-admit...
    w.step(T0); // ...applied on the next tick
    expect(w.selfState(b).party!.id).toBe(pid); // B joined the party
    expect(w.requestsFor(a)).toEqual([]); // the request was consumed
    expect(w.myRequestPartyId(b)).toBeNull();
  });

  it('deny drops the request without joining', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    const pid = makeParty(w, a, 'each-get', 'distribution');
    w.registerMatching(a, 'lfm', 0, 0, T0);
    w.requestJoin(b, pid);
    w.denyJoin(a, b);
    w.step(T0);
    expect(w.selfState(b).party).toBeNull(); // B did not join
    expect(w.requestsFor(a)).toEqual([]);
    expect(w.myRequestPartyId(b)).toBeNull();
  });

  it('the level restriction blocks a request below the minimum', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B'); // fresh level 1
    const pid = makeParty(w, a, 'each-get', 'distribution');
    w.registerMatching(a, 'só veteranos', 5, 0, T0); // min level 5
    w.requestJoin(b, pid); // B is level 1 -> rejected
    expect(w.myRequestPartyId(b)).toBeNull();
    expect(w.requestsFor(a)).toEqual([]);
  });

  it('only the leader can approve a join request', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    const c = w.addPlayer('C');
    const pid = makeParty(w, a, 'each-get', 'distribution');
    joinViaInvite(w, a, b, 'B'); // B joins (now 2 members, still listed)
    w.registerMatching(a, 'lfm', 0, 0, T0);
    w.requestJoin(c, pid);
    w.approveJoin(b, c); // B is a member, NOT the leader -> ignored
    w.step(T0);
    expect(w.selfState(c).party).toBeNull(); // C not admitted
    expect(w.requestsFor(a).map((r) => r.name)).toEqual(['C']); // still pending for the real leader
  });

  it('a party that fills up drops off the list (reconcile)', () => {
    const w = new ServerWorld(1337);
    const names = ['A', 'B', 'C', 'D'];
    const ids = names.map((n) => w.addPlayer(n));
    makeParty(w, ids[0], 'each-get', 'distribution');
    w.registerMatching(ids[0], 'lfm', 0, 0, T0);
    expect(w.matchingList().length).toBe(1);
    for (let i = 1; i < 4; i++) joinViaInvite(w, ids[0], ids[i], names[i]); // fill to the cap of 4
    expect(w.selfState(ids[0]).party!.members.length).toBe(4);
    w.step(T0);
    expect(w.matchingList().length).toBe(0); // a full party is no longer "looking for members"
  });

  it('a listing disappears when its party dissolves', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    makeParty(w, a, 'each-get', 'distribution'); // 1-member party (A leads)
    w.registerMatching(a, 'lfm', 0, 0, T0);
    expect(w.matchingList().length).toBe(1);
    w.command(a, { t: 'party-leave' }); // A leaves -> the party dissolves
    w.step(T0);
    expect(w.matchingList().length).toBe(0);
  });

  it('a listing expires after the TTL (~1h)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    makeParty(w, a, 'each-get', 'distribution');
    w.registerMatching(a, 'lfm', 0, 0, T0);
    expect(w.matchingList().length).toBe(1);
    w.step(T0 + TTL); // advance the server wall-clock past the listing's TTL
    expect(w.matchingList().length).toBe(0);
  });

  it('a requester disconnecting drops their pending request', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    const pid = makeParty(w, a, 'each-get', 'distribution');
    w.registerMatching(a, 'lfm', 0, 0, T0);
    w.requestJoin(b, pid);
    expect(w.requestsFor(a).length).toBe(1);
    w.removePlayer(b); // B disconnects
    expect(w.requestsFor(a)).toEqual([]);
  });

  it('a leader disconnecting removes their listing', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    makeParty(w, a, 'each-get', 'distribution');
    w.registerMatching(a, 'lfm', 0, 0, T0);
    expect(w.matchingList().length).toBe(1);
    w.removePlayer(a);
    expect(w.matchingList().length).toBe(0);
  });
});
