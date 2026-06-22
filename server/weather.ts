// Server-authoritative time-of-day + weather. This is NOT in src/sim/: it's presentation
// state the server OWNS and broadcasts so every client sees the SAME sky and rain at the
// same moment. It's not gameplay and never touches the deterministic Sim. Pure logic —
// the clock is advanced by the caller (the server tick) and the RNG is injected — so it's
// unit-testable. The day/night look itself lives client-side (src/render/environment.ts);
// here we only track the abstract time (0..1) and a rain on/off flag.
export class Weather {
  private time: number; // 0..1 (0=midnight, .25=sunrise, .5=noon, .75=sunset)
  private raining = false;
  private rainTimer: number; // seconds until the next rain on/off flip

  constructor(
    private readonly daySeconds: number, // full day/night cycle length
    private readonly clearSeconds: number, // mean DRY span before rain starts
    private readonly wetSeconds: number, // mean RAINY span before it clears
    startTime = 0.33, // where the world opens (matches the offline START_TIME)
    private readonly rand: () => number = Math.random, // injected so tests are deterministic
  ) {
    this.time = ((startTime % 1) + 1) % 1;
    this.rainTimer = this.nextSpan(false); // start dry
  }

  // A jittered span (0.5x..1.5x the mean) until the next flip, so rain isn't clockwork.
  private nextSpan(raining: boolean): number {
    return (raining ? this.wetSeconds : this.clearSeconds) * (0.5 + this.rand());
  }

  // Advance by dt seconds (called from the server tick). Time wraps 0..1; rain auto-
  // toggles on its timer (dry ~clearSeconds, wet ~wetSeconds, both jittered).
  step(dt: number): void {
    this.time = (this.time + dt / this.daySeconds) % 1;
    this.rainTimer -= dt;
    if (this.rainTimer <= 0) {
      this.raining = !this.raining;
      this.rainTimer = this.nextSpan(this.raining);
    }
  }

  get timeOfDay(): number {
    return this.time;
  }
  get isRaining(): boolean {
    return this.raining;
  }
}
