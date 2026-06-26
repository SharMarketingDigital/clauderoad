// SVG ability icons for the action bar — replaces the data-driven emojis with crisp vector glyphs,
// matching the prototype (mockups/ui-kit.html). Render/UI ONLY: the sim still ships an emoji per
// ability (AbilityView.icon, from src/sim/content); this module maps that emoji → an SVG <symbol>
// id, with the emoji kept as a graceful fallback for anything unmapped. Never imported by src/sim.

// One <symbol> per glyph (24×24, stroke = currentColor so it inherits the slot's gold tint).
const SYMBOLS = `
<svg id="ab-icon-defs" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden"><defs>
  <symbol id="ab-sword" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" stroke-linecap="round" d="M6.5 17.5 16 8l-1.2-3.2L18.5 6 20 9.4 16.8 8 7.4 17.4zM4 20l2.5-2.5M3 21l1.6-1.6"/></symbol>
  <symbol id="ab-shield" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M12 2.6 4.5 5.4v6.1c0 4.6 3.2 7.5 7.5 9.9 4.3-2.4 7.5-5.3 7.5-9.9V5.4z"/></symbol>
  <symbol id="ab-flame" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round" d="M12 3c2 3 5 4.5 5 8.5A5 5 0 0 1 7 12c0-1.5.5-2.5 1.3-3.3C8.5 11 10 11 10 9c0-2 1-4 2-6"/></symbol>
  <symbol id="ab-snow" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M12 2v20M2 12h20M5 5l14 14M19 5 5 19M12 6l-2.5 1.6M12 6l2.5 1.6M12 18l-2.5-1.6M12 18l2.5-1.6"/></symbol>
  <symbol id="ab-stun" viewBox="0 0 24 24"><circle cx="12" cy="12" r="2.4" fill="none" stroke="currentColor" stroke-width="1.7"/><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M12 4v2.5M12 17.5V20M4 12h2.5M17.5 12H20M6.4 6.4l1.8 1.8M15.8 15.8l1.8 1.8M17.6 6.4l-1.8 1.8M8.2 15.8l-1.8 1.8"/></symbol>
  <symbol id="ab-trident" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M12 21V8M12 8V3M7 9V4.5l3 2.6M17 9V4.5l-3 2.6M7 9a5 5 0 0 0 10 0"/></symbol>
  <symbol id="ab-swirl" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" d="M12 12a2.5 2.5 0 1 0 2.5-2.5 5.5 5.5 0 1 0-5.5 5.5 8.5 8.5 0 1 0 8.5-8.5"/></symbol>
  <symbol id="ab-arrow" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M4 12h13M13 7l5.5 5L13 17"/></symbol>
  <symbol id="ab-bow" viewBox="0 0 24 24"><path fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" d="M6 3a13 13 0 0 1 0 18M6 3l14 9-14 9M10 12h9"/></symbol>
  <symbol id="ab-target" viewBox="0 0 24 24"><circle cx="12" cy="12" r="8" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="12" cy="12" r="1.3" fill="currentColor"/></symbol>
</defs></svg>`;

// The ability emojis from src/sim/content/abilities.ts → symbol id.
const EMOJI_TO_ICON: Record<string, string> = {
  '⚔': 'ab-sword', '🛡': 'ab-shield', '💫': 'ab-stun', '🔱': 'ab-trident',
  '🌀': 'ab-swirl', '➹': 'ab-arrow', '🔥': 'ab-flame', '🏹': 'ab-bow',
  '🎯': 'ab-target', '🥶': 'ab-snow', '🌋': 'ab-flame', '❄': 'ab-snow',
};

/** Inject the <symbol> defs once (idempotent). Safe to call on every HUD construction. */
export function injectAbilityIcons(): void {
  if (document.getElementById('ab-icon-defs')) return;
  document.body.insertAdjacentHTML('beforeend', SYMBOLS);
}

/** The SVG symbol id for an ability emoji, or null to fall back to the emoji itself. */
export function abilityIconId(emoji: string): string | null {
  return EMOJI_TO_ICON[emoji] ?? null;
}
