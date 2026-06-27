// Guildas (GDD v0.5 §1) — the SOCIAL registry. SERVER state, NOT the deterministic sim (a roster + /g
// chat has no gameplay/RNG coupling). Keyed BY NAME so it can PERSIST across restarts + offline members
// (ids are per-session; the persistent identity is the join name, like the character save). PURE
// bookkeeping (no Rng/clock/DOM), unit-testable. The ServerWorld bridges live player ids <-> names.
//
// Membership PERSISTS: a disconnect does NOT remove you from your guild (only an explicit /guild leave or
// a kick does). Invites are transient + online-only (not persisted). The owner is tracked by name.
export interface Guild {
  name: string; // display name (original casing)
  owner: string; // owner player NAME (promoted on owner-leave)
  members: string[]; // member NAMES, join order (includes the owner); may include OFFLINE players
}

export class GuildRegistry {
  private byKey = new Map<string, Guild>(); // lowercased name -> guild
  private memberOf = new Map<string, string>(); // lowercased player name -> guild key
  private inviteOf = new Map<string, string>(); // lowercased invitee name -> guild key (ONE outstanding, transient)

  private gk(name: string): string { return name.trim().toLowerCase(); }
  private pk(name: string): string { return name.trim().toLowerCase(); }

  guildOf(name: string): Guild | null {
    const k = this.memberOf.get(this.pk(name));
    return k ? this.byKey.get(k) ?? null : null;
  }
  inviteGuildOf(name: string): Guild | null {
    const k = this.inviteOf.get(this.pk(name));
    return k ? this.byKey.get(k) ?? null : null;
  }
  membersOf(name: string): string[] {
    return this.guildOf(name)?.members ?? [];
  }
  isOwner(name: string): boolean {
    const g = this.guildOf(name);
    return g != null && this.pk(g.owner) === this.pk(name);
  }

  // Create a guild owned by ownerName. Fails on empty/duplicate name or an already-guilded owner.
  create(ownerName: string, rawName: string): Guild | null {
    const name = rawName.trim();
    const gkey = this.gk(name);
    if (!name || this.byKey.has(gkey) || this.memberOf.has(this.pk(ownerName))) return null;
    const g: Guild = { name, owner: ownerName, members: [ownerName] };
    this.byKey.set(gkey, g);
    this.memberOf.set(this.pk(ownerName), gkey);
    this.inviteOf.delete(this.pk(ownerName));
    return g;
  }

  // The OWNER invites a player BY NAME. One outstanding invite per invitee. Fails if the inviter isn't the
  // owner, or the invitee is self / already in a guild.
  invite(ownerName: string, inviteeName: string): Guild | null {
    const g = this.guildOf(ownerName);
    if (!g || this.pk(g.owner) !== this.pk(ownerName)) return null;
    if (this.pk(inviteeName) === this.pk(ownerName) || this.memberOf.has(this.pk(inviteeName))) return null;
    this.inviteOf.set(this.pk(inviteeName), this.memberOf.get(this.pk(ownerName))!);
    return g;
  }

  // Accept the pending invite -> join. Returns the joined guild (or null).
  accept(name: string): Guild | null {
    const k = this.inviteOf.get(this.pk(name));
    this.inviteOf.delete(this.pk(name));
    if (!k || this.memberOf.has(this.pk(name))) return null;
    const g = this.byKey.get(k);
    if (!g) return null;
    g.members.push(name);
    this.memberOf.set(this.pk(name), k);
    return g;
  }

  decline(name: string): void {
    this.inviteOf.delete(this.pk(name));
  }

  // Leave the guild (EXPLICIT — not a disconnect). Owner-leave promotes the next member; last out dissolves.
  // Returns the affected guild (dissolved or updated) for persistence; null if not in a guild.
  leave(name: string): Guild | null {
    const k = this.memberOf.get(this.pk(name));
    if (!k) return null;
    const g = this.byKey.get(k);
    this.memberOf.delete(this.pk(name));
    if (!g) return null;
    const i = g.members.findIndex((m) => this.pk(m) === this.pk(name));
    if (i >= 0) g.members.splice(i, 1);
    if (g.members.length === 0) {
      this.byKey.delete(k);
      return g; // dissolved (caller removes it from the store)
    }
    if (this.pk(g.owner) === this.pk(name)) g.owner = g.members[0]; // promote the next member
    return g;
  }

  // The owner kicks a member by name. Fails unless the kicker is the owner and the target is a DIFFERENT
  // member of the SAME guild. Returns the guild on success.
  kick(ownerName: string, targetName: string): Guild | null {
    const g = this.guildOf(ownerName);
    if (!g || this.pk(g.owner) !== this.pk(ownerName) || this.pk(targetName) === this.pk(ownerName)) return null;
    if (this.memberOf.get(this.pk(targetName)) !== this.memberOf.get(this.pk(ownerName))) return null; // not my guild
    this.leave(targetName);
    return g;
  }

  // On disconnect: drop only the (transient) outbound invite. MEMBERSHIP PERSISTS — you stay in your guild.
  forgetPlayer(name: string): void {
    this.inviteOf.delete(this.pk(name));
  }

  // ---- persistence bridge ----
  all(): Guild[] {
    return [...this.byKey.values()];
  }
  // Load a persisted guild into the registry (boot). Ignores a name already present (first wins).
  loadGuild(g: Guild): void {
    const gkey = this.gk(g.name);
    if (!g.name || this.byKey.has(gkey) || g.members.length === 0) return;
    const members = g.members.slice();
    const owner = members.some((m) => this.pk(m) === this.pk(g.owner)) ? g.owner : members[0];
    const loaded: Guild = { name: g.name, owner, members };
    this.byKey.set(gkey, loaded);
    for (const m of members) if (!this.memberOf.has(this.pk(m))) this.memberOf.set(this.pk(m), gkey);
  }
}
