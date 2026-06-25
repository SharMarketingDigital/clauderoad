// ESC settings menu (GDD v0.4 §1.4). A dimmed backdrop + a centered panel; ESC or a click on the
// backdrop closes it. It opens on ESC ONLY when no other overlay is up (it checks the shared overlay
// registry in the CAPTURE phase, before the other windows' Esc-closers run — so it never double-acts
// with the inventory/map/matching Esc). Pure UI: it drives the existing MusicPlayer through its public
// API (no duplicated audio logic) and stays in sync with the corner widget via MusicPlayer.onChange.
//
// Built to grow: the panel is a stack of sections — today only "Áudio"; future settings (vídeo,
// jogabilidade…) drop in as more sections without touching the ESC plumbing.
import type { MusicPlayer } from './audio';
import { registerOverlay, anyOverlayOpen } from './overlays';
import { isTyping } from './typing';

export class SettingsMenu {
  private readonly root: HTMLDivElement;
  private open = false;
  private refresh: () => void = () => {};

  constructor(private readonly music: MusicPlayer) {
    injectStyle();
    this.root = this.build();
    document.body.appendChild(this.root);

    // Take part in ESC priority so any future ESC-window respects an open settings menu too.
    registerOverlay(() => this.open);

    // Capture phase: this runs BEFORE the bubble-phase Esc handlers of the other windows, so when we
    // decide whether to open, anyOverlayOpen() still reflects the state *before* anything closed.
    window.addEventListener(
      'keydown',
      (e) => {
        if (e.repeat) return;
        // Close on Esc OR Backspace while open (works even if a control inside has focus).
        if (this.open && (e.key === 'Escape' || e.key === 'Backspace')) {
          this.setOpen(false);
          e.stopImmediatePropagation(); // also stops the Esc menu's capture handler -> it won't re-open on this Esc
          e.preventDefault();
          return;
        }
        // Settings now OPENS on Backspace — the central Esc menu (tecla Esc) lists it under
        // "Configurações" and owns Esc. Open only when no other window is up.
        if (e.key !== 'Backspace') return;
        if (isTyping()) return; // typing in chat: let the input's own Backspace edit text
        if (anyOverlayOpen()) return; // another window is up — open it from the Esc menu instead
        this.setOpen(true);
        e.stopPropagation();
        e.preventDefault();
      },
      { capture: true },
    );

    // Click on the backdrop (but not the panel) closes the menu.
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.setOpen(false);
    });

    // Stay live while open if the corner widget changes anything.
    this.music.onChange(() => {
      if (this.open) this.refresh();
    });
  }

  private setOpen(open: boolean): void {
    this.open = open;
    this.root.style.display = open ? 'grid' : 'none';
    if (open) this.refresh();
    else (document.activeElement as HTMLElement | null)?.blur(); // drop focus off the slider/buttons
  }

  private build(): HTMLDivElement {
    const root = el('set');
    const panel = el('set-panel');

    panel.append(
      span('set-title', 'Configurações'),
      span('set-hint', 'Backspace/ESC ou clique fora para fechar'),
    );

    // --- Áudio section ---
    const audio = el('set-section');
    audio.append(span('set-section-title', 'Áudio'));

    // Música On/Off (stops/resumes playback; persists)
    const onOffBtn = button('set-btn');
    onOffBtn.onclick = () => this.music.setEnabled(!this.music.isEnabled());
    audio.append(row('Música', onOffBtn));

    // Volume slider
    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = '0';
    slider.max = '100';
    slider.className = 'set-slider';
    slider.oninput = () => this.music.setVolume(Number(slider.value) / 100);
    const volRow = row('Volume', slider);
    volRow.classList.add('set-row-dim'); // dimmed when music is Off
    audio.append(volRow);

    // Mute (silence but keep the loops running; persists)
    const muteBtn = button('set-btn');
    muteBtn.onclick = () => this.music.toggleMute();
    const muteRow = row('Mudo', muteBtn);
    muteRow.classList.add('set-row-dim');
    audio.append(muteRow);

    panel.append(audio);
    root.append(panel);

    // Pull current MusicPlayer state into the controls.
    this.refresh = (): void => {
      const enabled = this.music.isEnabled();
      onOffBtn.textContent = enabled ? 'Ligada' : 'Desligada';
      onOffBtn.classList.toggle('on', enabled);
      slider.value = String(Math.round(this.music.getVolume() * 100));
      muteBtn.textContent = this.music.isMuted() ? 'Ativado' : 'Desativado';
      muteBtn.classList.toggle('on', this.music.isMuted());
      // When music is Off, volume/mute don't do anything — dim them to make that clear.
      audio.classList.toggle('disabled', !enabled);
    };

    root.style.display = 'none';
    return root;
  }
}

// --- tiny DOM helpers (textContent only, never innerHTML) ---
function el(className: string): HTMLDivElement {
  const d = document.createElement('div');
  d.className = className;
  return d;
}
function span(className: string, text: string): HTMLSpanElement {
  const s = document.createElement('span');
  s.className = className;
  s.textContent = text;
  return s;
}
function button(className: string): HTMLButtonElement {
  const b = document.createElement('button');
  b.type = 'button';
  b.className = className;
  return b;
}
// A labelled control row: "<label> .......... [control]".
function row(label: string, control: HTMLElement): HTMLDivElement {
  const r = el('set-row');
  r.append(span('set-label', label), control);
  return r;
}

function injectStyle(): void {
  if (document.getElementById('set-style')) return;
  const s = document.createElement('style');
  s.id = 'set-style';
  s.textContent = `
    .set { position: fixed; inset: 0; z-index: 80; display: none; place-items: center;
      background: rgba(6,9,14,0.78); backdrop-filter: blur(3px); font-family: system-ui, sans-serif; }
    .set-panel { display: flex; flex-direction: column; gap: 6px; min-width: min(420px, 92vw);
      padding: 22px 24px; background: rgba(14,19,28,0.98); border: 1px solid rgba(120,160,220,0.5);
      border-radius: 14px; box-shadow: 0 14px 50px rgba(0,0,0,0.6); }
    .set-title { font: 800 21px/1.1 system-ui, sans-serif; color: #ffd24a; }
    .set-hint { font: 500 12px/1.3 system-ui, sans-serif; color: #8aa0bd; margin-bottom: 10px; }
    .set-section { display: flex; flex-direction: column; gap: 8px; padding: 12px 14px;
      background: rgba(22,29,40,0.9); border: 1px solid rgba(120,160,220,0.25); border-radius: 10px; }
    .set-section.disabled .set-row-dim { opacity: 0.4; pointer-events: none; }
    .set-section-title { font: 800 13px/1 system-ui, sans-serif; color: #9fb2cc; letter-spacing: .04em;
      text-transform: uppercase; margin-bottom: 2px; }
    .set-row { display: flex; align-items: center; justify-content: space-between; gap: 14px; }
    .set-label { font: 600 14px/1.2 system-ui, sans-serif; color: #eaf1ff; }
    .set-slider { width: 200px; cursor: pointer; accent-color: #ffd24a; }
    .set-btn { min-width: 104px; padding: 6px 12px; cursor: pointer; font: 700 13px/1 system-ui, sans-serif;
      color: #eaf1ff; background: rgba(34,44,60,0.95); border: 1px solid rgba(120,160,220,0.35);
      border-radius: 8px; transition: border-color 0.1s, background 0.1s; }
    .set-btn:hover { border-color: #ffd24a; }
    .set-btn.on { border-color: #ffd24a; color: #ffd24a; }
  `;
  document.head.appendChild(s);
}
