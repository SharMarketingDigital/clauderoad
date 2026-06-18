// Inventory logic for the deterministic core. Pure functions over a bag of
// item stacks — no DOM, no Rng, no time. The Sim owns the player's bag and
// feeds loot into it; render/ui only read it (via IWorld). Stacks key on item
// id AND rarity (a SUN sword stacks separately from a Normal one).
import type { ItemStack } from './types';
import type { Rarity } from '../world_api';

export const BAG_SLOTS = 20; // provisional grid size (GDD §D1: limited slots)

// Add `qty` of an item+rarity to the bag. Stacks onto a matching stack;
// otherwise takes a fresh slot. Returns false when a NEW stack is needed but
// every slot is taken (the item is dropped on the floor — for now simply lost).
export function addToBag(
  bag: ItemStack[],
  itemId: string,
  rarity: Rarity,
  qty: number,
  maxSlots: number = BAG_SLOTS,
): boolean {
  const existing = bag.find((s) => s.itemId === itemId && s.rarity === rarity);
  if (existing) {
    existing.qty += qty;
    return true;
  }
  if (bag.length >= maxSlots) return false;
  bag.push({ itemId, rarity, qty });
  return true;
}

// Remove `qty` of an item+rarity from the bag (decrementing or dropping the
// stack). Returns false if the bag doesn't hold enough of that exact stack.
export function removeFromBag(bag: ItemStack[], itemId: string, rarity: Rarity, qty: number): boolean {
  const idx = bag.findIndex((s) => s.itemId === itemId && s.rarity === rarity);
  if (idx < 0 || bag[idx].qty < qty) return false;
  bag[idx].qty -= qty;
  if (bag[idx].qty <= 0) bag.splice(idx, 1);
  return true;
}
