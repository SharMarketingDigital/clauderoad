// Data-as-code town shops. Silkroad-style: instead of ONE vendor that sells everything, the town has
// SPECIALIZED shop NPCs (ferreiro/armas, armadureiro/armadura+escudo, boticário/poções, alquimista/
// elixires+acessórios+pet) — each a fixed NPC selling a slice of the catalog. The player must be within
// VENDOR_INTERACT_RANGE to trade; selling TO a shop is generic (any item with a `value`, rarity-scaled).
export interface VendorStockEntry {
  itemId: string; // an id in ITEMS
  price: number; // gold to BUY one (the item is added Normal, +0)
}

export const VENDOR_NAME = 'Mercador'; // fallback storefront title when not standing near any shop NPC
// A "town" spot a short walk from spawn (0,0) — the FERREIRO stands here (the first shop, by the gate).
export const VENDOR_SPAWN_X = 10;
export const VENDOR_SPAWN_Z = 6;
export const VENDOR_INTERACT_RANGE = 4; // world units; must be this close to trade

// A specialized shop NPC. `species` is BOTH the gameplay tag and the renderer's model key (distinct model
// per role). `x`/`z` place it in a small market inside the town wall. `stock` is what it sells.
export interface ShopDef {
  species: string;
  name: string;
  x: number;
  z: number;
  stock: VendorStockEntry[];
}

// --- per-shop catalogs (the old single VENDOR_STOCK, split by role) ---
const BLACKSMITH_STOCK: VendorStockEntry[] = [
  { itemId: 'iron_spear', price: 120 }, // switch to the Lança mastery
  { itemId: 'short_bow', price: 130 }, // switch to the Arco mastery
  { itemId: 'apprentice_staff', price: 130 }, // switch to the Mago mastery
];
const ARMORER_STOCK: VendorStockEntry[] = [
  { itemId: 'leather_cap', price: 40 },
  { itemId: 'wolf_leather', price: 50 },
  { itemId: 'leather_gloves', price: 30 },
  { itemId: 'leather_pants', price: 45 },
  { itemId: 'leather_boots', price: 30 },
  { itemId: 'wooden_shield', price: 55 },
];
const APOTHECARY_STOCK: VendorStockEntry[] = [
  { itemId: 'health_potion', price: 25 },
  { itemId: 'mana_potion', price: 25 }, // caster sustain (alongside the out-of-combat regen)
];
const ALCHEMIST_STOCK: VendorStockEntry[] = [
  { itemId: 'elixir_weapon', price: 40 },
  { itemId: 'elixir_armor', price: 40 },
  { itemId: 'protect_stone', price: 75 }, // alchemy safety net (prevents break / caps the drop)
  { itemId: 'copper_necklace', price: 70 },
  { itemId: 'copper_earring', price: 70 },
  { itemId: 'copper_ring', price: 70 },
  { itemId: 'pet_grab', price: 250 }, // GDD v0.5 (Pets): buy once (permanent), summon/dismiss with F
  // Sistema 2 (respec): o pergaminho de reinício. Preço meaningful (acima do pet) = o "custo escalado"
  // do respec do Silkroad, adaptado à nossa economia: um freio pra desencorajar respec casual, não um muro.
  { itemId: 'skill_reset', price: 300 },
];

// The 4 specialized shops, in a small market by the gate. NOTE: the BOTICÁRIO sells potions — the bot's
// critical restock — so the auto-play bot's town-run anchors on it (see Sim.spawnShops/vendorId).
// Layout: every shop sits ≥10 world units from the WAREHOUSE at (10,18) so their interaction zones (radius
// VENDOR_INTERACT_RANGE=4 each) never overlap the warehouse's — standing at one is never standing at the
// other (asserted by tests/sim.test.ts "zonas de interação mutuamente exclusivas").
export const TOWN_SHOPS: ShopDef[] = [
  { species: 'blacksmith', name: 'Ferreiro', x: VENDOR_SPAWN_X, z: VENDOR_SPAWN_Z, stock: BLACKSMITH_STOCK },
  { species: 'armorer', name: 'Armadureiro', x: 16, z: 6, stock: ARMORER_STOCK },
  { species: 'apothecary', name: 'Boticário', x: 4, z: 10, stock: APOTHECARY_STOCK },
  { species: 'alchemist', name: 'Alquimista', x: 16, z: 10, stock: ALCHEMIST_STOCK },
];

// The union of every shop's stock — the fallback catalog (shown greyed when not near a shop) AND the bot's
// price lookup. Selling/back-compat code reads this.
export const VENDOR_STOCK: VendorStockEntry[] = TOWN_SHOPS.flatMap((s) => s.stock);

// Reserved entity-id base for the shop NPCs: above the warehouse (1e9) and the teleporters (1e9+1.., one
// per city), with plenty of room. Fixed ids -> adding shops never perturbs the nextId-allocated player
// ids (so networked id allocation stays stable, like the warehouse/teleporter already do).
export const SHOP_ENTITY_ID_BASE = 1_000_000_100;
export function shopEntityId(index: number): number {
  return SHOP_ENTITY_ID_BASE + index;
}
