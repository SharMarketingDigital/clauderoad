// Background music (GDD v0.4 §1.4) — PRESENTATION ONLY. Reads IWorld to pick a context and NEVER
// touches the sim, so it carries zero determinism risk. Three looping tracks crossfade by context:
// the city theme in the safe-zone, a combat theme when a hostile enemy is near, exploration else.
//
// State (volume, mute, on/off) lives HERE as the single source of truth and persists in localStorage.
// Two UIs drive it through the public API without duplicating logic: the small corner widget (built
// here) and the ESC settings menu (settings_menu.ts). onChange() keeps them in sync — change volume in
// one and the other's control follows. `muted` = silence but keep the loops running; `enabled` = false
// (the menu's Música On/Off) actually pauses playback.
//
// Autoplay: browsers block audio until a user gesture, so nothing plays until unlock() — called from
// the class-select click (main.ts) and, as a fallback, the first pointer/key interaction. Any control
// interaction is itself a gesture, so the widget/menu also "wake" playback.
import type { IWorld } from '../world_api';
import { zoneAt } from '../sim/zones';

type Ctx = 'explore' | 'city' | 'combat';
const CTXS: readonly Ctx[] = ['explore', 'city', 'combat'];

// Curated CC0/CC-BY tracks in public/audio/ (attribution: public/audio/CREDITS.md).
const TRACKS: Record<Ctx, string> = {
  explore: '/audio/the_field_of_dreams.mp3',
  city: '/audio/TownTheme.mp3',
  combat: '/audio/battleThemeA.mp3',
};

const FADE_SECS = 0.8; // crossfade time between contexts
const COMBAT_RADIUS = 22; // a hostile enemy within this (world units) of the player = "in combat"
const COMBAT_HOLD = 3.0; // stay on combat music this long after the last hostile leaves (hysteresis)
const VOL_KEY = 'claroad.music.volume';
const MUTE_KEY = 'claroad.music.muted';
const ENABLED_KEY = 'claroad.music.enabled';

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
    /* private mode / disabled storage: settings just don't persist */
  }
}

function makeAudio(src: string): HTMLAudioElement {
  const a = new Audio(src);
  a.loop = true;
  a.preload = 'auto';
  a.volume = 0;
  return a;
}

export class MusicPlayer {
  private readonly els: Record<Ctx, HTMLAudioElement>;
  private readonly fade: Record<Ctx, number> = { explore: 0, city: 0, combat: 0 };
  private active: Ctx = 'explore';
  private master: number;
  private muted: boolean;
  private enabled: boolean;
  private gestured = false; // a user gesture has happened, so play() is allowed
  private nowS = 0; // accumulated host seconds (drives the hysteresis window)
  private combatSeenAt = -Infinity;
  private readonly listeners = new Set<() => void>();

  constructor() {
    this.master = loadNum(VOL_KEY, 0.6);
    this.muted = loadBool(MUTE_KEY, false);
    this.enabled = loadBool(ENABLED_KEY, true);
    this.els = {
      explore: makeAudio(TRACKS.explore),
      city: makeAudio(TRACKS.city),
      combat: makeAudio(TRACKS.combat),
    };
    this.buildControls();
    // Fallback unlock: the first interaction anywhere (the class-select click usually beats it).
    const onceUnlock = (): void => this.unlock();
    window.addEventListener('pointerdown', onceUnlock, { once: true });
    window.addEventListener('keydown', onceUnlock, { once: true });
  }

  // --- public API: the corner widget AND the ESC settings menu drive these (no duplicated logic) ---
  getVolume(): number {
    return this.master;
  }
  setVolume(v: number): void {
    this.master = clamp01(v);
    save(VOL_KEY, String(this.master));
    this.gestured = true;
    this.applyPlayback();
    this.notify();
  }
  isMuted(): boolean {
    return this.muted;
  }
  setMuted(b: boolean): void {
    this.muted = b;
    save(MUTE_KEY, b ? '1' : '0');
    this.gestured = true;
    this.applyPlayback();
    this.notify();
  }
  toggleMute(): void {
    this.setMuted(!this.muted);
  }
  isEnabled(): boolean {
    return this.enabled;
  }
  setEnabled(b: boolean): void {
    this.enabled = b;
    save(ENABLED_KEY, b ? '1' : '0');
    this.gestured = true;
    this.applyPlayback(); // stops playback when off, resumes when back on
    this.notify();
  }
  // Subscribe to state changes (volume/mute/on-off). Returns an unsubscribe fn.
  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => {
      this.listeners.delete(cb);
    };
  }

  // Start playback (browsers require a user gesture). Safe to call repeatedly.
  unlock(): void {
    this.gestured = true;
    this.applyPlayback();
  }

  // Per-frame: pick the context from the world and crossfade the three tracks toward it.
  update(world: IWorld, dt: number): void {
    this.nowS += dt;
    const desired = this.contextOf(world);
    if (desired) this.active = desired;
    const step = FADE_SECS > 0 ? Math.min(1, dt / FADE_SECS) : 1;
    const audible = this.enabled && !this.muted;
    for (const c of CTXS) {
      const target = c === this.active ? 1 : 0;
      this.fade[c] += (target - this.fade[c]) * step;
      this.els[c].volume = audible ? clamp01(this.fade[c] * this.master) : 0;
    }
  }

  // Play (when enabled + a gesture has happened) or pause all tracks. Mute does NOT pause — it keeps
  // the loops running at volume 0 (see update); only the On/Off switch (`enabled`) stops playback.
  private applyPlayback(): void {
    const shouldPlay = this.enabled && this.gestured;
    for (const c of CTXS) {
      const a = this.els[c];
      if (shouldPlay) {
        if (a.paused) a.play().catch(() => { /* not a gesture yet: a later call retries */ });
      } else if (!a.paused) {
        a.pause();
      }
    }
  }

  private notify(): void {
    for (const cb of this.listeners) cb();
  }

  // City inside the safe-zone, combat when a hostile enemy is near (with hysteresis), else
  // exploration. Null = no local player yet (keep whatever was playing).
  private contextOf(world: IWorld): Ctx | null {
    const id = world.localPlayerId();
    if (id == null) return null;
    const ents = world.entities();
    const p = ents.find((e) => e.id === id);
    if (!p) return null;
    let combatNow = false;
    for (const e of ents) {
      if (e.kind === 'enemy' && e.hostile) {
        const dx = e.x - p.x;
        const dz = e.z - p.z;
        if (dx * dx + dz * dz < COMBAT_RADIUS * COMBAT_RADIUS) {
          combatNow = true;
          break;
        }
      }
    }
    if (combatNow) this.combatSeenAt = this.nowS;
    if (this.nowS - this.combatSeenAt < COMBAT_HOLD) return 'combat';
    return zoneAt(p.x, p.z).safe ? 'city' : 'explore';
  }

  // The quick corner shortcut (mute + volume). Full controls live in the ESC settings menu; both drive
  // this same player, and this widget refreshes from onChange so the two never disagree.
  private buildControls(): void {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:fixed;right:12px;bottom:12px;z-index:60;display:flex;gap:8px;align-items:center;' +
      'background:rgba(0,0,0,.45);padding:6px 9px;border-radius:9px;font:13px system-ui,sans-serif;' +
      'color:#fff;user-select:none;pointer-events:auto';

    const btn = document.createElement('button');
    btn.title = 'Mudo (liga/desliga)';
    btn.style.cssText = 'background:none;border:none;color:inherit;cursor:pointer;font-size:16px;line-height:1;padding:0';
    btn.onclick = () => this.toggleMute();

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.title = 'Volume da música';
    slider.style.cssText = 'width:90px;cursor:pointer';
    slider.oninput = () => this.setVolume(Number(slider.value) / 100);

    const refresh = (): void => {
      btn.textContent = this.muted ? '🔇' : '🔊';
      slider.value = String(Math.round(this.master * 100));
    };
    this.onChange(refresh);
    refresh();

    wrap.append(btn, slider);
    document.body.appendChild(wrap);
  }
}
