// Guildas (GDD v0.5 §1) — the SOCIAL CORE registry. Like the matching lobby + ChatModerator, this is
// SERVER/session state, deliberately NOT the deterministic sim: a guild roster + /g chat has ZERO
// gameplay/RNG coupling in this pass (warehouse, war and Postgres persistence are deferred), so putting
// it in the sim would needlessly grow the hashed state. PURE bookkeeping (ids + names + one-outstanding
// invite), unit-testable, never touches the game core — exactly like MatchingRegistry. Keyed by the
// lowercased guild name (names are unique). The owner is always members[0]'s role, tracked explicitly.
export interface Guild {
  name: string; // the display name (original casing)
  ownerId: number; // the current owner (leader); promoted on owner-leave
  members: number[]; // player ids, join order (includes the owner)
}

export class GuildRegistry {
  private byKey = new Map<string, Guild>(); // lowercased name -> guild
  private memberOf = new Map<number, string>(); // playerId -> guild key
  private inviteOf = new Map<number, string>(); // inviteeId -> guild key (ONE outstanding invite)

  private key(name: string): string {
    return name.trim().toLowerCase();
  }

  guildOf(id: number): Guild | null {
    const k = this.memberOf.get(id);
    return k ? this.byKey.get(k) ?? null : null;
  }
  inviteGuildOf(id: number): Guild | null {
    const k = this.inviteOf.get(id);
    return k ? this.byKey.get(k) ?? null : null;
  }
  membersOf(id: number): number[] {
    return this.guildOf(id)?.members ?? [];
  }
  isOwner(id: number): boolean {
    const g = this.guildOf(id);
    return g != null && g.ownerId === id;
  }

  // Create a guild owned by ownerId. Fails if the trimmed name is empty, already taken, or the owner is
  // already in a guild. Returns the created guild (or null).
  create(ownerId: number, rawName: string): Guild | null {
    const name = rawName.trim();
    const k = this.key(name);
    if (!name || this.byKey.has(k) || this.memberOf.has(ownerId)) return null;
    const g: Guild = { name, ownerId, members: [ownerId] };
    this.byKey.set(k, g);
    this.memberOf.set(ownerId, k);
    this.inviteOf.delete(ownerId); // a fresh owner has no pending invite
    return g;
  }

  // The OWNER invites an online player (by id) to their guild. One outstanding invite per invitee (a new
  // invite supersedes any prior). Fails if the inviter isn't an owner, or the invitee is self / already
  // in a guild. Returns the guild the invite is for.
  invite(ownerId: number, inviteeId: number): Guild | null {
    const g = this.guildOf(ownerId);
    if (!g || g.ownerId !== ownerId || inviteeId === ownerId || this.memberOf.has(inviteeId)) return null;
    this.inviteOf.set(inviteeId, this.memberOf.get(ownerId)!);
    return g;
  }

  // Accept the pending invite -> join the guild. Returns the joined guild (or null if no invite / already
  // grouped / the guild vanished).
  accept(id: number): Guild | null {
    const k = this.inviteOf.get(id);
    this.inviteOf.delete(id); // consume the invite either way
    if (!k || this.memberOf.has(id)) return null;
    const g = this.byKey.get(k);
    if (!g) return null;
    g.members.push(id);
    this.memberOf.set(id, k);
    return g;
  }

  decline(id: number): void {
    this.inviteOf.delete(id);
  }

  // Leave the guild. The owner leaving promotes the next member; the last member out dissolves it.
  leave(id: number): Guild | null {
    const k = this.memberOf.get(id);
    if (!k) return null;
    const g = this.byKey.get(k);
    this.memberOf.delete(id);
    if (!g) return null;
    const i = g.members.indexOf(id);
    if (i >= 0) g.members.splice(i, 1);
    if (g.members.length === 0) {
      this.byKey.delete(k);
      return g; // dissolved
    }
    if (g.ownerId === id) g.ownerId = g.members[0]; // promote the next member in join order
    return g;
  }

  // The owner kicks a member (by id). Fails unless the kicker is the owner and the target is a DIFFERENT
  // member of the SAME guild. Returns the guild on success.
  kick(ownerId: number, targetId: number): Guild | null {
    const g = this.guildOf(ownerId);
    if (!g || g.ownerId !== ownerId || targetId === ownerId) return null;
    if (this.memberOf.get(targetId) !== this.memberOf.get(ownerId)) return null; // not in my guild
    this.leave(targetId);
    return g;
  }

  // On disconnect: drop any outbound invite AND leave the guild (promoting/dissolving as needed).
  forgetPlayer(id: number): void {
    this.inviteOf.delete(id);
    this.leave(id);
  }
}
