// Shared overlay registry — the single source of truth for "is some window open right now?".
// It gives ESC a clean, order-independent priority: each toggleable overlay registers an isOpen()
// predicate, and the ESC-opened settings menu consults anyOverlayOpen() so it only opens when
// nothing else is up (and never collides with the inventory/map/matching Esc-closers).
//
// Pure UI: no sim, no DOM ownership — just a set of predicates. Any future window that wants to take
// part in ESC priority registers once here; the rule then "just works".
type OpenPredicate = () => boolean;

const predicates = new Set<OpenPredicate>();

// Register an overlay's "is it currently open?" check. Returns an unregister fn (rarely needed —
// these windows live for the whole session).
export function registerOverlay(isOpen: OpenPredicate): () => void {
  predicates.add(isOpen);
  return () => {
    predicates.delete(isOpen);
  };
}

// True if ANY registered overlay is currently open.
export function anyOverlayOpen(): boolean {
  for (const isOpen of predicates) {
    if (isOpen()) return true;
  }
  return false;
}
