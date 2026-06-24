// Background music (GDD v0.4 §1.4) — PRESENTATION ONLY. Reads IWorld to pick a context
// and NEVER touches the sim, so it carries zero determinism risk (it isn't even a function
// of sim ticks — it's wall-clock crossfades over a cosmetic layer). Three looping tracks
// crossfade by context: the city theme in the safe-zone, a combat theme when a hostile enemy
// is near, exploration everywhere else. Volume + mute persist in localStorage.
//
// Autoplay: browsers block audio until a user gesture, so nothing plays until unlock() — called
// from the class-select click (see main.ts) and, as a fallback, the first pointer/key interaction.
// The volume control itself also unlocks. All three tracks then loop at once and we only mix their
// volumes, so a context switch is an instant, gap-free crossfade.
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

function loadNum(key: string, def: number): number {
  try {
    const v = localStorage.getItem(key);
    if (v == null) return def;
    const n = Number(v);
    return Number.isFinite(n) ? Math.max(0, Math.min(1, n)) : def;
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
  private nowS = 0; // accumulated host seconds (drives the hysteresis window)
  private combatSeenAt = -Infinity;

  constructor() {
    this.master = loadNum(VOL_KEY, 0.6);
    this.muted = loadBool(MUTE_KEY, false);
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

  // Start playback. Browsers require this to run inside a user gesture; safe to call repeatedly
  // (each call just resumes any track that isn't playing yet, so a later gesture retries cleanly).
  unlock(): void {
    for (const c of CTXS) {
      if (this.els[c].paused) this.els[c].play().catch(() => { /* not a gesture yet: a later call retries */ });
    }
  }

  // Per-frame: pick the context from the world and crossfade the three tracks toward it.
  update(world: IWorld, dt: number): void {
    this.nowS += dt;
    const desired = this.contextOf(world);
    if (desired) this.active = desired;
    const step = FADE_SECS > 0 ? Math.min(1, dt / FADE_SECS) : 1;
    for (const c of CTXS) {
      const target = c === this.active ? 1 : 0;
      this.fade[c] += (target - this.fade[c]) * step;
      this.els[c].volume = this.muted ? 0 : Math.max(0, Math.min(1, this.fade[c] * this.master));
    }
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

  // A tiny, unobtrusive control in the bottom-right corner: a mute toggle + a volume slider.
  // Interacting with it also unlocks audio (it's a user gesture).
  private buildControls(): void {
    const wrap = document.createElement('div');
    wrap.style.cssText =
      'position:fixed;right:12px;bottom:12px;z-index:60;display:flex;gap:8px;align-items:center;' +
      'background:rgba(0,0,0,.45);padding:6px 9px;border-radius:9px;font:13px system-ui,sans-serif;' +
      'color:#fff;user-select:none;pointer-events:auto';

    const btn = document.createElement('button');
    btn.textContent = this.muted ? '🔇' : '🔊';
    btn.title = 'Música (liga/desliga)';
    btn.style.cssText = 'background:none;border:none;color:inherit;cursor:pointer;font-size:16px;line-height:1;padding:0';
    btn.onclick = () => {
      this.unlock();
      this.muted = !this.muted;
      save(MUTE_KEY, this.muted ? '1' : '0');
      btn.textContent = this.muted ? '🔇' : '🔊';
    };

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.value = String(Math.round(this.master * 100));
    slider.title = 'Volume da música';
    slider.style.cssText = 'width:90px;cursor:pointer';
    slider.oninput = () => {
      this.unlock();
      this.master = Number(slider.value) / 100;
      save(VOL_KEY, String(this.master));
    };

    wrap.append(btn, slider);
    document.body.appendChild(wrap);
  }
}
