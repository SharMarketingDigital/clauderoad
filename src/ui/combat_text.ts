// Floating combat text: the damage number that pops above a target and rises
// while fading. DOM overlay (no framework), positioned in SCREEN pixels by the
// caller (the renderer projects the world point). Presentation only — it reads
// nothing from the world and never touches the sim.
//
// Each number is a short-lived <div> animated entirely by CSS; it removes
// itself on animationend, so there is no per-frame work here.
export class CombatText {
  private root: HTMLDivElement;

  constructor() {
    this.root = document.createElement('div');
    this.root.className = 'fct-layer';
    document.body.appendChild(this.root);
  }

  // Pop a number at the given screen position (pixels from the top-left).
  spawn(screenX: number, screenY: number, amount: number): void {
    const el = document.createElement('div');
    el.className = 'fct';
    el.textContent = String(Math.round(amount));
    el.style.left = `${screenX}px`;
    el.style.top = `${screenY}px`;
    const remove = (): void => el.remove();
    el.addEventListener('animationend', remove);
    // Safety net: if CSS animations are suppressed (e.g. an external stylesheet
    // forces `animation: none`), animationend never fires — drop it anyway so
    // nodes can't pile up. (Calling remove twice is harmless.)
    window.setTimeout(remove, 1500); // comfortably past the 0.85s animation
    this.root.appendChild(el);
  }
}
