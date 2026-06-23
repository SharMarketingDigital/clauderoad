// Data-as-code item definitions. The bag stores item ids; the UI resolves names
// through ITEMS via IWorld. Equippable items carry a `slot` and `stats` that the
// sim sums onto the character while equipped (see recomputeStats in sim.ts).
import type { EquipSlot, MasteryId } from '../../world_api';

// Flat bonuses an equipped item grants. Provisional numbers — tune later.
export interface ItemStats {
  weaponDamage?: number;
  str?: number;
  maxHp?: number;
  maxMp?: number;
}

// What a consumable restores when used from the bag. The use/heal path is fully
// generic, so a new consumable's EFFECT is just another ITEMS entry (e.g. a Mana
// Potion: consumable: { healMp: N }) with no sim changes. (To make it actually
// DROP, add it to a content drop table too — still data-as-code.)
export interface ConsumableEffect {
  healHp?: number; // restore up to this much HP (clamped to maxHp)
  healMp?: number; // restore up to this much MP (clamped to maxMp) — for a future Mana Potion
}

export interface ItemDef {
  id: string;
  name: string;
  slot?: EquipSlot; // present => equippable (into this slot)
  mastery?: MasteryId; // weapons only: which mastery (kit + passive) this weapon activates
  stats?: ItemStats; // bonuses applied while equipped
  elixirFor?: EquipSlot; // present => an alchemy Elixir that upgrades this slot
  luckyPowder?: boolean; // the alchemy luck booster
  consumable?: ConsumableEffect; // present => usable from the bag for this effect
  value?: number; // base gold value; the vendor pays this (rarity-scaled) on a sale
  // --- K2 degrees (graus por faixa de nível) — campos INTRÍNSECOS à definição do item ---
  degree?: number; // grau do equipamento (1..N); ausente => grau 1 (linha base legada)
  reqLevel?: number; // nível mínimo p/ EQUIPAR; ausente => derivado do grau (degrees.ts), senão 0
}

export const ITEMS: Record<string, ItemDef> = {
  // consumable: heals ~40% of the 120-HP starter, à la a WoW Classic minor healing potion
  health_potion: { id: 'health_potion', name: 'Poção de Vida', consumable: { healHp: 50 }, value: 10 },
  // crude leather "armor" — common drop, gives a little HP
  wolf_leather: { id: 'wolf_leather', name: 'Couro de Lobo', slot: 'armor', stats: { maxHp: 20 }, value: 8 },
  // the starter weapon upgrade: a big chunk of weapon damage over bare fists
  old_sword: { id: 'old_sword', name: 'Espada Velha', slot: 'weapon', mastery: 'sword', stats: { weaponDamage: 10 }, value: 30 },
  // a reach weapon: switches the character to the Lança mastery (area + crit kit)
  iron_spear: { id: 'iron_spear', name: 'Lança de Ferro', slot: 'weapon', mastery: 'spear', stats: { weaponDamage: 12 }, value: 45 },
  // a ranged weapon: switches to the Arco mastery (shoot from afar, kite, crit)
  short_bow: { id: 'short_bow', name: 'Arco Curto', slot: 'weapon', mastery: 'bow', stats: { weaponDamage: 8 }, value: 50 },
  // a magical weapon: switches to the Mago mastery (ranged MAGICAL damage scaling with Int)
  apprentice_staff: { id: 'apprentice_staff', name: 'Cajado de Aprendiz', slot: 'weapon', mastery: 'mage', stats: { weaponDamage: 9 }, value: 55 },
  // alchemy materials (no rarity; consumed to attempt a "+N" upgrade)
  elixir_weapon: { id: 'elixir_weapon', name: 'Elixir de Arma', elixirFor: 'weapon', value: 15 },
  elixir_armor: { id: 'elixir_armor', name: 'Elixir de Armadura', elixirFor: 'armor', value: 15 },
  lucky_powder: { id: 'lucky_powder', name: 'Pó da Sorte', luckyPowder: true, value: 25 },
};

// Shared cooldown between consumable uses (seconds) — classic "potion sickness",
// so they can't be spammed. The Sim converts this to ticks.
export const POTION_COOLDOWN_SECS = 5;
