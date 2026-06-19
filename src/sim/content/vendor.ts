// Data-as-code town vendor: a fixed NPC that buys the player's loot for gold and
// sells a small stock of basics. The player must be within VENDOR_INTERACT_RANGE
// to trade. Prices are provisional (vendor buys low — see item `value` — and sells
// at the markups below).
export interface VendorStockEntry {
  itemId: string; // an id in ITEMS
  price: number; // gold to BUY one (the item is added Normal, +0)
}

export const VENDOR_NAME = 'Mercador';
// A "town" spot a short walk from the spawn point (0,0).
export const VENDOR_SPAWN_X = 10;
export const VENDOR_SPAWN_Z = 6;
export const VENDOR_INTERACT_RANGE = 4; // world units; must be this close to trade

// What the vendor SELLS. Selling TO the vendor is generic (any item with a
// `value`, rarity-scaled), so it isn't listed here.
export const VENDOR_STOCK: VendorStockEntry[] = [
  { itemId: 'health_potion', price: 25 },
  { itemId: 'iron_spear', price: 120 }, // switch to the Lança mastery (area + crit kit)
  { itemId: 'short_bow', price: 130 }, // switch to the Arco mastery (ranged + kiting kit)
  { itemId: 'elixir_weapon', price: 40 },
  { itemId: 'elixir_armor', price: 40 },
  { itemId: 'lucky_powder', price: 60 },
];
