// Data-as-code world bosses (Silkroad-"unique" flavor). The sim runs a REGISTRY of
// boss definitions (BOSS_DEFS) — each with its own template, spawn point, timers,
// loot, summon behavior, and whether it holds its ground or chases. Adding a boss is
// just another entry here; the sim loops over the registry. Numbers are provisional.
import type { DropEntry, OnHitStatus } from './enemies';
import type { RarityDef } from './rarity';

// Stats / loot / summon shape of ONE boss. Placement, timing and movement live on
// the BossDef wrapper below (so the same template could be reused at another spot).
export interface BossTemplate {
  id: string;
  name: string;
  hp: number;
  xp: number;
  sp: number; // SP awarded to the killer (GDD B4) — a big lump, like its XP/gold
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
  // Combat: bites HARD in melee every `swingTime`s. aggro/leash mirror the enemy
  // fields (leashRadius is large; for a rooted boss it never moves from its spawn).
  swingTime: number;
  aggroRadius: number;
  leashRadius: number;
  onHit?: OnHitStatus; // optional status the boss inflicts on the player when it bites
}

// One boss IN the world: its template plus where/when it spawns and how it behaves.
// `rooted` bosses hold their ground and tank in place (the Alfa); non-rooted ones
// CHASE the nearest player at `speed`. Bosses never wander (so they stay Rng-free and
// can't perturb the deterministic loot/position stream — important for determinism).
export interface BossDef {
  template: BossTemplate;
  spawnX: number;
  spawnZ: number;
  firstSpawnTick: number; // first appearance (deterministic ticks; 20 = 1s)
  respawnTicks: number; // delay after death before it returns
  rooted: boolean; // true = holds ground; false = chases the player
  speed: number; // chase speed (units/sec) for a non-rooted boss; ignored if rooted
  minionSpawnRadius: number; // how far from the boss its summoned minions appear
  minionSpecies: string; // render-species id for the summoned minions (model choice)
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

// --- Boss #1: the Pack Alpha — a rooted wolf boss that summons wolf minions. ---
export const BOSS_TEMPLATE: BossTemplate = {
  id: 'pack_alpha',
  name: 'Alfa da Matilha',
  hp: 800, // ~20x a common wolf (40)
  xp: 500,
  sp: 60, // a big skill-point payout — beating the boss noticeably advances a kit

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
  swingTime: 2.5, // bites slower but for meleeDamage(60,30) = 60 — ~10x a common wolf
  aggroRadius: 12,
  leashRadius: 40,
  // A brief, occasional stun — the Alfa's bite staggers you (interrupts a beat),
  // so the summoned wolves get a window. Short + rare, so it's a threat, not a lock.
  onHit: { kind: 'stun', chance: 0.18, durationSecs: 0.5 },
};

// --- Boss #2: the Warlord — a MOVING melee boss that hunts you down and calls in
// mercenary bandits. A different fight from the rooted Alfa: you can kite it, but it
// summons fast adds, so you can't just run forever. ---
export const WARLORD_TEMPLATE: BossTemplate = {
  id: 'warlord',
  name: 'Senhor da Guerra',
  hp: 700,
  xp: 560,
  sp: 66,

  str: 50,
  weaponDamage: 28, // meleeDamage(50,28) = 53 per blow
  goldMin: 60,
  goldMax: 170,
  drops: [
    { itemId: 'iron_spear', chance: 0.7 }, // the warlord's reach weapon
    { itemId: 'old_sword', chance: 0.6 },
    { itemId: 'wolf_leather', chance: 0.9 },
    { itemId: 'lucky_powder', chance: 0.9 },
    { itemId: 'elixir_weapon', chance: 0.7 },
    { itemId: 'elixir_armor', chance: 0.7 },
  ],
  rarities: BOSS_RARITIES,
  summonThresholds: [0.7, 0.4], // two mercenary waves
  minionCount: 4,
  minionName: 'Mercenário',
  minionHp: 70,
  swingTime: 2.2, // hits a touch faster than the Alfa
  aggroRadius: 14, // spots you from farther (it hunts)
  leashRadius: 45,
  // A hamstring: a moderate slow so you can't simply kite the Warlord forever while
  // its mercenaries close in. Half speed for a couple of seconds, ~1 bite in 3.
  onHit: { kind: 'slow', chance: 0.35, durationSecs: 2, magnitude: 0.5 },
};

// Alfa placement/timing — kept as named constants (tests + the registry reference them).
export const MINION_SPAWN_RADIUS = 3; // how far the Alfa's minions appear
export const BOSS_SPAWN_X = 0;
export const BOSS_SPAWN_Z = 50; // just outside the central safe-zone (cheb <= 30), in the first ring
export const BOSS_FIRST_SPAWN_TICK = 150 * 20; // first Alfa ~2.5 min into the session
export const BOSS_RESPAWN_TICKS = 3 * 60 * 20; // ~3 min after death

// The registry the sim iterates. Each boss spawns/respawns independently. The Warlord
// appears later and far across the map, so the two never share a spot or a schedule.
export const BOSS_DEFS: BossDef[] = [
  {
    template: BOSS_TEMPLATE,
    spawnX: BOSS_SPAWN_X,
    spawnZ: BOSS_SPAWN_Z,
    firstSpawnTick: BOSS_FIRST_SPAWN_TICK,
    respawnTicks: BOSS_RESPAWN_TICKS,
    rooted: true,
    speed: 0,
    minionSpawnRadius: MINION_SPAWN_RADIUS,
    minionSpecies: 'skeleton_minion', // summoned skeleton minions (model + stat baseline)
  },
  {
    template: WARLORD_TEMPLATE,
    spawnX: -40,
    spawnZ: -40, // a far corner, well away from the Alfa (0,30) and the hub
    firstSpawnTick: 300 * 20, // ~5 min in — appears after the Alfa
    respawnTicks: 4 * 60 * 20, // ~4 min after death
    rooted: false, // it CHASES
    speed: 3.2, // faster than a common mob (2.4), still kiteable by the player (6)
    minionSpawnRadius: 4,
    minionSpecies: 'skeleton_rogue', // summoned skeleton rogues (model + stat baseline)
  },
];

// Fast lookup by boss id (the boss entity's `species` field carries this id).
export const BOSS_DEF_BY_ID: Record<string, BossDef> = Object.fromEntries(
  BOSS_DEFS.map((d) => [d.template.id, d]),
);
