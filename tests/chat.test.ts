// Chat moderation: the server-side sanitize + anti-flood (server/chat.ts). Pure logic
// with the clock injected, so these are deterministic. Chat is NOT in src/sim/ — it's
// communication, not simulation — so it has its own tests here.
import { describe, it, expect } from 'vitest';
import { ChatModerator } from '../server/chat';

describe('ChatModerator — sanitize + anti-flood', () => {
  it('drops empty / whitespace-only / non-string messages', () => {
    const m = new ChatModerator(200, 3);
    expect(m.accept(1, '', 0)).toBeNull();
    expect(m.accept(1, '   ', 0)).toBeNull();
    expect(m.accept(1, 42 as never, 0)).toBeNull();
    expect(m.accept(1, undefined as never, 0)).toBeNull();
  });

  it('trims surrounding whitespace and caps the text at maxLen', () => {
    const m = new ChatModerator(10, 3);
    expect(m.accept(1, '  hi  ', 0)).toBe('hi');
    expect(m.accept(2, 'x'.repeat(50), 0)).toBe('x'.repeat(10)); // capped at 10
  });

  it('rate-limits per player within a rolling second (anti-flood)', () => {
    const m = new ChatModerator(200, 3);
    expect(m.accept(1, 'a', 1000)).toBe('a');
    expect(m.accept(1, 'b', 1100)).toBe('b');
    expect(m.accept(1, 'c', 1200)).toBe('c');
    expect(m.accept(1, 'd', 1300)).toBeNull(); // 4th within 1s -> dropped
    expect(m.accept(1, 'e', 2200)).toBe('e'); // window slid past the first -> allowed again
  });

  it('keeps rate limits PER player (independent)', () => {
    const m = new ChatModerator(200, 1);
    expect(m.accept(1, 'a', 0)).toBe('a');
    expect(m.accept(1, 'b', 100)).toBeNull(); // player 1 over its limit
    expect(m.accept(2, 'a', 100)).toBe('a'); // player 2 unaffected
  });

  it('forget() clears a player\'s rate-limit history (on disconnect)', () => {
    const m = new ChatModerator(200, 1);
    expect(m.accept(1, 'a', 0)).toBe('a');
    expect(m.accept(1, 'b', 100)).toBeNull();
    m.forget(1);
    expect(m.accept(1, 'c', 100)).toBe('c'); // history cleared -> allowed again
  });
});
