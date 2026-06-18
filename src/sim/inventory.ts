// Inventory logic for the deterministic core. Pure functions over a bag of
// item stacks — no DOM, no Rng, no time. The Sim owns the player's bag and
// feeds loot into it; render/ui only read it (via IWorld).
import type { ItemStack } from './types';

export const BAG_SLOTS = 20; // provisional grid size (GDD §D1: limited slots)

// Add `qty` of an item to the bag. Stacks onto an existing stack of the same
// item id; otherwise takes a fresh slot. Returns false when a NEW stack is
// needed but every slot is already taken (the item is dropped on the floor —
// for now it's simply lost; ground pickups come later).
export function addToBag(
  bag: ItemStack[],
  itemId: string,
  qty: number,
  maxSlots: number = BAG_SLOTS,
): boolean {
  const existing = bag.find((s) => s.itemId === itemId);
  if (existing) {
    existing.qty += qty;
    return true;
  }
  if (bag.length >= maxSlots) return false;
  bag.push({ itemId, qty });
  return true;
}
