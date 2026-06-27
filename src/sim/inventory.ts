// Inventory logic for the deterministic core. Pure functions over a bag of
// item stacks — no DOM, no Rng, no time. The Sim owns the player's bag and
// feeds loot into it; render/ui only read it (via IWorld). Stacks key on item
// id, rarity AND enhancement (+N) — a +4 SUN sword stacks separately from a +0.
import type { ItemStack } from './types';
import type { Rarity, EquipSlot } from '../world_api';

export const BAG_SLOTS = 20; // provisional grid size (GDD §D1: limited slots)
export const STORAGE_SLOTS = 40; // K5: armazém/banco da cidade — maior que a bolsa (Silkroad ~36-48)
export const PETBAG_SLOTS = 12; // GDD v0.5 (Pets PET2): transport pet's portable bag — a moderate extra (< the town bank), to carry more loot before a town run

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
  bag: (ItemStack | null)[],
  itemId: string,
  rarity: Rarity,
  plus: number,
  qty: number,
  maxSlots: number = BAG_SLOTS,
): boolean {
  // Merge into a matching stack wherever it sits (position-independent).
  const existing = bag.find((s): s is ItemStack => s != null && sameStack(s, itemId, rarity, plus));
  if (existing) {
    existing.qty += qty;
    return true;
  }
  // Otherwise drop it into the FIRST empty slot in F-order (index 0..maxSlots-1): a hole in a
  // fixed-length sparse bag, or a fresh push for a still-growing list (the warehouse). This is
  // what makes loot fill left->right / top->bottom while leaving drag-placed holes untouched.
  for (let i = 0; i < maxSlots; i++) {
    if (i >= bag.length) { bag[i] = { itemId, rarity, plus, qty }; return true; } // grow (compact list)
    if (bag[i] == null) { bag[i] = { itemId, rarity, plus, qty }; return true; } // fill the first hole
  }
  return false; // no matching stack and no free slot within capacity
}

// Remove `qty` of an exact stack (item, rarity, +N) from the bag. Returns false
// if the bag doesn't hold enough of that stack.
export function removeFromBag(
  bag: (ItemStack | null)[],
  itemId: string,
  rarity: Rarity,
  plus: number,
  qty: number,
): boolean {
  const idx = bag.findIndex((s) => s != null && sameStack(s, itemId, rarity, plus));
  if (idx < 0) return false;
  const st = bag[idx] as ItemStack;
  if (st.qty < qty) return false;
  st.qty -= qty;
  // Empty a slot to NULL (a hole) instead of splicing — preserves every OTHER item's POSITION
  // (the positional / drag-placed inventory). Loot later refills the lowest hole in F-order.
  if (st.qty <= 0) bag[idx] = null;
  return true;
}

// How many empty (null) slots a sparse bag has. The bag's length is fixed (= capacity), so the
// old "capacity - length" no longer counts free slots — count the holes instead.
export function freeBagSlots(bag: (ItemStack | null)[]): number {
  let n = 0;
  for (const s of bag) if (s == null) n++;
  return n;
}

// Move/swap two bag slots (positional drag-and-drop): swap when the target is occupied, move when
// it is a hole. Pure + deterministic; out-of-range or an empty source is a no-op. Returns true if
// anything changed.
export function moveBagSlot(bag: (ItemStack | null)[], from: number, to: number): boolean {
  if (from === to) return false;
  if (from < 0 || to < 0 || from >= bag.length || to >= bag.length) return false;
  if (bag[from] == null) return false; // nothing to move
  const tmp = bag[to];
  bag[to] = bag[from];
  bag[from] = tmp; // tmp may be null -> a plain move into a hole
  return true;
}
