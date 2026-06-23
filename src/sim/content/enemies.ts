// Data-as-code content for mobs.
import type { EnemyTierId, StatusKind } from '../../world_api';

// A status an enemy/boss can inflict ON the player when it lands a melee hit. The
// chance is rolled via the sim's dedicated procRng, so it never perturbs the main
// loot/position Rng stream (determinism stays intact). Used with parsimony.
export interface OnHitStatus {
  kind: StatusKind; // 'slow' (speed factor) | 'dot' (bleed) | 'stun' | ...
  chance: number; // 0..1 chance to apply per landed bite
  durationSecs: number;
  magnitude?: number; // slow: speed factor in (0,1); dot: damage per application
  periodSecs?: number; // dot: seconds between damage applications
}

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
  // Per-species behavior (optional; omitted == the baseline melee wolf). The sim
  // defaults these to ENEMY_SPEED / MELEE_RANGE, so leaving them off reproduces the
  // original wolf exactly.
  speed?: number; // chase/wander units/sec (default ENEMY_SPEED)
  attackRange?: number; // reach to strike (default MELEE_RANGE); a ranged species stands off at ~this distance
  spawnWeight?: number; // relative spawn frequency among the species roster (default 1)
  onHit?: OnHitStatus; // optional status this species inflicts on the player when it bites
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
  spawnWeight: 5, // the most common species — the world stays wolf-led but varied
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

// --- Humanoid species (reuse the KayKit Adventurer models already on disk; they
// share Rig_Medium, so they animate with the same Idle/Walk clips as the wolves).
// Each is its own template with distinct stats AND behavior; the tier system
// (normal/champion/elite) still layers on top. Numbers are provisional — grounded
// loosely against the base wolf (40 HP / 6 dmg), tune by playing.

// A tanky, slow-moving brute that hits hard and is a real wall of HP.
export const BRUTE_TEMPLATE: EnemyTemplate = {
  id: 'brute',
  name: 'Bruto Saqueador',
  hp: 110,
  xp: 60,
  sp: 8,
  goldMin: 6,
  goldMax: 18,
  str: 14, // meleeDamage(14,4) = 11 per blow — a heavy hit
  weaponDamage: 4,
  swingTime: 2.6, // slow, telegraphed swings
  aggroRadius: 8,
  leashRadius: 16,
  speed: 1.7, // lumbering — easy to kite, dangerous up close
  spawnWeight: 2,
  drops: [
    { itemId: 'wolf_leather', chance: 0.45 },
    { itemId: 'health_potion', chance: 0.3 },
    { itemId: 'iron_spear', chance: 0.06 }, // the brute carries a spear (a way to farm into the Lança mastery)
    { itemId: 'lucky_powder', chance: 0.2 },
    { itemId: 'elixir_armor', chance: 0.16 },
  ],
};

// A fast, frail bandit: quick frequent bites, low HP, carries coin.
export const BANDIT_TEMPLATE: EnemyTemplate = {
  id: 'bandit',
  name: 'Bandido',
  hp: 26,
  xp: 18,
  sp: 3,
  goldMin: 3,
  goldMax: 12, // bandits drop a bit more coin
  str: 6, // meleeDamage(6,2) = 5 per nick
  weaponDamage: 2,
  swingTime: 1.4, // fast, pecking attacks
  aggroRadius: 9,
  leashRadius: 18,
  speed: 3.3, // quick — closes the gap and chases hard
  spawnWeight: 3,
  drops: [
    { itemId: 'health_potion', chance: 0.3 },
    { itemId: 'old_sword', chance: 0.05 },
    { itemId: 'lucky_powder', chance: 0.2 },
    { itemId: 'elixir_weapon', chance: 0.14 },
  ],
};

// A ranged renegade archer: notices from afar, stands off and shoots instead of
// closing to melee (attackRange >> MELEE_RANGE makes the AI hold its distance).
export const ARCHER_TEMPLATE: EnemyTemplate = {
  id: 'archer',
  name: 'Arqueiro Renegado',
  hp: 34,
  xp: 32,
  sp: 5,
  goldMin: 4,
  goldMax: 12,
  str: 7, // meleeDamage(7,3) = 6 per shot
  weaponDamage: 3,
  swingTime: 2.2, // a measured draw between shots
  aggroRadius: 12, // spots you from range
  leashRadius: 22,
  speed: 2.2,
  attackRange: 11, // shoots from afar — holds distance rather than charging in
  spawnWeight: 2,
  drops: [
    { itemId: 'health_potion', chance: 0.25 },
    { itemId: 'short_bow', chance: 0.06 }, // drops a bow (a way to farm into the Arco mastery)
    { itemId: 'lucky_powder', chance: 0.2 },
    { itemId: 'elixir_weapon', chance: 0.14 },
  ],
};

// A fast, bursty assassin: closes quickly and hits hard for its low HP.
export const ASSASSIN_TEMPLATE: EnemyTemplate = {
  id: 'assassin',
  name: 'Assassino Encapuzado',
  hp: 30,
  xp: 34,
  sp: 6,
  goldMin: 4,
  goldMax: 14,
  str: 11, // meleeDamage(11,3) = 8 per strike — punchy for a glass cannon
  weaponDamage: 3,
  swingTime: 1.8,
  aggroRadius: 9,
  leashRadius: 16,
  speed: 3.0, // darts in
  spawnWeight: 2,
  // A bleeding wound: a small damage-over-time on a successful strike (parsimonious —
  // ~6 total over 3s, occasional). Thematic for an assassin; never one-shots.
  onHit: { kind: 'dot', chance: 0.3, durationSecs: 3, magnitude: 2, periodSecs: 1 },
  drops: [
    { itemId: 'health_potion', chance: 0.25 },
    { itemId: 'old_sword', chance: 0.06 },
    { itemId: 'lucky_powder', chance: 0.22 },
    { itemId: 'elixir_weapon', chance: 0.14 },
    { itemId: 'elixir_armor', chance: 0.14 },
  ],
};

// The species roster used for spawning. A spawn rolls one by spawnWeight via the
// sim's dedicated speciesRng (an independent substream, like the tier roll), so
// adding variety never perturbs the main loot/position Rng.
export const ENEMY_SPECIES: EnemyTemplate[] = [
  ENEMY_TEMPLATE,
  BRUTE_TEMPLATE,
  BANDIT_TEMPLATE,
  ARCHER_TEMPLATE,
  ASSASSIN_TEMPLATE,
];

// Fast lookup by species id (for loot/stat resolution on kill and for the AI).
export const SPECIES_BY_ID: Record<string, EnemyTemplate> = Object.fromEntries(
  ENEMY_SPECIES.map((s) => [s.id, s]),
);

const SPECIES_WEIGHT_TOTAL = ENEMY_SPECIES.reduce((s, t) => s + (t.spawnWeight ?? 1), 0);

// Pick a species from a roll in [0,1) by spawnWeight. Pure (the sim supplies the
// roll), mirroring pickEnemyTier — keeps content Rng-free and deterministic.
export function pickSpecies(roll: number): EnemyTemplate {
  const target = roll * SPECIES_WEIGHT_TOTAL;
  let acc = 0;
  for (const t of ENEMY_SPECIES) {
    acc += t.spawnWeight ?? 1;
    if (target < acc) return t;
  }
  return ENEMY_SPECIES[0];
}

export const ENEMY_COUNT = 12;

// Per-LEVEL scaling (GDD v0.3 §G3: "mobs por nível"). A mob's level comes from its zone
// (ring): level 1 = the base template (no change), and deeper rings (higher level) are
// tougher and more rewarding. Pure (the sim supplies the level), so content stays Rng-free.
// Provisional curves — gentle, tune by playing. Level 1 always returns 1 (so the nearest
// ring behaves exactly like the old baseline mobs).
export function levelHpMult(level: number): number {
  return 1 + 0.6 * (Math.max(1, level) - 1); // L1 1x · L2 1.6x · L4 2.8x · L10 6.4x
}
export function levelDamageMult(level: number): number {
  return 1 + 0.35 * (Math.max(1, level) - 1); // L1 1x · L2 1.35x · L4 2.05x · L10 4.15x
}
export function levelRewardMult(level: number): number {
  return 1 + 0.5 * (Math.max(1, level) - 1); // XP/SP/gold: L1 1x · L2 1.5x · L4 2.5x · L10 5.5x
}

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
