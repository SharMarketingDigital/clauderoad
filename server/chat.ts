// Chat moderation: sanitize the text + per-player anti-flood. PURE logic (no sockets,
// no Node globals — the limits and the clock are injected), so it's unit-testable and
// the server just wires it to connections. This is NOT in src/sim/: chat is
// communication, not deterministic simulation, so it never touches the game core.

export class ChatModerator {
  // playerId -> timestamps (ms) of recently ACCEPTED messages, within the last second.
  private times = new Map<number, number[]>();

  // maxLen: hard cap on message length. ratePerSec: max accepted messages per player
  // per rolling second (anti-flood). Both are tunable (the server reads them from env).
  constructor(private readonly maxLen: number, private readonly ratePerSec: number) {}

  // Returns the sanitized text to broadcast, or null to DROP the message (empty after
  // trimming, or the player is over the rate limit). `now` is injected (Date.now() in
  // production) so tests are deterministic. Only the TEXT is trusted from the client —
  // never the sender name (the server supplies that from what it knows).
  accept(playerId: number, rawText: unknown, now: number): string | null {
    if (typeof rawText !== 'string') return null;
    const text = rawText.trim().slice(0, this.maxLen);
    if (text.length === 0) return null; // ignore empty / whitespace-only

    const recent = (this.times.get(playerId) ?? []).filter((t) => now - t < 1000);
    if (recent.length >= this.ratePerSec) {
      this.times.set(playerId, recent); // remember the window even when we reject
      return null; // over the limit -> drop (anti-flood)
    }
    recent.push(now);
    this.times.set(playerId, recent);
    return text;
  }

  // Forget a player's rate-limit history (on disconnect).
  forget(playerId: number): void {
    this.times.delete(playerId);
  }
}
