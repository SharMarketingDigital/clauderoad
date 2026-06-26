// Visual theme layer for the HUD — the approved "stone" medieval skin (see mockups/ui-kit.html).
// Pure PRESENTATION, render/host-side only: it sets CSS custom properties + a flag attribute and
// injects decorative frame overlays. It is NEVER imported by src/sim (the guardian test enforces
// that). No Math.random / Date.now / performance.now: the procedural textures use FIXED feTurbulence
// seeds, so the look is byte-identical on every load (and there is no per-load visual churn).
//
// Activation model (the medieval skin is THE skin — a complete swap, no rollback):
//   • installTheme() sets `--tex-*` / `--m-*` vars + `data-style` (global palette) + `data-ui="stone"`
//     on <html>. The themed CSS lives under `[data-ui="stone"]`, which is now always present.
//   • Per-panel override: any element can carry its own `data-style` (e.g. the shop = "gold").
//   • decoratePanel(el) opts a modal/panel into the ornate frame (corners + edges). Always-on HUD
//     bits are skinned by CSS alone (no per-frame DOM/compositor cost).

export type ThemeStyle = 'basic' | 'gold' | 'premium';

const svgURI = (svg: string): string => `url("data:image/svg+xml,${encodeURIComponent(svg)}")`;

// --- Procedural textures (grayscale, recolored by blend over each palette) — fixed seeds. --------
const STONE = `
<svg xmlns='http://www.w3.org/2000/svg' width='260' height='260'>
  <filter id='s'><feTurbulence type='fractalNoise' baseFrequency='0.035' numOctaves='5' seed='7' stitchTiles='stitch' result='n'/>
    <feDiffuseLighting in='n' lighting-color='#ffffff' surfaceScale='1.7' diffuseConstant='1.1'><feDistantLight azimuth='235' elevation='55'/></feDiffuseLighting></filter>
  <rect width='100%' height='100%' filter='url(#s)'/></svg>`;
const CRACKS = `
<svg xmlns='http://www.w3.org/2000/svg' width='340' height='340'>
  <filter id='c'><feTurbulence type='fractalNoise' baseFrequency='0.012 0.016' numOctaves='4' seed='21' result='n'/>
    <feColorMatrix in='n' type='matrix' values='0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 7 -3.05' result='a'/>
    <feComponentTransfer in='a' result='b'><feFuncA type='discrete' tableValues='0 0 1 1 0 0'/></feComponentTransfer>
    <feFlood flood-color='#000000' result='ink'/><feComposite in='ink' in2='b' operator='in' result='veins'/>
    <feGaussianBlur in='veins' stdDeviation='0.35'/></filter>
  <rect width='100%' height='100%' filter='url(#c)'/></svg>`;
const GRAIN = `
<svg xmlns='http://www.w3.org/2000/svg' width='150' height='150'>
  <filter id='g'><feTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='2' stitchTiles='stitch'/></filter>
  <rect width='100%' height='100%' filter='url(#g)' opacity='0.25'/></svg>`;

// --- Corner masks (white-on-transparent; the gradient shows through). A = heráldico (basic/gold),
//     C = selo arcano (premium). The other 3 corners are CSS mirrors of the top-left. --------------
const CORNER_A = `
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' fill='none' stroke='#fff' stroke-width='2.4' stroke-linecap='round' stroke-linejoin='round'>
  <path d='M50 9 L22 9 Q9 9 9 22 L9 50'/><path d='M50 16 L27 16 Q16 16 16 27 L16 50' stroke-width='1.6' opacity='0.82'/>
  <circle cx='20.5' cy='20.5' r='5.6'/><circle cx='20.5' cy='20.5' r='1.9' fill='#fff' stroke='none'/>
  <path d='M50 9 l4.5 -3 M9 50 l-3 4.5' stroke-width='1.7'/></svg>`;
const CORNER_C = `
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 64 64' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>
  <circle cx='19' cy='19' r='10'/><circle cx='19' cy='19' r='13.6' stroke-width='1.2' stroke-dasharray='1.6 3.4' opacity='0.6'/>
  <path d='M19 11.5 V26.5 M12.2 15.25 L25.8 22.75 M25.8 15.25 L12.2 22.75' stroke-width='1.5'/>
  <path d='M10 10 L4 4 M4 4 L7 4 M4 4 L4 7' stroke-width='1.6'/></svg>`;

// Running-knot edge tile; the vertical version is the same tile rotated 90°.
const EDGE_H = `
<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 56 14' fill='none' stroke='#fff' stroke-width='2' stroke-linecap='round'>
  <path d='M0 7 C9 1 19 1 28 7 C37 13 47 13 56 7' opacity='0.95'/>
  <path d='M0 7 C9 13 19 13 28 7 C37 1 47 1 56 7' stroke-width='1.5' opacity='0.7'/>
  <circle cx='28' cy='7' r='1.6' fill='#fff' stroke='none'/></svg>`;
const EDGE_V = EDGE_H
  .replace("viewBox='0 0 56 14'", "viewBox='0 0 14 56'")
  .replace(/<path /g, "<path transform='rotate(90 7 7)' ")
  .replace(/<circle /g, "<circle transform='rotate(90 7 7)' ");

let installed = false;

/** Is the medieval skin active? (false in `?ui=legacy` or before installTheme runs.) */
export function isThemed(): boolean {
  return document.documentElement.dataset.ui === 'stone';
}

/**
 * Switch the whole UI to the stone skin: register the texture/mask data-URIs, set the global
 * palette, and turn the skin on. Call ONCE, synchronously, before any HUD/screen is built (top
 * of main.ts) so the first screen is already themed and there is no flash. This is a complete,
 * permanent swap — there is no rollback.
 */
export function installTheme(globalStyle: ThemeStyle = 'basic'): void {
  if (installed) return;
  installed = true;

  const root = document.documentElement;
  const set = (k: string, v: string): void => root.style.setProperty(k, v);
  set('--tex-stone', svgURI(STONE));
  set('--tex-cracks', svgURI(CRACKS));
  set('--tex-grain', svgURI(GRAIN));
  set('--m-corner-a', svgURI(CORNER_A));
  set('--m-corner-c', svgURI(CORNER_C));
  set('--m-edge', svgURI(EDGE_H));
  set('--m-edge-v', svgURI(EDGE_V));
  root.dataset.style = globalStyle; // global palette (cascades to every panel via CSS vars)
  root.dataset.ui = 'stone'; // activates the themed `[data-ui="stone"]` CSS (always on now)
}

const FRAME_HTML =
  `<span class="rpg-edge top"></span><span class="rpg-edge bottom"></span>` +
  `<span class="rpg-edge left"></span><span class="rpg-edge right"></span>` +
  `<span class="rpg-corner tl"></span><span class="rpg-corner tr"></span>` +
  `<span class="rpg-corner bl"></span><span class="rpg-corner br"></span>`;
// The kit's exact chrome (mockups/ui-kit.html): a texture-bg layer, a vignette layer, and the
// corner/edge filigree. Injected at the FRONT so it sits at negative z-index — BEHIND the panel's
// existing content (no content wrapper needed), yet above the panel's own border background.
const CHROME_HTML = `<div class="rpg-panel__bg"></div><div class="rpg-panel__vignette"></div>`;

/**
 * Opt a panel into the ornate stone frame — texture + vignette + corner/edge filigree. Panels are
 * NOT modular: every one gets the SAME frame; only the palette (data-style) varies. Idempotent.
 */
export function decoratePanel(el: HTMLElement, opts: { style?: ThemeStyle } = {}): void {
  if (el.classList.contains('rpg-panel')) return;
  el.classList.add('rpg-panel');
  if (opts.style) el.dataset.style = opts.style;
  el.insertAdjacentHTML('afterbegin', `${CHROME_HTML}<div class="rpg-frame">${FRAME_HTML}</div>`);
}
