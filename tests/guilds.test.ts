// Guildas (GDD v0.5 §1) — the SOCIAL CORE. Like matching/chat, guilds are SERVER state (a roster + /g
// chat), deliberately NOT in the deterministic sim, so these are server-boundary tests: the pure
// GuildRegistry bookkeeping + the ServerWorld formation flow (create / invite-by-name / accept / cleanup).
import { describe, it, expect } from 'vitest';
import { GuildRegistry } from '../server/guilds';
import { ServerWorld } from '../server/world';

describe('GuildRegistry — pure bookkeeping (server state, not the sim)', () => {
  it('create forms a guild owned by the creator; rejects duplicate names + already-in-a-guild + empty', () => {
    const r = new GuildRegistry();
    const g = r.create(1, 'Os Bravos');
    expect(g).not.toBeNull();
    expect(g!.ownerId).toBe(1);
    expect(g!.members).toEqual([1]);
    expect(r.guildOf(1)).toBe(g);
    expect(r.isOwner(1)).toBe(true);
    expect(r.create(2, 'os bravos')).toBeNull(); // duplicate name (case-insensitive)
    expect(r.create(1, 'Outra')).toBeNull(); // already in a guild
    expect(r.create(3, '   ')).toBeNull(); // empty/blank name
  });

  it('invite/accept: owner-only invite, one outstanding, accept joins; decline drops it', () => {
    const r = new GuildRegistry();
    r.create(1, 'Clã');
    expect(r.invite(2, 3)).toBeNull(); // a non-owner can't invite
    expect(r.invite(1, 1)).toBeNull(); // can't invite yourself
    expect(r.invite(1, 2)).not.toBeNull(); // the owner invites 2
    expect(r.inviteGuildOf(2)!.name).toBe('Clã');
    expect(r.accept(2)).not.toBeNull();
    expect(r.guildOf(2)!.name).toBe('Clã');
    expect(r.membersOf(1)).toEqual([1, 2]);
    expect(r.inviteGuildOf(2)).toBeNull(); // the invite was consumed
    expect(r.accept(2)).toBeNull(); // already a member -> no second join
    r.invite(1, 4);
    r.decline(4);
    expect(r.accept(4)).toBeNull(); // declined -> nothing to accept
    expect(r.guildOf(4)).toBeNull();
  });

  it('leave: a member leaves; owner-leave promotes the next member; the last member dissolves it', () => {
    const r = new GuildRegistry();
    r.create(1, 'G'); r.invite(1, 2); r.accept(2); r.invite(1, 3); r.accept(3);
    expect(r.membersOf(1)).toEqual([1, 2, 3]);
    r.leave(2); // a plain member leaves
    expect(r.membersOf(1)).toEqual([1, 3]);
    r.leave(1); // the OWNER leaves -> promote the next member (3)
    expect(r.guildOf(3)!.ownerId).toBe(3);
    expect(r.guildOf(1)).toBeNull();
    r.leave(3); // last member out -> dissolve
    expect(r.guildOf(3)).toBeNull();
  });

  it('kick: owner removes a member; non-owner / self / cross-guild kicks are rejected', () => {
    const r = new GuildRegistry();
    r.create(1, 'G'); r.invite(1, 2); r.accept(2);
    expect(r.kick(2, 1)).toBeNull(); // a non-owner can't kick
    expect(r.kick(1, 1)).toBeNull(); // can't kick yourself
    expect(r.kick(1, 99)).toBeNull(); // not a member of my guild
    expect(r.kick(1, 2)).not.toBeNull();
    expect(r.guildOf(2)).toBeNull();
  });

  it('forgetPlayer (disconnect): drops the invite + leaves, promoting/dissolving as needed', () => {
    const r = new GuildRegistry();
    r.create(1, 'G'); r.invite(1, 2); r.accept(2);
    r.forgetPlayer(1); // the OWNER disconnects -> 2 is promoted, the guild survives
    expect(r.guildOf(2)!.ownerId).toBe(2);
    expect(r.guildOf(1)).toBeNull();
  });
});

describe('ServerWorld — guild formation by name + /g routing', () => {
  it('create + invite-by-name + accept forms a guild; guildMemberIds routes /g', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('Alice');
    const b = w.addPlayer('Bob');
    expect(w.createGuild(a, 'Os Bravos')).not.toBeNull();
    expect(w.guildOf(a)!.name).toBe('Os Bravos');
    const inv = w.inviteToGuild(a, 'Bob'); // invite BY NAME (resolved to the online player)
    expect(inv).not.toBeNull();
    expect(inv!.inviteeId).toBe(b);
    expect(w.acceptGuildInvite(b)).not.toBeNull();
    expect(w.guildMemberIds(a)).toContain(a);
    expect(w.guildMemberIds(a)).toContain(b);
    expect(w.guildMemberIds(a).length).toBe(2);
    expect(w.guildMemberIds(b)).toContain(a); // both see the same roster (routes /g for both)
  });

  it('invite-by-name fails for an offline / unknown name', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('Alice');
    w.createGuild(a, 'Clã');
    expect(w.inviteToGuild(a, 'Ninguém')).toBeNull();
  });

  it('a disconnecting member is removed from the guild (server cleanup in removePlayer)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('Alice');
    const b = w.addPlayer('Bob');
    w.createGuild(a, 'Clã');
    w.inviteToGuild(a, 'Bob');
    w.acceptGuildInvite(b);
    expect(w.guildMemberIds(a)).toContain(b);
    w.removePlayer(b);
    expect(w.guildMemberIds(a)).not.toContain(b); // gone with the disconnect
  });
});
