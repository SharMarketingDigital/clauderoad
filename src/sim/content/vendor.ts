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
  // Lapidação: o vendor é a REDE DE SEGURANÇA (kit básico de recomeço), não a fonte de gear bom. As 8
  // armas de 2º/3º grau (iron_sword/steel_sword/steel_spear/halberd/hunters_bow/composite_bow/adept_staff/
  // sorcerer_staff) saíram do estoque — agora são DROP-ONLY (caçar não compete com comprar). O básico
  // (couro grau 1, armas grau 1, acessórios, protect_stone, poções, elixires, pet) continua aqui.
  // GDD v0.5 (Pets): the grab pet — buy once (permanent), then summon/dismiss at will (tecla P). The bot
  // never buys it (botTrade buys fixed ids only), so adding it here is inert for autoplay + determinism.
  { itemId: 'pet_grab', price: 250 },
];
