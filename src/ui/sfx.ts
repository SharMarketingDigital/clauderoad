// Procedural sound effects (WebAudio) — PRESENTATION ONLY. Synthesizes every combat/UI sound in code
// (oscillators + noise bursts), so there are ZERO audio asset files and zero licensing to manage. It
// reads nothing from the sim; the combat-feedback loop calls these methods off the same SimEvent stream
// that drives the damage numbers, so offline and online sound identical.
//
// Autoplay: browsers block audio until a user gesture, so the AudioContext is created lazily in unlock()
// (called from the class-select click in main.ts). Before that, every play method is a safe no-op.
// Math.random here is COSMETIC (a touch of variation per hit) — never the sim's Rng; this file is UI.
//
// State (volume, mute) persists in localStorage and is driven by the ESC settings menu, mirroring the
// MusicPlayer's public API so the menu code stays symmetric.

const VOL_KEY = 'claroad.sfx.volume';
const MUTE_KEY = 'claroad.sfx.muted';

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v);

function loadNum(key: string, def: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return def;
    const n = Number(v);
    return Number.isFinite(n) ? clamp01(n) : def;
  } catch {
    return def;
  }
}
function loadBool(key: string, def: boolean): boolean {
  try {
    const v = localStorage.getItem(key);
    return v == null ? def : v === '1';
  } catch {
    return def;
  }
}
function save(key: string, v: string): void {
  try {
    localStorage.setItem(key, v);
  } catch {
    /* private mode: settings just don't persist */
  }
}

interface ToneOpts {
  freq: number;
  freqTo?: number; // glide to this frequency over the duration (exponential)
  type?: OscillatorType;
  dur: number;
  gain: number;
  attack?: number;
  delay?: number; // seconds from now to start
}

interface NoiseOpts {
  dur: number;
  gain: number;
  freq?: number;
  q?: number;
  type?: BiquadFilterType;
  delay?: number;
}

export class Sfx {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private volume: number;
  private muted: boolean;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.volume = loadNum(VOL_KEY, 0.5);
    this.muted = loadBool(MUTE_KEY, false);
  }

  // --- public API (the ESC settings menu drives these; mirrors MusicPlayer) ---
  getVolume(): number {
    return this.volume;
  }
  setVolume(v: number): void {
    this.volume = clamp01(v);
    save(VOL_KEY, String(this.volume));
    if (this.master && this.ctx) this.master.gain.value = this.muted ? 0 : this.volume;
    this.unlock(); // touching a control is itself a gesture
    this.notify();
  }
  isMuted(): boolean {
    return this.muted;
  }
  setMuted(b: boolean): void {
    this.muted = b;
    save(MUTE_KEY, b ? '1' : '0');
    if (this.master) this.master.gain.value = b ? 0 : this.volume;
    this.notify();
  }
  toggleMute(): void {
    this.setMuted(!this.muted);
  }
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // Create/resume the AudioContext (browsers require a user gesture). Safe to call repeatedly.
  unlock(): void {
    if (!this.ctx) {
      try {
        const Ctor =
          window.AudioContext ??
          (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
        if (!Ctor) return; // no WebAudio: the game is just silent, never breaks
        this.ctx = new Ctor();
        const comp = this.ctx.createDynamicsCompressor(); // tame stacked hits (e.g. a Fúria crit streak)
        this.master = this.ctx.createGain();
        this.master.gain.value = this.muted ? 0 : this.volume;
        this.master.connect(comp).connect(this.ctx.destination);
      } catch {
        this.ctx = null;
        return;
      }
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  private ready(): boolean {
    return this.ctx != null && this.master != null && !this.muted && this.ctx.state === 'running';
  }

  // --- synthesis primitives ---
  private tone(o: ToneOpts): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const osc = ctx.createOscillator();
    osc.type = o.type ?? 'sine';
    osc.frequency.setValueAtTime(o.freq, t0);
    if (o.freqTo != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, o.freqTo), t0 + o.dur);
    const g = ctx.createGain();
    const a = o.attack ?? 0.005;
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(o.gain, t0 + a);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    osc.connect(g).connect(this.master!);
    osc.start(t0);
    osc.stop(t0 + o.dur + 0.02);
  }

  private noise(o: NoiseOpts): void {
    const ctx = this.ctx!;
    const t0 = ctx.currentTime + (o.delay ?? 0);
    const n = Math.max(1, Math.floor(ctx.sampleRate * o.dur));
    const buf = ctx.createBuffer(1, n, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < n; i++) data[i] = Math.random() * 2 - 1; // cosmetic noise, not the sim Rng
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const filt = ctx.createBiquadFilter();
    filt.type = o.type ?? 'bandpass';
    filt.frequency.value = o.freq ?? 800;
    filt.Q.value = o.q ?? 1;
    const g = ctx.createGain();
    g.gain.setValueAtTime(o.gain, t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + o.dur);
    src.connect(filt).connect(g).connect(this.master!);
    src.start(t0);
    src.stop(t0 + o.dur + 0.02);
  }

  // --- event sounds (called from combat_feedback) ---
  hit(): void {
    if (!this.ready()) return;
    this.noise({ dur: 0.07, gain: 0.4, freq: 520, q: 0.8, type: 'lowpass' }); // thwack
    this.tone({ freq: 165, freqTo: 95, type: 'square', dur: 0.08, gain: 0.18 }); // body
  }
  crit(): void {
    if (!this.ready()) return;
    this.noise({ dur: 0.06, gain: 0.45, freq: 1200, q: 0.9, type: 'bandpass' }); // sharper
    this.tone({ freq: 180, freqTo: 90, type: 'square', dur: 0.1, gain: 0.2 });
    this.tone({ freq: 880, freqTo: 1500, type: 'triangle', dur: 0.13, gain: 0.22, delay: 0.01 }); // ping
  }
  hurt(): void {
    if (!this.ready()) return;
    this.tone({ freq: 130, freqTo: 70, type: 'sine', dur: 0.16, gain: 0.3 }); // dull thud
    this.noise({ dur: 0.06, gain: 0.25, freq: 320, q: 0.6, type: 'lowpass' });
  }
  death(): void {
    if (!this.ready()) return;
    this.tone({ freq: 320, freqTo: 60, type: 'sawtooth', dur: 0.5, gain: 0.28 }); // downward sweep
  }
  levelUp(): void {
    if (!this.ready()) return;
    const notes = [523, 659, 784, 1047]; // C5 E5 G5 C6 arpeggio
    notes.forEach((f, i) => this.tone({ freq: f, type: 'triangle', dur: 0.22, gain: 0.26, delay: i * 0.08 }));
  }
  heal(): void {
    if (!this.ready()) return;
    this.tone({ freq: 660, type: 'sine', dur: 0.22, gain: 0.22 });
    this.tone({ freq: 990, type: 'sine', dur: 0.26, gain: 0.16, delay: 0.04 }); // soft bell
  }
  enhanceSuccess(): void {
    if (!this.ready()) return;
    this.tone({ freq: 700, type: 'triangle', dur: 0.16, gain: 0.24 });
    this.tone({ freq: 1050, type: 'triangle', dur: 0.2, gain: 0.22, delay: 0.09 }); // bright up-chime
  }
  enhanceFail(): void {
    if (!this.ready()) return;
    this.tone({ freq: 300, freqTo: 150, type: 'sawtooth', dur: 0.22, gain: 0.22 }); // descending buzz
  }
  enhanceBreak(): void {
    if (!this.ready()) return;
    this.noise({ dur: 0.25, gain: 0.4, freq: 700, q: 0.4, type: 'lowpass' }); // crash
    this.tone({ freq: 140, freqTo: 50, type: 'square', dur: 0.3, gain: 0.26 }); // boom
  }
  boss(): void {
    if (!this.ready()) return;
    this.tone({ freq: 90, type: 'sawtooth', dur: 0.7, gain: 0.3 }); // low horn
    this.tone({ freq: 136, type: 'sawtooth', dur: 0.7, gain: 0.18, delay: 0.02 });
  }
  pkKill(): void {
    if (!this.ready()) return;
    this.tone({ freq: 1200, freqTo: 300, type: 'square', dur: 0.18, gain: 0.24 }); // sharp sting
    this.noise({ dur: 0.1, gain: 0.3, freq: 1500, q: 1.2, type: 'bandpass' });
  }
}
