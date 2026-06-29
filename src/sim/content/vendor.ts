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
  { itemId: 'mana_potion', price: 25 }, // caster sustain — buy MP refills (alongside the out-of-combat regen)
  { itemId: 'iron_spear', price: 120 }, // switch to the Lança mastery (area + crit kit)
  { itemId: 'short_bow', price: 130 }, // switch to the Arco mastery (ranged + kiting kit)
  { itemId: 'apprentice_staff', price: 130 }, // switch to the Mago mastery (ranged magical kit)
  { itemId: 'elixir_weapon', price: 40 },
  { itemId: 'elixir_armor', price: 40 },
  { itemId: 'protect_stone', price: 75 }, // K4: alchemy safety net (prevents break / caps the drop)
  // K1: the full Silkroad equipment set, so a player can buy a complete set in town.
  { itemId: 'leather_cap', price: 40 },
  { itemId: 'wolf_leather', price: 50 },
  { itemId: 'leather_gloves', price: 30 },
  { itemId: 'leather_pants', price: 45 },
  { itemId: 'leather_boots', price: 30 },
  { itemId: 'wooden_shield', price: 55 },
  { itemId: 'copper_necklace', price: 70 },
  { itemId: 'copper_earring', price: 70 },
  { itemId: 'copper_ring', price: 70 },
  // --- K2 degrees: armas de 2º/3º grau. Comprar é LIVRE em qualquer nível; só EQUIPAR é
  // gated por nível (ver Sim.equip / degrees.ts). O bot não compra arma (botTrade compra só
  // ids fixos), então adicionar aqui é inerte para o autoplay e o determinismo.
  { itemId: 'iron_sword', price: 160 },
  { itemId: 'steel_sword', price: 300 },
  { itemId: 'steel_spear', price: 240 },
  { itemId: 'halberd', price: 430 },
  { itemId: 'hunters_bow', price: 270 },
  { itemId: 'composite_bow', price: 470 },
  { itemId: 'adept_staff', price: 300 },
  { itemId: 'sorcerer_staff', price: 510 },
  // GDD v0.5 (Pets): the grab pet — buy once (permanent), then summon/dismiss at will (tecla P). The bot
  // never buys it (botTrade buys fixed ids only), so adding it here is inert for autoplay + determinism.
  { itemId: 'pet_grab', price: 250 },
];
