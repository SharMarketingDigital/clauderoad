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
  // Per-species behavior (optional; omitted == the baseline melee minion). The sim
  // defaults these to ENEMY_SPEED / MELEE_RANGE, so leaving them off reproduces the
  // baseline skeleton exactly.
  speed?: number; // chase/wander units/sec (default ENEMY_SPEED)
  attackRange?: number; // reach to strike (default MELEE_RANGE); a ranged species stands off at ~this distance
  onHit?: OnHitStatus; // optional status this species inflicts on the player when it bites
}

// --- The skeleton bestiary (KayKit Skeletons, Rig_Medium — the SAME rig as the player,
// so the one set of Idle/Walk clips and the procedural attack swing animate them at no
// extra cost). ONE species per ring (GDD v0.3 §G3 / Silkroad: every area has its own
// creature): ring1 → Lacaio, ring2 → Ladino, ring4 → Guerreiro, ring10 → Mago. The
// per-level scaling (levelHpMult/…) and the normal/champion/elite tier system layer on
// top, so the ring-10 Mago is far deadlier than the ring-1 Lacaio even where the base
// stats are close. Numbers are provisional — grounded loosely against the base (40 HP /
// 6 dmg); tune by playing.

// Ring 1 (level 1) — the starter skeleton by the town. This is the BASE template and the
// determinism-critical species: its stats define the level-1 baseline the tests pin to,
// and it carries NO on-hit debuff (kept clean on purpose). Stats are the original
// starter mob's, unchanged — so the level-1 progression numbers stay exact.
export const ENEMY_TEMPLATE: EnemyTemplate = {
  id: 'skeleton_minion',
  name: 'Esqueleto Lacaio',
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
    { itemId: 'health_potion', chance: 0.25 },
    // alchemy materials (rare-ish, so upgrading is a real choice)
    { itemId: 'elixir_weapon', chance: 0.1 },
    { itemId: 'elixir_armor', chance: 0.1 },
    // Sistema 3 (gear-por-anel) — anel 1 (interno) dropa GRAU 1: kit de couro + armas base de corpo-a-corpo.
    { itemId: 'wolf_leather', chance: 0.3 }, // peito g1 (signature)
    { itemId: 'leather_cap', chance: 0.1 }, // capacete g1
    { itemId: 'leather_gloves', chance: 0.08 }, // luvas g1
    { itemId: 'old_sword', chance: 0.05 }, // arma g1 (Espada)
    { itemId: 'iron_spear', chance: 0.05 }, // arma g1 (Lança)
  ],
};

// Ring 2 (level 2) — a fast, frail skeleton that pecks quickly and leaves a bleeding wound
// (a small DoT on a successful strike — parsimonious, ~6 over 3s, occasional). Inherits the
// old assassin's debuff role; thematic for a Ladino (rogue).
export const ROGUE_TEMPLATE: EnemyTemplate = {
  id: 'skeleton_rogue',
  name: 'Esqueleto Ladino',
  hp: 30,
  xp: 20,
  sp: 4,
  goldMin: 3,
  goldMax: 12,
  str: 7, // meleeDamage(7,2) = 5 per nick
  weaponDamage: 2,
  swingTime: 1.6, // fast, pecking attacks
  aggroRadius: 9,
  leashRadius: 18,
  speed: 3.0, // darts in
  onHit: { kind: 'dot', chance: 0.3, durationSecs: 3, magnitude: 2, periodSecs: 1 },
  drops: [
    { itemId: 'health_potion', chance: 0.3 },
    { itemId: 'elixir_weapon', chance: 0.12 },
    { itemId: 'elixir_armor', chance: 0.1 },
    // Sistema 3 — anel 2 (interno) dropa GRAU 1: completa o set de couro + armas base ranged + acessórios g1.
    { itemId: 'leather_pants', chance: 0.1 }, // calça g1
    { itemId: 'leather_boots', chance: 0.08 }, // botas g1
    { itemId: 'wooden_shield', chance: 0.07 }, // escudo g1
    { itemId: 'short_bow', chance: 0.05 }, // arma g1 (Arco)
    { itemId: 'apprentice_staff', chance: 0.05 }, // arma g1 (Mago)
    { itemId: 'copper_necklace', chance: 0.05 }, // colar g1
    { itemId: 'copper_earring', chance: 0.05 }, // brinco g1
    { itemId: 'copper_ring', chance: 0.05 }, // anel g1
  ],
};

// Ring 4 (level 4) — a tanky, slow-moving warrior: a wall of HP that hits hard. Lumbering
// (easy to kite, dangerous up close). Inherits the old brute's profile.
export const WARRIOR_TEMPLATE: EnemyTemplate = {
  id: 'skeleton_warrior',
  name: 'Esqueleto Guerreiro',
  hp: 70,
  xp: 45,
  sp: 6,
  goldMin: 6,
  goldMax: 18,
  str: 12, // meleeDamage(12,4) = 10 per blow — a heavy hit
  weaponDamage: 4,
  swingTime: 2.4, // slow, telegraphed swings
  aggroRadius: 8,
  leashRadius: 16,
  speed: 2.0, // lumbering
  drops: [
    { itemId: 'health_potion', chance: 0.3 },
    { itemId: 'elixir_weapon', chance: 0.14 },
    { itemId: 'elixir_armor', chance: 0.14 },
    // Sistema 3 — anel 4 (médio) dropa GRAU 2 (malha + prata): a escada g2 completa (reqLevel 4).
    { itemId: 'chain_vest', chance: 0.2 }, // peito g2 (signature)
    { itemId: 'studded_cap', chance: 0.06 }, // capacete g2
    { itemId: 'chain_gloves', chance: 0.05 }, // luvas g2
    { itemId: 'chain_leggings', chance: 0.05 }, // calça g2
    { itemId: 'chain_boots', chance: 0.05 }, // botas g2
    { itemId: 'iron_shield', chance: 0.05 }, // escudo g2
    { itemId: 'iron_sword', chance: 0.04 }, // arma g2 (Espada)
    { itemId: 'steel_spear', chance: 0.04 }, // arma g2 (Lança)
    { itemId: 'hunters_bow', chance: 0.04 }, // arma g2 (Arco)
    { itemId: 'adept_staff', chance: 0.04 }, // arma g2 (Mago)
    { itemId: 'silver_necklace', chance: 0.04 }, // colar g2
    { itemId: 'silver_earring', chance: 0.04 }, // brinco g2
    { itemId: 'silver_ring', chance: 0.04 }, // anel g2
  ],
};

// Ring 10 (level 10) — a ranged caster skeleton: notices from afar and stands off to fling
// instead of closing (attackRange >> MELEE_RANGE makes the AI hold its distance). Deep-ring
// common; level scaling makes it the deadliest common mob in the world.
export const MAGE_TEMPLATE: EnemyTemplate = {
  id: 'skeleton_mage',
  name: 'Esqueleto Mago',
  hp: 40,
  xp: 55,
  sp: 8,
  goldMin: 4,
  goldMax: 14,
  str: 9, // meleeDamage(9,4) = 8 per cast
  weaponDamage: 4,
  swingTime: 2.2,
  aggroRadius: 12, // spots you from range
  leashRadius: 22,
  speed: 2.2,
  attackRange: 11, // casts from afar — holds distance rather than charging in
  drops: [
    { itemId: 'health_potion', chance: 0.25 },
    { itemId: 'elixir_weapon', chance: 0.14 },
    { itemId: 'elixir_armor', chance: 0.14 },
    // Sistema 3 — anel 10 (externo) dropa GRAU 3 (placas + ouro): a escada g3 completa (reqLevel 8).
    { itemId: 'plate_armor', chance: 0.18 }, // peito g3 (signature)
    { itemId: 'plate_helm', chance: 0.05 }, // capacete g3
    { itemId: 'plate_gauntlets', chance: 0.04 }, // luvas g3
    { itemId: 'plate_legs', chance: 0.04 }, // calça g3
    { itemId: 'plate_boots', chance: 0.04 }, // botas g3
    { itemId: 'tower_shield', chance: 0.04 }, // escudo g3
    { itemId: 'steel_sword', chance: 0.03 }, // arma g3 (Espada)
    { itemId: 'halberd', chance: 0.03 }, // arma g3 (Lança)
    { itemId: 'composite_bow', chance: 0.03 }, // arma g3 (Arco)
    { itemId: 'sorcerer_staff', chance: 0.03 }, // arma g3 (Mago)
    { itemId: 'gold_necklace', chance: 0.03 }, // colar g3
    { itemId: 'gold_earring', chance: 0.03 }, // brinco g3
    { itemId: 'gold_ring', chance: 0.03 }, // anel g3
  ],
};

// The species roster (one per ring). Drives the lookup by id and the "every spawned mob is
// a known species" test. Spawning no longer ROLLS a species — each ring spawns its own (see
// SPECIES_BY_LEVEL / speciesForLevel), so there is no spawn-weight and no species Rng.
export const ENEMY_SPECIES: EnemyTemplate[] = [
  ENEMY_TEMPLATE,
  ROGUE_TEMPLATE,
  WARRIOR_TEMPLATE,
  MAGE_TEMPLATE,
];

// Fast lookup by species id (for loot/stat resolution on kill and for the AI).
export const SPECIES_BY_ID: Record<string, EnemyTemplate> = Object.fromEntries(
  ENEMY_SPECIES.map((s) => [s.id, s]),
);

// The deterministic anel→espécie map (GDD v0.3 §G3 / Silkroad: every area has its own
// creature), keyed by the zone's LEVEL (see zones.ts ZoneDef.level: 1, 2, 4, 10).
export const SPECIES_BY_LEVEL: Record<number, EnemyTemplate> = {
  1: ENEMY_TEMPLATE, // ring1 Campina — Esqueleto Lacaio
  2: ROGUE_TEMPLATE, // ring2 Bosque — Esqueleto Ladino
  4: WARRIOR_TEMPLATE, // ring4 Terras Selvagens — Esqueleto Guerreiro
  10: MAGE_TEMPLATE, // ring10 Ermo Profundo — Esqueleto Mago
};

// The species a ring spawns, by its level. Pure (no Rng): the ring fixes the species, so
// spawning stays deterministic without any species roll. Unmapped levels fall back to the
// base Lacaio (defensive — every current ring level is mapped).
export function speciesForLevel(level: number): EnemyTemplate {
  return SPECIES_BY_LEVEL[level] ?? ENEMY_TEMPLATE;
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
