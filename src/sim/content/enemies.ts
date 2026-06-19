// Data-as-code content for mobs.
export interface DropEntry {
  itemId: string; // an id in content/items.ts ITEMS
  chance: number; // 0..1, rolled independently via the sim Rng
}

export interface EnemyTemplate {
  id: string;
  name: string;
  hp: number;
  xp: number; // XP awarded to the killer (provisional; tune with the curve)
  // Loot (provisional): a little gold every kill + a per-item drop table.
  goldMin: number;
  goldMax: number;
  drops: DropEntry[];
  // Combat/AI (provisional — grounded loosely on a low-level WoW wolf): pulls
  // aggro within `aggroRadius`, chases, and bites for meleeDamage(str,weaponDamage)
  // every `swingTime`s; gives up (leash) once led `leashRadius` from where the
  // chase began.
  str: number;
  weaponDamage: number;
  swingTime: number; // seconds between bites
  aggroRadius: number; // world units; aggros when the player is this close
  leashRadius: number; // world units from the chase anchor before it gives up
}

export const ENEMY_TEMPLATE: EnemyTemplate = {
  id: 'grey_wolf',
  name: 'Lobo Cinzento',
  hp: 40,
  xp: 25,
  goldMin: 2,
  goldMax: 8,
  str: 8, // meleeDamage(8,2) = 6 per bite — a real but gentle nibble vs the 120-HP starter
  weaponDamage: 2,
  swingTime: 2.0,
  aggroRadius: 8,
  leashRadius: 16,
  drops: [
    { itemId: 'wolf_leather', chance: 0.4 },
    { itemId: 'health_potion', chance: 0.25 },
    { itemId: 'old_sword', chance: 0.05 }, // rare-ish placeholder
    // alchemy materials (rare-ish, so upgrading is a real choice)
    { itemId: 'lucky_powder', chance: 0.18 },
    { itemId: 'elixir_weapon', chance: 0.12 },
    { itemId: 'elixir_armor', chance: 0.12 },
  ],
};
export const ENEMY_COUNT = 12;
