// Server day/night + rain (server/weather.ts). Pure logic with the clock advanced by
// the caller and the RNG injected, so it's deterministic to test. Weather is NOT in
// src/sim/ — it's presentation state the server broadcasts so clients share one sky.
import { describe, it, expect } from 'vitest';
import { Weather } from '../server/weather';

describe('Weather — synchronized day/night + rain', () => {
  it('advances time forward and wraps at 1', () => {
    const w = new Weather(100, 1e9, 1e9, 0.0, () => 0.5); // 100s day; rain spans huge (won't flip here)
    w.step(25); // 25/100
    expect(w.timeOfDay).toBeCloseTo(0.25, 6);
    w.step(80); // 0.25 + 0.80 = 1.05 -> wraps to 0.05
    expect(w.timeOfDay).toBeCloseTo(0.05, 6);
  });

  it('starts at the given time of day', () => {
    const w = new Weather(240, 1e9, 1e9, 0.33, () => 0.5);
    expect(w.timeOfDay).toBeCloseTo(0.33, 6);
  });

  it('starts dry and auto-toggles rain on its timer (jitter via rand)', () => {
    // rand=0.5 -> span = mean*(0.5+0.5) = mean exactly: dry 10s, wet 4s.
    const w = new Weather(1000, 10, 4, 0, () => 0.5);
    expect(w.isRaining).toBe(false); // starts dry
    w.step(9);
    expect(w.isRaining).toBe(false); // still dry at 9s
    w.step(2);
    expect(w.isRaining).toBe(true); // crossed the ~10s dry span -> rain
    w.step(3);
    expect(w.isRaining).toBe(true); // still raining at +3s of the 4s wet span
    w.step(2);
    expect(w.isRaining).toBe(false); // crossed the ~4s wet span -> clear
  });

  it('rain span scales with the injected rand (0 -> 0.5x mean)', () => {
    const w = new Weather(1000, 10, 10, 0, () => 0); // dry span = 10*(0.5+0) = 5s
    w.step(4);
    expect(w.isRaining).toBe(false);
    w.step(2); // total 6 > 5 -> rain
    expect(w.isRaining).toBe(true);
  });

  it('keeps time within [0,1) across many ticks', () => {
    const w = new Weather(60, 30, 10, 0.9, () => 0.3);
    for (let i = 0; i < 2000; i++) {
      w.step(0.05); // 20Hz
      expect(w.timeOfDay).toBeGreaterThanOrEqual(0);
      expect(w.timeOfDay).toBeLessThan(1);
    }
  });
});
