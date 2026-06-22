// Server day/night + random-but-capped gradual rain (server/weather.ts). Pure logic with
// the clock advanced by the caller and the RNG injected, so it's deterministic to test.
// Weather is NOT in src/sim/ — it's presentation state the server broadcasts so clients
// share one sky. Constructor: (daySeconds, rainMin, rainMax, clearMin, clearMax, ramp, start, rand).
import { describe, it, expect } from 'vitest';
import { Weather } from '../server/weather';

// A tiny deterministic PRNG (uniform 0..1) for the "random within caps" tests.
function lcg(seed: number): () => number {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}
// Seconds the world stays DRY (rain 0) from a fresh dry phase until rain first rises.
function nextDrySeconds(w: Weather): number {
  let s = 0;
  while (w.rainIntensity === 0 && s < 1e7) { w.step(1); s++; }
  return s;
}
// Seconds at FULL rain (intensity 1) for the current shower, then ride the ramp back to dry.
function nextWetSeconds(w: Weather): number {
  let guard = 0;
  while (w.rainIntensity < 1 && guard++ < 1e7) w.step(1); // climb the ramp to full
  let s = 0;
  while (w.rainIntensity === 1 && s < 1e7) { w.step(1); s++; } // count the full-wet hold
  guard = 0;
  while (w.rainIntensity > 0 && guard++ < 1e7) w.step(1); // ride the rampDown back to dry
  return s;
}

describe('Weather — synchronized day/night + random-but-capped gradual rain', () => {
  it('advances time forward and wraps at 1', () => {
    const w = new Weather(100, 1e9, 1e9, 1e9, 1e9, 10, 0.0, () => 0.5); // huge spans -> no rain here
    w.step(25);
    expect(w.timeOfDay).toBeCloseTo(0.25, 6);
    w.step(80); // 1.05 -> 0.05
    expect(w.timeOfDay).toBeCloseTo(0.05, 6);
  });

  it('starts at the given time of day, and dry', () => {
    const w = new Weather(240, 1e9, 1e9, 1e9, 1e9, 10, 0.33, () => 0.5);
    expect(w.timeOfDay).toBeCloseTo(0.33, 6);
    expect(w.rainIntensity).toBe(0);
  });

  it('rain ramps UP and DOWN gradually (continuous intensity, not a flip)', () => {
    // fixed spans (min==max): dry 100s, wet 20s, ramp 10s.
    const w = new Weather(1e9, 20, 20, 100, 100, 10, 0, () => 0.5);
    expect(w.rainIntensity).toBe(0); // dry
    w.step(100); // dry ends -> enter rampUp (still ~0)
    expect(w.rainIntensity).toBeCloseTo(0, 5);
    w.step(5); // halfway up the 10s ramp
    expect(w.rainIntensity).toBeCloseTo(0.5, 5);
    w.step(5); // top -> full rain
    expect(w.rainIntensity).toBe(1);
    w.step(10); // mid-shower
    expect(w.rainIntensity).toBe(1);
    w.step(10); // shower ends -> rampDown (still ~1)
    expect(w.rainIntensity).toBeCloseTo(1, 5);
    w.step(5); // halfway down
    expect(w.rainIntensity).toBeCloseTo(0.5, 5);
    w.step(5); // bottom -> dry
    expect(w.rainIntensity).toBe(0);
  });

  it('keeps the intensity within [0,1] across many ticks', () => {
    const w = new Weather(240, 20, 40, 30, 60, 8, 0.1, () => 0.3);
    for (let i = 0; i < 4000; i++) {
      w.step(0.05);
      expect(w.rainIntensity).toBeGreaterThanOrEqual(0);
      expect(w.rainIntensity).toBeLessThanOrEqual(1);
    }
  });

  it('each shower/dry spell is RANDOM within [min, cap] — rand=0 hits the min, rand=1 the cap', () => {
    // rain [120,900], dry [300,3600], ramp 10.
    const lo = new Weather(1e9, 120, 900, 300, 3600, 10, 0, () => 0);
    expect(nextDrySeconds(lo)).toBeCloseTo(300, -1); // clearMin (~within 5s of step granularity)
    expect(nextWetSeconds(lo)).toBeCloseTo(120, -1); // rainMin
    const hi = new Weather(1e9, 120, 900, 300, 3600, 10, 0, () => 1);
    expect(nextDrySeconds(hi)).toBeCloseTo(3600, -2); // clearMax = 60 min CAP (~within 50s)
    expect(nextWetSeconds(hi)).toBeCloseTo(900, -2); // rainMax = 15 min CAP
  });

  it('random durations NEVER exceed the caps (rain ≤ 900s, dry ≤ 3600s) over many cycles', () => {
    const w = new Weather(1e9, 120, 900, 300, 3600, 10, 0, lcg(98765));
    for (let c = 0; c < 12; c++) {
      const dry = nextDrySeconds(w);
      expect(dry).toBeGreaterThanOrEqual(300 - 2); // >= clearMin
      expect(dry).toBeLessThanOrEqual(3600 + 2); // <= clearMax cap (60 min)
      const wet = nextWetSeconds(w);
      expect(wet).toBeGreaterThanOrEqual(120 - 2); // >= rainMin
      expect(wet).toBeLessThanOrEqual(900 + 2); // <= rainMax cap (15 min)
    }
  });
});
