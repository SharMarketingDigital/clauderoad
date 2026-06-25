// Positional/sparse inventory (the drag-and-drop grid): the bag is a fixed-length array where a
// removed item leaves a NULL hole (so other items keep their slot), loot refills the lowest hole
// in F-order, and the new move-item / unequip-to-slot commands place items EXACTLY where asked.
// These lock in the model + its determinism and persistence (positions survive save/restore).
import { describe, it, expect } from 'vitest';
import { addToBag, removeFromBag, moveBagSlot, freeBagSlots, BAG_SLOTS } from '../src/sim/inventory';
import type { ItemStack } from '../src/sim/types';
import { Sim } from '../src/sim/sim';

const newBag = (): (ItemStack | null)[] => new Array(BAG_SLOTS).fill(null);
const mk = (itemId: string, qty = 1): ItemStack => ({ itemId, rarity: 'normal', plus: 0, qty });

describe('positional bag (sparse) — pure ops', () => {
  it('addToBag fills the FIRST empty hole in F-order (index 0..n)', () => {
    const bag = newBag();
    bag[2] = mk('a');
    expect(addToBag(bag, 'b', 'normal', 0, 1)).toBe(true);
    expect(bag[0]?.itemId).toBe('b'); // slot 0 was the lowest hole
    expect(bag[2]?.itemId).toBe('a'); // the existing item is untouched
  });

  it('addToBag merges into a matching stack wherever it sits (no new slot used)', () => {
    const bag = newBag();
    bag[5] = mk('pot', 3);
    expect(addToBag(bag, 'pot', 'normal', 0, 2)).toBe(true);
    expect(bag[5]?.qty).toBe(5);
    expect(freeBagSlots(bag)).toBe(BAG_SLOTS - 1);
  });

  it('addToBag returns false when full (no hole AND no matching stack)', () => {
    const bag = newBag();
    for (let i = 0; i < BAG_SLOTS; i++) bag[i] = mk('x' + i);
    expect(addToBag(bag, 'new', 'normal', 0, 1)).toBe(false);
    expect(freeBagSlots(bag)).toBe(0);
  });

  it('removeFromBag leaves a NULL hole — other items do NOT shift down', () => {
    const bag = newBag();
    bag[0] = mk('a');
    bag[1] = mk('b');
    expect(removeFromBag(bag, 'a', 'normal', 0, 1)).toBe(true);
    expect(bag[0]).toBeNull();
    expect(bag[1]?.itemId).toBe('b'); // kept its position
    expect(freeBagSlots(bag)).toBe(BAG_SLOTS - 1);
  });

  it('moveBagSlot swaps two occupied slots and moves into a hole', () => {
    const bag = newBag();
    bag[0] = mk('a');
    bag[1] = mk('b');
    expect(moveBagSlot(bag, 0, 1)).toBe(true); // swap
    expect(bag[0]?.itemId).toBe('b');
    expect(bag[1]?.itemId).toBe('a');
    expect(moveBagSlot(bag, 0, 5)).toBe(true); // move 'b' into the hole at 5
    expect(bag[0]).toBeNull();
    expect(bag[5]?.itemId).toBe('b');
  });

  it('moveBagSlot is a no-op for an empty source / same index / out-of-range', () => {
    const bag = newBag();
    bag[0] = mk('a');
    expect(moveBagSlot(bag, 3, 4)).toBe(false); // empty source
    expect(moveBagSlot(bag, 0, 0)).toBe(false); // same slot
    expect(moveBagSlot(bag, 0, 999)).toBe(false); // out of range
    expect(bag[0]?.itemId).toBe('a');
  });
});

describe('positional bag (sparse) — sim commands & persistence', () => {
  it('move-item rearranges the bag to the EXACT target slot (no auto-organize)', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { bag: [mk('health_potion', 5), mk('lucky_powder', 2)] });
    sim.sendCommandFor(a, { t: 'move-item', from: 0, to: 8 });
    sim.step();
    const slots = sim.inventoryFor(a).slots;
    expect(slots[0]).toBeNull();
    expect(slots[8]?.itemId).toBe('health_potion');
    expect(slots[1]?.itemId).toBe('lucky_powder'); // untouched neighbour
  });

  it('unequip places the item at the EXACT bag slot requested (drag placement)', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, {
      level: 10,
      equipment: { weapon: { itemId: 'old_sword', rarity: 'normal', plus: 0, durability: 100 } },
    });
    sim.sendCommandFor(a, { t: 'unequip', slot: 'weapon', toBagSlot: 7 });
    sim.step();
    expect(sim.inventoryFor(a).slots[7]?.itemId).toBe('old_sword');
  });

  it('save preserves item POSITIONS across serialize -> JSON -> restore', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    // an item parked at slot 3 with holes before it
    sim.restorePlayer(a, { bag: [null, null, null, { itemId: 'iron_spear', rarity: 'som', plus: 4, qty: 1 }] });
    const save = sim.serializePlayer(a)!;
    const sim2 = new Sim(1337, false);
    const b = sim2.addPlayer('B');
    sim2.restorePlayer(b, JSON.parse(JSON.stringify(save)));
    expect(sim2.inventoryFor(b).slots[3]?.itemId).toBe('iron_spear'); // SAME slot survives
    expect(sim2.inventoryFor(b).slots[0]).toBeNull();
  });

  it('same seed + same move-item stream => identical bag layout (deterministic)', () => {
    const layout = (): (string | null)[] => {
      const sim = new Sim(1337, false);
      const a = sim.addPlayer('A');
      sim.restorePlayer(a, { bag: [mk('health_potion'), mk('lucky_powder')] });
      sim.sendCommandFor(a, { t: 'move-item', from: 0, to: 10 });
      sim.sendCommandFor(a, { t: 'move-item', from: 1, to: 0 });
      sim.step();
      return sim.inventoryFor(a).slots.map((s) => s?.itemId ?? null);
    };
    expect(layout()).toEqual(layout());
  });
});
