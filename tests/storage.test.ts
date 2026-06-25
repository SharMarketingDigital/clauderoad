import { describe, it, expect } from 'vitest';
import { depositStack, withdrawStack } from '../src/sim/storage';
import { BAG_SLOTS, STORAGE_SLOTS } from '../src/sim/inventory';
import type { ItemStack } from '../src/sim/types';

// Pure helpers over two ItemStack[] arrays — no Sim/Rng/DOM. canAccept/deposit/withdraw don't
// validate against ITEMS (that's the sim's job at the command gate), so arbitrary ids are fine.
const mk = (itemId: string, qty = 1, rarity: ItemStack['rarity'] = 'normal', plus = 0): ItemStack => ({ itemId, rarity, plus, qty });
const clone = (a: ItemStack[]): ItemStack[] => a.map((s) => ({ ...s }));

describe('storage (armazém) — depósito/saque puro', () => {
  it('deposita o stack INTEIRO: sai da bolsa, entra no armazém', () => {
    const bag = [mk('health_potion', 5)];
    const storage: ItemStack[] = [];
    expect(depositStack(bag, storage, 'health_potion', 'normal', 0)).toBe(true);
    expect(bag.filter((s) => s != null)).toEqual([]); // saiu da bolsa (modelo esparso: deixa um hole no slot)
    expect(storage).toEqual([mk('health_potion', 5)]);
  });

  it('saca o stack INTEIRO: espelho do depósito', () => {
    const bag: ItemStack[] = [];
    const storage = [mk('steel_sword', 1)];
    expect(withdrawStack(storage, bag, 'steel_sword', 'normal', 0)).toBe(true);
    expect(storage.filter((s) => s != null)).toEqual([]); // saiu do armazém (hole no slot)
    expect(bag).toEqual([mk('steel_sword', 1)]);
  });

  it('depósito de um stack que a bolsa não possui é recusado', () => {
    expect(depositStack([], [], 'health_potion', 'normal', 0)).toBe(false);
  });

  it('armazém cheio (STORAGE_SLOTS) recusa um NOVO itemId; o put-back deixa a bolsa IDÊNTICA', () => {
    const storage: ItemStack[] = [];
    for (let i = 0; i < STORAGE_SLOTS; i++) storage.push(mk('filler' + i, 1));
    const bag = [mk('health_potion', 3), mk('lucky_powder', 2)];
    const bagBefore = clone(bag);
    expect(depositStack(bag, storage, 'health_potion', 'normal', 0)).toBe(false);
    expect(bag).toEqual(bagBefore); // conteúdo E ordem intactos
    expect(storage.length).toBe(STORAGE_SLOTS);
  });

  it('stack CASÁVEL cresce mesmo com o armazém cheio (espelha addToBag)', () => {
    const storage: ItemStack[] = [];
    for (let i = 0; i < STORAGE_SLOTS - 1; i++) storage.push(mk('filler' + i, 1));
    storage.push(mk('health_potion', 10)); // armazém em STORAGE_SLOTS, mas com stack casável
    const bag = [mk('health_potion', 5)];
    expect(depositStack(bag, storage, 'health_potion', 'normal', 0)).toBe(true);
    expect(storage[storage.length - 1]!.qty).toBe(15); // a qty cresceu
    expect(bag.filter((s) => s != null)).toEqual([]); // saiu da bolsa (hole no slot)
  });

  it('saque de um NOVO stack para a bolsa cheia (BAG_SLOTS) é recusado, armazém intacto', () => {
    const bag: ItemStack[] = [];
    for (let i = 0; i < BAG_SLOTS; i++) bag.push(mk('bagfill' + i, 1));
    const storage = [mk('steel_sword', 1)];
    const storageBefore = clone(storage);
    expect(withdrawStack(storage, bag, 'steel_sword', 'normal', 0)).toBe(false);
    expect(storage).toEqual(storageBefore);
  });

  it('rarity/plus distintos são stacks distintos (não se misturam)', () => {
    const bag = [mk('iron_sword', 1, 'sun', 3)];
    const storage = [mk('iron_sword', 1, 'normal', 0)];
    expect(depositStack(bag, storage, 'iron_sword', 'sun', 3)).toBe(true);
    expect(storage.length).toBe(2); // o +3 SUN não casou com o +0 normal
  });
});
