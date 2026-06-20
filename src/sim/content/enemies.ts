// Data-as-code content for mobs.
import type { EnemyTierId } from '../../world_api';

export interface DropEntry {
  itemId: string; // an id in content/items.ts ITEMS
  chance: number; // 0..1, rolled independently via the sim Rng
}

export interface EnemyTemplate {
  id: string;
  name: string;
  hp: number;
  xp: number; // XP awarded to the killer (provisional; tune with the curve)
  sp: number; // SP (skill points) awarded to the killer (provisional; GDD B4). Scales by tier (xpMult).
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
  sp: 4, // ~3 kills to rank up an ability the first time (cost 10); ramps with the cost curve

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

// Enemy strength tiers. A spawn rolls one by weight: most mobs are 'normal', a
// chunk are 'champion', and a few are 'elite' — each tougher, harder-hitting,
// more rewarding, and drawn bigger. Multipliers apply to the base template; the
// name gets a suffix and the renderer scales/tints by `scale`/tier.
export interface EnemyTier {
  id: EnemyTierId;
  nameSuffix: string; // appended to the base name ('' for normal)
  weight: number; // relative spawn weight
  hpMult: number;
  damageMult: number; // scales str + weaponDamage (a harder bite)
  goldMult: number;
  xpMult: number;
  scale: number; // render size multiplier
}

export const ENEMY_TIERS: EnemyTier[] = [
  { id: 'normal', nameSuffix: '', weight: 80, hpMult: 1, damageMult: 1, goldMult: 1, xpMult: 1, scale: 1 },
  { id: 'champion', nameSuffix: 'Campeão', weight: 16, hpMult: 3, damageMult: 1.6, goldMult: 4, xpMult: 3, scale: 1.35 },
  { id: 'elite', nameSuffix: 'de Elite', weight: 4, hpMult: 6, damageMult: 2.2, goldMult: 9, xpMult: 6, scale: 1.7 },
];

const TIER_WEIGHT_TOTAL = ENEMY_TIERS.reduce((s, t) => s + t.weight, 0);

// Pick a tier from a roll in [0,1) by weight. Pure (the sim supplies the roll),
// so it stays deterministic and content has no Rng dependency.
export function pickEnemyTier(roll: number): EnemyTier {
  const target = roll * TIER_WEIGHT_TOTAL;
  let acc = 0;
  for (const t of ENEMY_TIERS) {
    acc += t.weight;
    if (target < acc) return t;
  }
  return ENEMY_TIERS[0];
}
