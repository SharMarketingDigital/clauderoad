// Inventory logic for the deterministic core. Pure functions over a bag of
// item stacks — no DOM, no Rng, no time. The Sim owns the player's bag and
// feeds loot into it; render/ui only read it (via IWorld). Stacks key on item
// id, rarity AND enhancement (+N) — a +4 SUN sword stacks separately from a +0.
import type { ItemStack } from './types';
import type { Rarity, EquipSlot } from '../world_api';

export const BAG_SLOTS = 20; // provisional grid size (GDD §D1: limited slots)

// Equipment slots a character can fill (the full Silkroad set). The single typed
// source the sim and the save layer iterate. It lives in this leaf (which imports
// only world_api), so both sim.ts and save.ts can import it with NO import cycle.
export const EQUIP_SLOTS: EquipSlot[] = [
  'weapon', 'shield', 'helmet', 'chest', 'hands', 'legs', 'feet',
  'necklace', 'earring', 'ring',
];

const sameStack = (s: ItemStack, itemId: string, rarity: Rarity, plus: number): boolean =>
  s.itemId === itemId && s.rarity === rarity && s.plus === plus;

// Add `qty` of an item (rarity, +N) to the bag. Stacks onto a matching stack;
// otherwise takes a fresh slot. Returns false when a NEW stack is needed but
// every slot is taken (the item is dropped on the floor — for now simply lost).
export function addToBag(
  bag: ItemStack[],
  itemId: string,
  rarity: Rarity,
  plus: number,
  qty: number,
  maxSlots: number = BAG_SLOTS,
): boolean {
  const existing = bag.find((s) => sameStack(s, itemId, rarity, plus));
  if (existing) {
    existing.qty += qty;
    return true;
  }
  if (bag.length >= maxSlots) return false;
  bag.push({ itemId, rarity, plus, qty });
  return true;
}

// Remove `qty` of an exact stack (item, rarity, +N) from the bag. Returns false
// if the bag doesn't hold enough of that stack.
export function removeFromBag(
  bag: ItemStack[],
  itemId: string,
  rarity: Rarity,
  plus: number,
  qty: number,
): boolean {
  const idx = bag.findIndex((s) => sameStack(s, itemId, rarity, plus));
  if (idx < 0 || bag[idx].qty < qty) return false;
  bag[idx].qty -= qty;
  if (bag[idx].qty <= 0) bag.splice(idx, 1);
  return true;
}
