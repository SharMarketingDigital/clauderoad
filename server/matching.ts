// Party matching ("looking for members") — the LOBBY registry. This is SERVER/session
// state, deliberately NOT the deterministic sim: it holds volatile metadata (a title,
// level limits, a wall-clock expiry) plus the pending join requests. The ACTUAL membership
// change is a sim command the server issues on approval (see ServerWorld.approveJoin), so
// the sim stays the single source of truth for who is in a party. PURE bookkeeping (ids +
// metadata + an injected clock), so it's unit-testable and never touches the game core —
// exactly like ChatModerator. Keyed by partyId (a party owns at most one listing).

export interface MatchingEntry {
  partyId: number;
  leaderId: number;
  title: string;
  minLevel: number; // 0 = no minimum
  maxLevel: number; // 0 = no maximum
  registeredAt: number; // ms (server wall-clock) — drives the ~1h expiry
}

export class MatchingRegistry {
  private entries = new Map<number, MatchingEntry>(); // partyId -> listing
  private requestsByParty = new Map<number, number[]>(); // partyId -> requester ids (join order)
  private requestByPlayer = new Map<number, number>(); // requesterId -> partyId (ONE outstanding request)

  // ttlMs: how long a listing survives without being refreshed (~1h, Silkroad).
  constructor(private readonly ttlMs: number) {}

  // Add or refresh a party's listing (re-registering resets the expiry timer).
  register(partyId: number, leaderId: number, title: string, minLevel: number, maxLevel: number, now: number): void {
    this.entries.set(partyId, { partyId, leaderId, title, minLevel, maxLevel, registeredAt: now });
  }

  // Remove a party's listing AND every pending request pointing at it.
  unregister(partyId: number): void {
    this.entries.delete(partyId);
    const reqs = this.requestsByParty.get(partyId);
    if (reqs) {
      for (const pid of reqs) this.requestByPlayer.delete(pid);
      this.requestsByParty.delete(partyId);
    }
  }

  has(partyId: number): boolean {
    return this.entries.has(partyId);
  }
  get(partyId: number): MatchingEntry | undefined {
    return this.entries.get(partyId);
  }
  list(): MatchingEntry[] {
    return [...this.entries.values()];
  }

  // Record a player's request to join a listed party. ONE outstanding request per player:
  // a new request supersedes any previous one. No-op if the party isn't listed.
  requestJoin(playerId: number, partyId: number): boolean {
    if (!this.entries.has(partyId)) return false;
    this.cancelRequest(playerId); // drop any prior request first (one at a time)
    const arr = this.requestsByParty.get(partyId) ?? [];
    if (!arr.includes(playerId)) arr.push(playerId);
    this.requestsByParty.set(partyId, arr);
    this.requestByPlayer.set(playerId, partyId);
    return true;
  }

  // Withdraw / drop a single player's pending request (wherever it points).
  cancelRequest(playerId: number): void {
    const partyId = this.requestByPlayer.get(playerId);
    if (partyId === undefined) return;
    this.requestByPlayer.delete(playerId);
    const arr = this.requestsByParty.get(partyId);
    if (arr) {
      const i = arr.indexOf(playerId);
      if (i >= 0) arr.splice(i, 1);
      if (arr.length === 0) this.requestsByParty.delete(partyId);
    }
  }

  requestersOf(partyId: number): number[] {
    return this.requestsByParty.get(partyId) ?? [];
  }
  requestOf(playerId: number): number | null {
    return this.requestByPlayer.get(playerId) ?? null;
  }
  // Does this player have a pending request to THIS specific party?
  hasRequest(playerId: number, partyId: number): boolean {
    return this.requestByPlayer.get(playerId) === partyId;
  }

  // Expire listings older than the TTL. Returns the partyIds removed (for logging/tests).
  expire(now: number): number[] {
    const dropped: number[] = [];
    for (const [partyId, e] of this.entries) {
      if (now - e.registeredAt >= this.ttlMs) {
        this.unregister(partyId);
        dropped.push(partyId);
      }
    }
    return dropped;
  }

  // Forget a player's OUTBOUND request (on disconnect). Their party's listing, if they led
  // one, is removed separately by the caller (it knows the partyId via the sim).
  forgetPlayer(playerId: number): void {
    this.cancelRequest(playerId);
  }
}
