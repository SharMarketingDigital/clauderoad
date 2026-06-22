// True when the user is typing into a text field (the chat input). Game input AND the
// HUD hotkeys check this so keystrokes meant for chat don't also drive the character
// (WASD/skills/inventory). Offline there are no text fields, so this is always false —
// single-player is unaffected.
export function isTyping(): boolean {
  const el = document.activeElement as HTMLElement | null;
  if (!el) return false;
  const tag = el.tagName;
  return tag === 'INPUT' || tag === 'TEXTAREA' || el.isContentEditable === true;
}
