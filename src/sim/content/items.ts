// Data-as-code item definitions. The bag stores item ids; the UI resolves names
// through ITEMS via IWorld. Equippable items carry a `slot` and `stats` that the
// sim sums onto the character while equipped (see recomputeStats in sim.ts).
import type { EquipSlot } from '../../world_api';

// Flat bonuses an equipped item grants. Provisional numbers — tune later.
export interface ItemStats {
  weaponDamage?: number;
  str?: number;
  maxHp?: number;
  maxMp?: number;
}

export interface ItemDef {
  id: string;
  name: string;
  slot?: EquipSlot; // present => equippable (into this slot)
  stats?: ItemStats; // bonuses applied while equipped
  elixirFor?: EquipSlot; // present => an alchemy Elixir that upgrades this slot
  luckyPowder?: boolean; // the alchemy luck booster
}

export const ITEMS: Record<string, ItemDef> = {
  health_potion: { id: 'health_potion', name: 'Poção de Vida' }, // consumable (no effect yet)
  // crude leather "armor" — common drop, gives a little HP
  wolf_leather: { id: 'wolf_leather', name: 'Couro de Lobo', slot: 'armor', stats: { maxHp: 20 } },
  // the starter weapon upgrade: a big chunk of weapon damage over bare fists
  old_sword: { id: 'old_sword', name: 'Espada Velha', slot: 'weapon', stats: { weaponDamage: 10 } },
  // alchemy materials (no rarity; consumed to attempt a "+N" upgrade)
  elixir_weapon: { id: 'elixir_weapon', name: 'Elixir de Arma', elixirFor: 'weapon' },
  elixir_armor: { id: 'elixir_armor', name: 'Elixir de Armadura', elixirFor: 'armor' },
  lucky_powder: { id: 'lucky_powder', name: 'Pó da Sorte', luckyPowder: true },
};
