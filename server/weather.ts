// Server-authoritative time-of-day + weather. NOT in src/sim/: it's presentation state
// the server OWNS and broadcasts so every client sees the SAME sky and rain at the same
// moment. Not gameplay, never touches the deterministic Sim. Pure logic (clock advanced
// by the caller, RNG injected) so it's unit-testable.
//
// Rain is a CONTINUOUS intensity (0..1), not an on/off flag: it's dry most of the time,
// then occasionally a shower RAMPS in (0 -> 1 over `rampSeconds`), holds for a while, and
// RAMPS out again — so the client's sky/clouds/light ease in and out naturally. Each dry
// span and each wet span draws a UNIFORM-RANDOM duration between a minimum and a CAP, so
// the weather is unpredictable (sometimes a quick shower, sometimes a long one) but the
// rain never lasts past `rainMax` and the dry never past `clearMax`.
export class Weather {
  private time: number; // 0..1 (0=midnight, .25=sunrise, .5=noon, .75=sunset)
  private rain = 0; // current rain intensity 0..1
  private phase: 'dry' | 'rampUp' | 'wet' | 'rampDown' = 'dry';
  private phaseLeft: number; // seconds remaining in the current phase

  constructor(
    private readonly daySeconds: number, // full day/night cycle length
    private readonly rainMinSeconds: number, // shortest possible shower (the wet hold)
    private readonly rainMaxSeconds: number, // CAP on a shower (e.g. 900 = 15 min)
    private readonly clearMinSeconds: number, // shortest possible dry spell
    private readonly clearMaxSeconds: number, // CAP on a dry spell (e.g. 3600 = 60 min)
    private readonly rampSeconds: number, // how long rain takes to arrive / clear (gradual)
    startTime = 0.33, // where the world opens (matches the offline START_TIME)
    private readonly rand: () => number = Math.random, // injected so tests are deterministic
  ) {
    this.time = ((startTime % 1) + 1) % 1;
    this.phaseLeft = this.drySpan(); // start dry
  }

  // A uniform-random duration in [min, max] (capped at max). Math.max(0, …) keeps it
  // safe even if a misconfig made min > max (degenerates to `min`, never negative).
  private span(min: number, max: number): number {
    return min + this.rand() * Math.max(0, max - min);
  }
  private drySpan(): number {
    return this.span(this.clearMinSeconds, this.clearMaxSeconds);
  }
  private wetSpan(): number {
    return this.span(this.rainMinSeconds, this.rainMaxSeconds);
  }

  // Advance by dt seconds (called from the server tick). Time wraps 0..1; the rain
  // intensity follows the dry -> rampUp -> wet -> rampDown -> dry state machine.
  step(dt: number): void {
    this.time = (this.time + dt / this.daySeconds) % 1;
    this.phaseLeft -= dt;
    if (this.phaseLeft <= 0) this.advance(); // dt << any span at 20Hz, so one step at most
    // Continuous intensity from the (possibly just-changed) phase.
    if (this.phase === 'rampUp') this.rain = clamp01(1 - this.phaseLeft / this.rampSeconds); // 0 -> 1
    else if (this.phase === 'rampDown') this.rain = clamp01(this.phaseLeft / this.rampSeconds); // 1 -> 0
    else this.rain = this.phase === 'wet' ? 1 : 0;
  }

  private advance(): void {
    if (this.phase === 'dry') {
      this.phase = 'rampUp';
      this.phaseLeft = this.rampSeconds;
    } else if (this.phase === 'rampUp') {
      this.phase = 'wet';
      this.phaseLeft = this.wetSpan(); // random shower length, capped at rainMax
    } else if (this.phase === 'wet') {
      this.phase = 'rampDown';
      this.phaseLeft = this.rampSeconds;
    } else {
      this.phase = 'dry';
      this.phaseLeft = this.drySpan(); // random dry length, capped at clearMax
    }
  }

  get timeOfDay(): number {
    return this.time;
  }
  // Continuous rain intensity 0..1 (the client renders the sky + drops from this).
  get rainIntensity(): number {
    return this.rain;
  }
}

function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
