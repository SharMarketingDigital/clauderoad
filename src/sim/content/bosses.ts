// Data-as-code world boss (Silkroad-"unique" flavor). First slice: it exists,
// spawns on a tick timer at a fixed point, announces, and drops good loot. The
// minion-summon mechanic is a later slice. Numbers are provisional.
import type { DropEntry } from './enemies';
import type { RarityDef } from './rarity';

export interface BossTemplate {
  id: string;
  name: string;
  hp: number;
  xp: number;
  // "Hits harder" — stored now, but inert until enemies can damage the player
  // (a later slice). Kept as data so that slice just wires it up.
  str: number;
  weaponDamage: number;
  goldMin: number;
  goldMax: number;
  drops: DropEntry[];
  rarities: RarityDef[]; // boss loot rolls on THIS (far more generous) table
  // Minion summons: at each HP fraction (high -> low) the boss calls a wave of
  // `minionCount` minions. Each threshold fires once per boss life.
  summonThresholds: number[];
  minionCount: number;
  minionName: string;
  minionHp: number;
}

// Boss loot rolls on a much more generous rarity table than common mobs (see
// rarity.ts). Only `dropWeight`/`id` matter for the roll; `statMultiplier`
// mirrors the global table (equipped scaling always uses the global one).
export const BOSS_RARITIES: RarityDef[] = [
  { id: 'normal', name: 'Normal', dropWeight: 0.4, statMultiplier: 1.0 },
  { id: 'sos', name: 'SOS', dropWeight: 0.35, statMultiplier: 1.5 },
  { id: 'som', name: 'SOM', dropWeight: 0.18, statMultiplier: 2.0 },
  { id: 'sun', name: 'SUN', dropWeight: 0.07, statMultiplier: 3.0 },
];

export const BOSS_TEMPLATE: BossTemplate = {
  id: 'pack_alpha',
  name: 'Alfa da Matilha',
  hp: 800, // ~20x a common wolf (40)
  xp: 500,
  str: 60,
  weaponDamage: 30,
  goldMin: 50,
  goldMax: 150,
  drops: [
    { itemId: 'old_sword', chance: 0.8 },
    { itemId: 'wolf_leather', chance: 0.9 },
    { itemId: 'lucky_powder', chance: 0.9 },
    { itemId: 'elixir_weapon', chance: 0.6 },
    { itemId: 'elixir_armor', chance: 0.6 },
  ],
  rarities: BOSS_RARITIES,
  summonThresholds: [0.75, 0.5, 0.25],
  minionCount: 3,
  minionName: 'Lobo da Matilha',
  minionHp: 60, // a bit beefier than a common wolf (40)
};

// How far from the boss its summoned minions appear.
export const MINION_SPAWN_RADIUS = 3;

// Fixed spawn point in the zone, and timing in TICKS (20 = 1s; deterministic —
// never wall-clock). First boss ~2.5 min in; respawns ~3 min after death.
export const BOSS_SPAWN_X = 0;
export const BOSS_SPAWN_Z = 30;
export const BOSS_FIRST_SPAWN_TICK = 150 * 20; // first boss ~2.5 min into the session
export const BOSS_RESPAWN_TICKS = 3 * 60 * 20;
