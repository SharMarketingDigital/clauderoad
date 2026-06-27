// Guildas (GDD v0.5 §1) — SERVER state (roster + /g chat), now NAME-based so it persists (members survive
// logout). Server-boundary tests: the pure GuildRegistry bookkeeping + persistence round-trip, and the
// ServerWorld id<->name bridge + the persist-on-disconnect behavior.
import { describe, it, expect } from 'vitest';
import { GuildRegistry } from '../server/guilds';
import { ServerWorld } from '../server/world';

describe('GuildRegistry — name-based bookkeeping (persistable)', () => {
  it('create forms a guild owned by the creator; rejects duplicate names + already-in-a-guild + empty', () => {
    const r = new GuildRegistry();
    const g = r.create('Alice', 'Os Bravos');
    expect(g).not.toBeNull();
    expect(g!.owner).toBe('Alice');
    expect(g!.members).toEqual(['Alice']);
    expect(r.guildOf('Alice')).toBe(g);
    expect(r.isOwner('Alice')).toBe(true);
    expect(r.create('Bob', 'os bravos')).toBeNull(); // duplicate name (case-insensitive)
    expect(r.create('Alice', 'Outra')).toBeNull(); // already in a guild
    expect(r.create('Cara', '   ')).toBeNull(); // empty name
  });

  it('invite/accept: owner-only, one outstanding, accept joins; decline drops it', () => {
    const r = new GuildRegistry();
    r.create('Alice', 'Clã');
    expect(r.invite('Bob', 'Carol')).toBeNull(); // non-owner can't invite
    expect(r.invite('Alice', 'Alice')).toBeNull(); // can't invite self
    expect(r.invite('Alice', 'Bob')).not.toBeNull();
    expect(r.inviteGuildOf('Bob')!.name).toBe('Clã');
    expect(r.accept('Bob')).not.toBeNull();
    expect(r.membersOf('Alice')).toEqual(['Alice', 'Bob']);
    expect(r.accept('Bob')).toBeNull(); // already a member
    r.invite('Alice', 'Carol'); r.decline('Carol');
    expect(r.accept('Carol')).toBeNull(); // declined -> nothing to accept
  });

  it('leave: a member leaves; owner-leave promotes the next; the last dissolves', () => {
    const r = new GuildRegistry();
    r.create('Alice', 'G'); r.invite('Alice', 'Bob'); r.accept('Bob'); r.invite('Alice', 'Carol'); r.accept('Carol');
    expect(r.membersOf('Alice')).toEqual(['Alice', 'Bob', 'Carol']);
    r.leave('Bob');
    expect(r.membersOf('Alice')).toEqual(['Alice', 'Carol']);
    r.leave('Alice'); // owner leaves -> Carol promoted
    expect(r.guildOf('Carol')!.owner).toBe('Carol');
    expect(r.guildOf('Alice')).toBeNull();
    const dissolved = r.leave('Carol');
    expect(dissolved!.members.length).toBe(0); // last member out -> dissolved
    expect(r.guildOf('Carol')).toBeNull();
  });

  it('kick: owner removes a member; non-owner / self / cross-guild rejected', () => {
    const r = new GuildRegistry();
    r.create('Alice', 'G'); r.invite('Alice', 'Bob'); r.accept('Bob');
    expect(r.kick('Bob', 'Alice')).toBeNull(); // non-owner
    expect(r.kick('Alice', 'Alice')).toBeNull(); // self
    expect(r.kick('Alice', 'Ninguém')).toBeNull(); // not a member
    expect(r.kick('Alice', 'Bob')).not.toBeNull();
    expect(r.guildOf('Bob')).toBeNull();
  });

  it('membership PERSISTS across a disconnect (forgetPlayer only drops the transient invite)', () => {
    const r = new GuildRegistry();
    r.create('Alice', 'G'); r.invite('Alice', 'Bob'); r.accept('Bob');
    r.forgetPlayer('Bob'); // a disconnect
    expect(r.guildOf('Bob')!.name).toBe('G'); // STILL a member (key insight of name-based persistence)
    r.invite('Alice', 'Carol'); r.forgetPlayer('Carol');
    expect(r.inviteGuildOf('Carol')).toBeNull(); // but the pending invite was dropped
  });

  it('all() + loadGuild() round-trip the registry (the persistence path)', () => {
    const r = new GuildRegistry();
    r.create('Alice', 'Os Bravos'); r.invite('Alice', 'Bob'); r.accept('Bob');
    const saved = r.all();
    expect(saved.length).toBe(1);
    const r2 = new GuildRegistry(); // a fresh boot
    for (const g of saved) r2.loadGuild(g);
    expect(r2.guildOf('Alice')!.name).toBe('Os Bravos');
    expect(r2.membersOf('Bob')).toContain('Alice');
    expect(r2.isOwner('Alice')).toBe(true);
  });
});

describe('ServerWorld — guild by name + /g routing (id<->name bridge) + persistence', () => {
  it('create + invite + accept forms a guild; guildMemberIds routes /g to ONLINE members', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('Alice');
    const b = w.addPlayer('Bob');
    expect(w.createGuild(a, 'Os Bravos')).not.toBeNull();
    expect(w.guildOf(a)!.name).toBe('Os Bravos');
    expect(w.inviteToGuild(a, 'Bob')!.inviteeId).toBe(b);
    expect(w.acceptGuildInvite(b)).not.toBeNull();
    expect(w.guildMemberIds(a)).toContain(b);
    expect(w.guildMemberIds(b)).toContain(a);
  });

  it('invite-by-name fails for an offline / unknown name (invites are online-only)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('Alice');
    w.createGuild(a, 'Clã');
    expect(w.inviteToGuild(a, 'Ninguém')).toBeNull();
  });

  it('membership SURVIVES a disconnect; an offline member is skipped in /g; returning re-joins', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('Alice');
    const b = w.addPlayer('Bob');
    w.createGuild(a, 'Clã');
    w.inviteToGuild(a, 'Bob');
    w.acceptGuildInvite(b);
    w.removePlayer(b); // Bob logs off
    expect(w.guildOf(a)!.members).toContain('Bob'); // STILL a member (persists by name)
    expect(w.guildMemberIds(a)).not.toContain(b); // but offline -> not routed /g
    const b2 = w.addPlayer('Bob'); // Bob returns (new session id)
    expect(w.guildMemberIds(a)).toContain(b2); // back in the guild + routable
  });

  it('loadGuilds restores a persisted guild; a returning member is already in it', () => {
    const w = new ServerWorld(1337);
    w.loadGuilds([{ name: 'Veteranos', owner: 'Alice', members: ['Alice', 'Bob'] }]); // as if loaded from the DB
    const a = w.addPlayer('Alice');
    const b = w.addPlayer('Bob');
    expect(w.guildOf(a)!.name).toBe('Veteranos');
    expect(w.guildMemberIds(a)).toContain(b); // both online + in the loaded guild
  });
});
