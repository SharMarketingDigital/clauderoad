// In-game video recording — presentation/UI only, never touches the sim.
//
// Two widgets sit together in a small corner dock:
//   • Recorder    — manual ● REC with a "HUD: off/on" mode toggle:
//                     off  -> canvas.captureStream() (clean 3D, no HUD, no picker)
//                     on   -> getDisplayMedia() (whole tab the user picks, with HUD)
//   • ClipRecorder — one-click 🎬 Clipe: auto-records a fixed CLIP_SECONDS scene in
//                     BOTH ways at once (clean + with-HUD) for a "Dia 1, Dia 2..."
//                     evolution series. It turns the auto-play bot on, freezes a
//                     consistent golden-hour light + camera, records, then restores.
//
// Encoding runs off the main thread, so start/stop never stall the game loop.

// ---- tunables: manual recorder ----
const FPS = 30; // capture framerate
const BITRATE = 8_000_000; // ~8 Mbps — quality vs. file size
// ---- tunables: commit clip ----
const CLIP_SECONDS = 15; // clip length
const CLIP_TIME = 0.7; // frozen time of day (0..1): ~0.7 = bright golden late-afternoon
const CLIP_FPS = 30; // both clip streams capture at this rate
const CLIP_BITRATE = 6_000_000; // ~6 Mbps EACH — a touch lower since two streams encode at once
const SHOW_COUNTDOWN_OVERLAY = true; // on-screen countdown (also shows in the HUD clip); false -> tab-title only
// ---- shared ----
const MIME_CANDIDATES = ['video/webm;codecs=vp9', 'video/webm;codecs=vp8', 'video/webm'];
// ------------------------------------

type Mode = 'clean' | 'hud';

export class Recorder {
  private readonly recBtn: HTMLButtonElement;
  private readonly modeBtn: HTMLButtonElement;
  private recorder: MediaRecorder | null = null;
  private stream: MediaStream | null = null;
  private chunks: Blob[] = [];
  private hudMode = false; // false = clean (canvas), true = full (getDisplayMedia)
  private mode: Mode = 'clean'; // mode of the CURRENT recording (for the filename)

  constructor(private readonly canvas: HTMLCanvasElement) {
    injectStyle();
    this.modeBtn = document.createElement('button');
    this.modeBtn.className = 'cr-mode-btn';
    this.recBtn = document.createElement('button');
    this.recBtn.className = 'cr-rec-btn';
    this.recBtn.textContent = '● REC';
    getDock().append(this.modeBtn, this.recBtn);
    this.refreshMode();
    this.modeBtn.addEventListener('click', () => this.toggleMode());
    this.recBtn.addEventListener('click', () => this.toggle());
  }

  private get recording(): boolean {
    return this.recorder !== null && this.recorder.state === 'recording';
  }

  private toggleMode(): void {
    if (this.recording) return; // can't switch mid-recording
    this.hudMode = !this.hudMode;
    this.refreshMode();
  }

  private refreshMode(): void {
    this.modeBtn.textContent = this.hudMode ? 'HUD: on' : 'HUD: off';
    this.modeBtn.classList.toggle('on', this.hudMode);
    this.modeBtn.title = this.hudMode
      ? 'Com HUD: grava a aba inteira (o navegador pede pra você escolher a aba)'
      : 'Sem HUD: grava só a cena 3D (canvas, sem popup)';
  }

  private toggle(): void {
    if (this.recording) this.stop();
    else void this.start();
  }

  private async start(): Promise<void> {
    if (this.recording) return;
    if (!('MediaRecorder' in window)) {
      console.warn('[recorder] MediaRecorder not supported');
      return;
    }
    const mime = pickMime();
    if (!mime) {
      console.warn('[recorder] no supported webm codec');
      return;
    }

    const mode: Mode = this.hudMode ? 'hud' : 'clean';
    let stream: MediaStream;
    try {
      if (mode === 'hud') {
        if (!navigator.mediaDevices?.getDisplayMedia) {
          console.warn('[recorder] getDisplayMedia not supported');
          return;
        }
        this.recBtn.textContent = '…'; // feedback while the share picker is open
        stream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: FPS }, audio: false });
      } else {
        if (typeof this.canvas.captureStream !== 'function') {
          console.warn('[recorder] canvas.captureStream not supported');
          return;
        }
        stream = this.canvas.captureStream(FPS);
      }
    } catch {
      this.recBtn.textContent = '● REC'; // user cancelled the picker / capture failed
      return;
    }

    // if the user ends the share from the browser's bar, finish the recording
    for (const track of stream.getVideoTracks()) {
      track.onended = () => { if (this.recording) this.stop(); };
    }

    this.mode = mode;
    this.stream = stream;
    this.chunks = [];
    this.recorder = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: BITRATE });
    this.recorder.ondataavailable = (e) => { if (e.data && e.data.size > 0) this.chunks.push(e.data); };
    this.recorder.onstop = () => this.save();
    this.recorder.start(1000); // flush a chunk each second -> responsive stop
    this.recBtn.classList.add('recording');
    this.recBtn.textContent = '■ STOP';
    this.modeBtn.disabled = true;
  }

  private stop(): void {
    this.recBtn.classList.remove('recording');
    this.recBtn.textContent = '● REC';
    this.modeBtn.disabled = false;
    if (this.recorder && this.recorder.state === 'recording') this.recorder.stop(); // -> onstop -> save
  }

  private save(): void {
    const rec = this.recorder;
    this.recorder = null;
    if (this.stream) {
      for (const t of this.stream.getTracks()) t.stop(); // release the canvas/screen capture
      this.stream = null;
    }
    download(this.chunks, `clauderoad-gameplay-${this.mode}-${stamp()}.webm`, rec ? rec.mimeType : 'video/webm');
    this.chunks = [];
  }
}

// Hooks the ClipRecorder needs, kept tiny so it never imports Sim/Renderer directly
// (main.ts wires these as closures over the real world + renderer).
export interface ClipHooks {
  isBotOn(): boolean;
  setBot(on: boolean): void;
  getTarget(): number | null;
  setTarget(id: number | null): void;
  setClipTime(t: number | null): void; // null = resume the running day/night cycle
  setClipCamera(on: boolean): void;
}

interface Track {
  rec: MediaRecorder;
  chunks: Blob[];
  stream: MediaStream;
}

export class ClipRecorder {
  private readonly button: HTMLButtonElement;
  private readonly originalTitle = document.title;
  private active = false;
  private clean: Track | null = null;
  private hud: Track | null = null;
  private indicator: HTMLDivElement | null = null;
  private countdownTimer = 0;
  private botWasOn = false;
  private targetWas: number | null = null;

  constructor(private readonly canvas: HTMLCanvasElement, private readonly hooks: ClipHooks) {
    injectStyle();
    this.button = document.createElement('button');
    this.button.className = 'cr-clip-btn';
    this.button.textContent = '🎬 Clipe';
    this.button.title = `Grava ${CLIP_SECONDS}s automáticos em 2 arquivos (sem HUD + com HUD) pra série de evolução`;
    getDock().appendChild(this.button);
    this.button.addEventListener('click', () => void this.startClip());
  }

  private async startClip(): Promise<void> {
    if (this.active) return;
    const mime = pickMime();
    if (!('MediaRecorder' in window) || !mime || typeof this.canvas.captureStream !== 'function' || !navigator.mediaDevices?.getDisplayMedia) {
      console.warn('[clip] recording not supported in this browser');
      return;
    }

    this.active = true;
    this.button.disabled = true;
    this.button.textContent = '⏳ aba…';

    // 1) Ask for the tab FIRST (must be in the click gesture). Cancelling here
    //    changes nothing about the game — the scene is only set up after grant.
    let displayStream: MediaStream;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({ video: { frameRate: CLIP_FPS }, audio: false });
    } catch {
      this.resetButton();
      this.active = false;
      return;
    }

    // 2) Granted -> snapshot the pre-clip state, then set the consistent scene:
    //    bot on, fixed golden light, fixed camera. (Snapshot BEFORE sending — the
    //    bot toggle only applies on the next sim tick, so a read-back would be stale.)
    this.botWasOn = this.hooks.isBotOn();
    this.targetWas = this.hooks.getTarget();
    this.hooks.setBot(true);
    this.hooks.setClipTime(CLIP_TIME);
    this.hooks.setClipCamera(true);

    // The scene is now changed, so ANY early end of the tab-share must finish +
    // restore. Attach the handler BEFORE the setup frame so that window is covered too.
    const id = stamp(); // one timestamp for both files so the series sorts together
    for (const tr of displayStream.getVideoTracks()) tr.onended = () => this.finishClip(id);

    // 3) Hide the recorder dock + let one frame render the clip scene, so the
    //    with-HUD capture opens clean (only the game's own HUD shows, not our buttons).
    getDock().style.visibility = 'hidden';
    await nextFrame();
    if (!this.active) return; // share stopped during the setup frame -> already restored

    // 4) Start BOTH recorders at the same instant -> the two files cover the same ~15s.
    const cleanStream = this.canvas.captureStream(CLIP_FPS);
    this.clean = makeTrack(cleanStream, mime);
    this.hud = makeTrack(displayStream, mime);
    this.clean.rec.start();
    this.hud.rec.start();

    // 5) Countdown + auto-stop at CLIP_SECONDS.
    let remaining = CLIP_SECONDS;
    this.renderCountdown(remaining);
    this.countdownTimer = window.setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) this.finishClip(id);
      else this.renderCountdown(remaining);
    }, 1000);
  }

  private finishClip(id: string): void {
    if (!this.active) return;
    this.active = false; // clear the "recording" flag first, so a future clip can always start
    if (this.countdownTimer) { clearInterval(this.countdownTimer); this.countdownTimer = 0; }

    try {
      // Recorder teardown is fallible browser I/O (MediaRecorder.stop + blob download,
      // and the HUD stream may be ending). Keep it OFF the restore path: a failure here
      // must NEVER skip the game restore below (or the camera/time/bot stay stuck).
      stopTrack(this.clean, `clauderoad-${id}-clean.webm`);
      stopTrack(this.hud, `clauderoad-${id}-hud.webm`);
    } finally {
      this.clean = null;
      this.hud = null;
      this.restoreGame(); // ALWAYS undo every clip-only override
    }
  }

  // Undo EVERY clip-only override. Each step is isolated so one failing hook can't
  // leave the rest "stuck": camera locked at the cinematic angle, day/night frozen,
  // the bot still driving (which makes input.ts swallow WASD), dock hidden, or button
  // dead-disabled. The "recording" flag (this.active) was already cleared by the caller.
  private restoreGame(): void {
    safely(() => this.hooks.setClipCamera(false)); // player camera: angle + distance back
    safely(() => this.hooks.setClipTime(null)); // day/night cycle resumes from where it paused
    safely(() => this.hooks.setBot(this.botWasOn)); // bot back to its pre-clip state...
    safely(() => this.hooks.setTarget(this.targetWas)); // ...then re-select the pre-clip target (bot-off cleared it)
    safely(() => { getDock().style.visibility = ''; });
    safely(() => this.clearCountdown());
    this.resetButton();
  }

  private renderCountdown(secs: number): void {
    this.button.textContent = `● ${secs}s`;
    document.title = `🔴 Clipe ${secs}s — Clauderoad`;
    if (!SHOW_COUNTDOWN_OVERLAY) return;
    if (!this.indicator) {
      this.indicator = document.createElement('div');
      this.indicator.className = 'cr-clip-ind';
      document.body.appendChild(this.indicator);
    }
    this.indicator.textContent = `🔴 Gravando clipe — ${secs}s`;
  }

  private clearCountdown(): void {
    if (this.indicator) { this.indicator.remove(); this.indicator = null; }
    document.title = this.originalTitle;
  }

  private resetButton(): void {
    this.button.disabled = false;
    this.button.textContent = '🎬 Clipe';
  }
}

// ---- shared helpers ----

function pickMime(): string | undefined {
  return MIME_CANDIDATES.find((m) => MediaRecorder.isTypeSupported(m));
}

// Run a restore step so a throw in it can't block the remaining restore steps.
function safely(fn: () => void): void {
  try {
    fn();
  } catch (e) {
    console.error('[clip] restore step failed', e);
  }
}

function makeTrack(stream: MediaStream, mime: string): Track {
  const chunks: Blob[] = [];
  const rec = new MediaRecorder(stream, { mimeType: mime, videoBitsPerSecond: CLIP_BITRATE });
  rec.ondataavailable = (e) => { if (e.data && e.data.size > 0) chunks.push(e.data); };
  return { rec, chunks, stream };
}

function stopTrack(t: Track | null, filename: string): void {
  if (!t) return;
  const release = (): void => {
    download(t.chunks, filename, t.rec.mimeType || 'video/webm');
    for (const tr of t.stream.getTracks()) tr.stop(); // release the canvas/screen capture
  };
  if (t.rec.state === 'recording') {
    t.rec.onstop = release; // wait for the final flushed chunk
    t.rec.stop();
  } else {
    release();
  }
}

function download(chunks: Blob[], filename: string, type: string): void {
  if (chunks.length === 0) {
    console.warn('[recorder] no video data captured for', filename); // e.g. a stream that ended instantly
    return;
  }
  const blob = new Blob(chunks, { type });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// YYYYMMDD-HHMMSS (host clock — fine in UI, never in src/sim)
function stamp(): string {
  const d = new Date();
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// One shared corner dock so [HUD toggle][● REC][🎬 Clipe] sit together.
function getDock(): HTMLElement {
  let dock = document.getElementById('cr-rec-dock');
  if (!dock) {
    dock = document.createElement('div');
    dock.id = 'cr-rec-dock';
    document.body.appendChild(dock);
  }
  return dock;
}

function injectStyle(): void {
  if (document.getElementById('cr-rec-style')) return;
  const s = document.createElement('style');
  s.id = 'cr-rec-style';
  s.textContent = `
    #cr-rec-dock { position: fixed; bottom: 14px; right: 14px; z-index: 60; display: flex; gap: 8px; align-items: center; }
    .cr-mode-btn, .cr-rec-btn, .cr-clip-btn { padding: 6px 12px; font: 600 12px/1 system-ui, sans-serif; letter-spacing: 0.5px;
      color: #e8eef6; background: rgba(20,26,36,0.78); border: 1px solid rgba(200,168,90,0.5); border-radius: 6px;
      cursor: pointer; pointer-events: auto; user-select: none; }
    .cr-mode-btn:hover, .cr-rec-btn:hover, .cr-clip-btn:hover { background: rgba(34,44,60,0.92); }
    .cr-mode-btn.on { color: #fff; background: rgba(40,90,150,0.85); border-color: #6aa0e0; }
    .cr-mode-btn:disabled, .cr-clip-btn:disabled { opacity: 0.55; cursor: default; }
    .cr-rec-btn.recording { color: #fff; background: #b32030; border-color: #ff8080;
      animation: cr-pulse 1.1s ease-in-out infinite; }
    .cr-clip-ind { position: fixed; top: 12px; left: 50%; transform: translateX(-50%); z-index: 70;
      padding: 6px 14px; font: 700 14px/1 system-ui, sans-serif; letter-spacing: 0.4px; color: #fff;
      background: rgba(150,20,30,0.88); border: 1px solid #ff7070; border-radius: 8px; pointer-events: none; }
    @keyframes cr-pulse { 0%,100% { box-shadow: 0 0 0 0 rgba(220,48,64,0.7); }
      50% { box-shadow: 0 0 0 7px rgba(220,48,64,0); } }
  `;
  document.head.appendChild(s);
}
