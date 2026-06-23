// The deterministic game core — the single source of truth.
//
// INVARIANTS (do not break):
//   * Zero DOM / browser / Three.js imports here.
//   * Fixed 20 Hz tick. Same seed + same command stream => identical world.
//   * All randomness goes through Rng. Never Math.random / Date.now /
//     performance.now in this file.
//
// Offline, the client runs a Sim locally. Online (future), the authoritative
// server runs ONE Sim for everyone and the client mirrors snapshots.

import { Rng } from './rng';
import { applyMove } from './movement';
import { type Party, maxPartySize, eachGetBonus, PARTY_SHARE_RANGE } from './party';
import type { Entity, ItemStack } from './types';
import type {
  IWorld, EntityView, Command, SimEvent, AbilityView, InventoryView, ShopView, EquipSlot, Rarity,
  StatusKind, DamageType, PartyView, PartyInviteView, PartyExpMode, PartyLootMode,
} from '../world_api';
import { CLASSES, PLAYER_CLASS_BY_ID } from './content/classes';
import {
  ENEMY_TEMPLATE, ENEMY_TIERS, pickEnemyTier, pickSpecies, SPECIES_BY_ID,
  levelHpMult, levelDamageMult, levelRewardMult,
} from './content/enemies';
import { SPAWN_ZONES, WORLD_HALF, zoneAt, type SpawnSpot } from './zones';
import { MASTERIES, DEFAULT_MASTERY, type AbilityDef, type MasteryDef } from './content/abilities';
import { ITEMS, POTION_COOLDOWN_SECS } from './content/items';
import { RARITIES, type RarityDef } from './content/rarity';
import { BOSS_DEFS, BOSS_DEF_BY_ID, type BossDef } from './content/bosses';
import {
  MAX_PLUS, ENHANCE_SUCCESS, LUCKY_POWDER_BONUS, ENHANCE_CHANCE_CAP, ENHANCE_STAT_PER_PLUS,
} from './content/enhance';
import {
  SKILL_MAX_RANK, skillUpgradeCost, rankEffectMult,
} from './content/skill_ranks';
// Combat (generation + mitigation) lives in ONE module — it's 100% Gabriel's in v0.3,
// so the old offense/defense split has no purpose. The sim only composes the two halves:
// final = combat.mitigate({ hit: combat.compute(...), target }). See combat.ts.
import * as combat from './combat';
import type { Damage } from './combat';
// Back-compat: these pure helpers live IN combat; re-export so existing importers
// (tests, content) keep `import { meleeDamage, ... } from '../sim/sim'` working unchanged.
export { STR_TO_DAMAGE, meleeDamage, CRIT_MULT, abilityDamage } from './combat';
import {
  MAX_DURABILITY, DEATH_DURABILITY_LOSS, DURABILITY_WORN_AT, durabilityFactor, repairCost,
} from './content/durability';
import { BAG_SLOTS, addToBag, removeFromBag } from './inventory';
import { toSave, applySave, type PlayerSave } from './save';
import {
  VENDOR_NAME, VENDOR_SPAWN_X, VENDOR_SPAWN_Z, VENDOR_INTERACT_RANGE, VENDOR_STOCK,
} from './content/vendor';

const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'armor'];

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE; // seconds per tick
// The world half-extent comes from the zone model now (the outermost ring's edge -> a
// 300x300 world). Re-exported so every existing importer (render, ui, tests) keeps
// getting WORLD_HALF from sim unchanged.
export { WORLD_HALF };

export const PLAYER_SPEED = 6; // units/sec (also reused by the authoritative server)
export const ENEMY_SPEED = 2.4; // units/sec
export const MELEE_RANGE = 2.5; // units; provisional melee reach (player + enemy radius + a little)
const CONTACT_DIST = 1.0; // within this the bodies overlap; don't require facing to swing
const SPAWN_JITTER = 2; // mobs spawn within ±this of their ring spot (a tight pack, well inside the ring)
const WANDER_RADIUS = 12; // idle mobs wander within ±this of their current spot (roam the ring, not the world)
const MOBS_PER_SPOT = 3; // a small pack at each spawn anchor (so AoE/cone abilities have clusters to hit)
// Total starting mobs = (spots across all rings) x MOBS_PER_SPOT. Exported for tests.
export const STARTING_ENEMY_COUNT = SPAWN_ZONES.reduce((n, z) => n + z.spots.length, 0) * MOBS_PER_SPOT;
// Highest action-bar slot any mastery uses — the hash fingerprints cooldowns for
// slots 1..N so it stays complete regardless of which kit is active.
const MAX_ABILITY_SLOTS = 8;
export const RESPAWN_TICKS = 15 * TICK_RATE; // ~15s after death a same-type enemy respawns
// ~5s as a spirit before respawn — the early-WoW "cheap death + corpse run" model.
// PROVISIONAL: the GDD B8 penalty (gear-durability loss, a real graveyard revive) is
// deliberately deferred; today the wait is the only cost (see respawnPlayer).
export const DEATH_RESPAWN_TICKS = 5 * TICK_RATE;
const PLAYER_SPAWN_X = 0; // the "graveyard"/safe point a downed player wakes up at
const PLAYER_SPAWN_Z = 0;
// ---------- auto-play bot tuning (all deterministic; priority: SURVIVE > EVOLVE) ----------
// Survival
export const BOT_HEAL_FRAC = 0.4; // drink a Health Potion below this fraction of max HP
const BOT_CAUTION_FRAC = 0.6; // below this, play safe: normal mobs only, avoid pulling a pack
const BOT_FLEE_RADIUS = 11; // with no usable potion, back away from threats this close
// Build (attribute spend): Força-first, with a little Intelligence for a usable MP pool
const BOT_INT_TARGET_MP = 130; // invest INT until maxMp reaches this, then pour into STR
const BOT_SPEND_MP_FRAC = 0.5; // on trivial foes, only spend MP on abilities while above this
// Inventory & vendor
const BOT_BAG_HEADROOM = 3; // make a vendor run to sell once free bag slots drop to this
const BOT_POTION_STOCK = 5; // restock Health Potions up to this many
const BOT_GOLD_RESERVE = 80; // keep at least this much gold for non-essential (material) buys
// Alchemy (enhance): refine equipped gear with spare materials, always keep a reserve
export const BOT_MATERIAL_RESERVE = 2; // never spend an Elixir / Lucky Powder below this count
const BOT_ENHANCE_SAFE_RADIUS = 11; // only enhance during a lull (nearest enemy beyond this)
const BOT_LUCKY_BELOW_CHANCE = 0.7; // spend a Lucky Powder only when base success dips under this
// Target selection: braver as it levels up
const BOT_CHAMPION_MIN_LEVEL = 3;
const BOT_ELITE_MIN_LEVEL = 5;
const BOT_BOSS_MIN_LEVEL = 8;
const BOT_BOSS_MIN_POTIONS = 3; // attempt the world boss only with a stock of potions
const BOT_CLUSTER_RADIUS = 6; // other enemies within this of a candidate form a "cluster"
const BOT_CLUSTER_PENALTY = 100; // when cautious, bias away from clustered targets (units²)
export const EVENT_TTL_TICKS = TICK_RATE; // keep presentation events ~1s for the renderer
export const GCD_TICKS = Math.round(1.5 * TICK_RATE); // 1.5s global cooldown between abilities
export const POTION_COOLDOWN_TICKS = Math.round(POTION_COOLDOWN_SECS * TICK_RATE); // shared "potion sickness"

// Progression (provisional — GDD §B4b: GENTLE, rewarding pacing; NOT Silkroad's
// brutal grind). Per level-up: +HP/+MP max and +5 attribute points.
export const HP_PER_LEVEL = 20;
export const MP_PER_LEVEL = 15;
export const ATTR_POINTS_PER_LEVEL = 5;
// Spending one attribute point: Strength moves by 2 (a clean +1 melee damage,
// since meleeDamage floors str*0.5), Intelligence by 1 for +MP_PER_INT max MP.
export const ATTR_STR_PER_POINT = 2;
export const ATTR_INT_PER_POINT = 1;
export const MP_PER_INT = 5;
// XP needed to go from `level` to level+1. Integer curve (no Math.pow, so it's
// bit-exact across engines): 25·L·(L+1) => L1:50, L2:150, L3:300, L4:500...
// With a 25-XP wolf that's ~2 kills for level 2, ramping gently after.
export function xpForLevel(level: number): number {
  return 25 * level * (level + 1);
}

// Party (social) commands — applied even when a player's auto-play (bot) is ON, since
// auto-play owns only combat + movement, not the player's group membership.
const PARTY_COMMANDS: ReadonlySet<Command['t']> = new Set([
  'party-create', 'party-invite', 'party-accept', 'party-refuse', 'party-leave', 'party-kick', 'party-admit',
]);

export class Sim implements IWorld {
  tick = 0;

  private rng: Rng;
  private tierRng: Rng; // independent substream for enemy-tier rolls (see constructor)
  private speciesRng: Rng; // independent substream for enemy-species rolls (see constructor)
  private procRng: Rng; // independent substream for enemy on-hit status procs (see constructor)
  private spawnRng: Rng; // independent substream for zone spawn POSITIONS (see constructor)
  private partyRng: Rng; // independent substream for party loot auto-share recipient picks (see constructor)
  private ents = new Map<number, Entity>();
  private nextId = 1;
  private localId: number;
  // MULTIPLAYER: the sim supports N players (the server runs ONE shared world). Each
  // player has its OWN held movement intent + queued one-shot actions, keyed by id.
  // `playerIds` is the deterministic (join-order) iteration list. Single-player has a
  // single entry (the local player), so the offline behavior is bit-identical.
  private moveIntents = new Map<number, Command>();
  private pendings = new Map<number, Command[]>();
  private playerIds: number[] = [];
  // Party (co-op, GDD B6). Authoritative party state lives HERE in the deterministic
  // sim (mutated only by commands), so XP/loot distribution can run inside killEnemy.
  // Offline single-player never issues party commands, so these stay empty and the
  // determinism/hash is unchanged. (XP/loot effects arrive in later sub-fatias.)
  private nextPartyId = 1;
  private parties = new Map<number, Party>(); // partyId -> party
  private partyOfPlayer = new Map<number, number>(); // playerId -> partyId (absent = solo)
  private pendingInvites = new Map<number, { fromId: number; partyId: number }>(); // inviteeId -> invite
  // Ticks at which a dead enemy should respawn (FIFO; processed each tick).
  private respawnQueue: { at: number; zone: number }[] = []; // {when, which ring} to refill
  // World bosses: one runtime slot per entry in BOSS_DEFS (same order). Each tracks
  // the live entity id (null when dead), the tick its next spawn is due (Infinity
  // while alive), and how many summon waves it has fired this life. Tick-driven; no Rng.
  private bossState = BOSS_DEFS.map((d) => ({ entityId: null as number | null, spawnAt: d.firstSpawnTick, summonsFired: 0 }));
  // Recent presentation events (damage numbers, hit flashes). Bounded by age
  // (EVENT_TTL_TICKS) so it never grows unbounded; `seq` is monotonic forever.
  private events: SimEvent[] = [];
  private nextEventSeq = 1;

  // The town vendor NPC's entity id (a fixed, non-combat shopkeeper).
  private vendorId = 0;
  // Auto-play: the set of player ids whose bot is ON. The bot drives each of those
  // players (survive/evolve) through the SAME applyAction path a human's commands use,
  // and manual input from a bot-driven player is ignored. Per-player so the server can
  // run a bot for each client independently; single-player just has the one local id.
  private botPlayers = new Set<number>();

  // `spawnLocal` controls whether a local "Hero" player is created. Offline (and the
  // tests) keep the default — one local player, bit-identical to before. The SERVER
  // passes `false`: it has NO local player and instead adds networked players via
  // addPlayer(), so its world is purely the connected clients + the shared mobs.
  constructor(seed: number, spawnLocal = true) {
    this.rng = new Rng(seed);
    // Enemy tiers roll from an INDEPENDENT deterministic substream so adding the
    // feature doesn't reshuffle the main loot/position Rng — worlds stay comparable.
    this.tierRng = new Rng((seed ^ 0x9e3779b9) >>> 0);
    // Likewise, enemy SPECIES roll from their own substream, so a varied bestiary
    // doesn't reshuffle the main loot/position Rng either.
    this.speciesRng = new Rng((seed ^ 0x85ebca6b) >>> 0);
    // And enemy on-hit status PROCS roll from their own substream, so a mob/boss
    // debuffing the player never perturbs the main loot/position stream.
    this.procRng = new Rng((seed ^ 0xc2b2ae35) >>> 0);
    // And party LOOT auto-share picks its random recipient from its own substream, so
    // WHICH member gets an item never perturbs the main loot stream (the items that drop
    // are unchanged — only their owner differs).
    this.partyRng = new Rng((seed ^ 0x27d4eb2f) >>> 0);
    // And zone spawn POSITIONS roll from their own substream, so scattering mobs across
    // the rings never perturbs the main loot/position stream (determinism stays clean).
    this.spawnRng = new Rng((seed ^ 0x165667b1) >>> 0);
    if (spawnLocal) {
      this.localId = this.spawnPlayer('Hero');
      this.registerPlayer(this.localId);
    } else {
      this.localId = 0; // server world: no local player (clients join via addPlayer)
    }
    // Populate every ring (the central safe-zone stays empty): a baseline PACK at each
    // spawn spot, at that ring's level. Reinforcements (respawns) may roll tougher tiers.
    for (let zi = 0; zi < SPAWN_ZONES.length; zi++) {
      for (const spot of SPAWN_ZONES[zi].spots) {
        for (let k = 0; k < MOBS_PER_SPOT; k++) this.spawnEnemy(zi, spot, false);
      }
    }
    this.vendorId = this.spawnVendor(); // no Rng (fixed spot) -> doesn't perturb loot
  }

  // Wire up a player's per-player intent/command state and add it to the iteration
  // list. Used by the constructor (local player) and addPlayer (networked players).
  private registerPlayer(id: number): void {
    this.playerIds.push(id);
    this.moveIntents.set(id, { t: 'stop' });
    this.pendings.set(id, []);
  }

  // ---------- multiplayer (the SERVER drives these; offline never does) ----------
  // Add a networked player and return its id. Spawns are spread on a small ring (by
  // id) so two players don't stack on the same spot. Deterministic — no Rng (the ring
  // is a pure function of the id), so the shared world stays reproducible.
  addPlayer(name: string): number {
    const id = this.spawnPlayer(name);
    const p = this.ents.get(id)!;
    const a = id * 2.399963229728653; // golden angle -> an even, non-overlapping spread
    p.x = Math.cos(a) * 4;
    p.z = Math.sin(a) * 4;
    p.homeX = p.x;
    p.homeZ = p.z;
    this.registerPlayer(id);
    return id;
  }

  // Remove a networked player (on disconnect). Drops its per-player state and clears
  // any enemy that was aggroed on it, so no mob chases a ghost.
  removePlayer(id: number): void {
    // Leave any party first (promotes a new leader / dissolves a now-too-small party, and
    // cancels the player's outbound invites), then drop this player's OWN pending invite.
    this.removeFromParty(id);
    this.pendingInvites.delete(id);
    this.ents.delete(id);
    this.moveIntents.delete(id);
    this.pendings.delete(id);
    this.botPlayers.delete(id);
    const i = this.playerIds.indexOf(id);
    if (i >= 0) this.playerIds.splice(i, 1);
    for (const e of this.ents.values()) if (e.targetId === id) e.targetId = null;
  }

  // Route a networked player's command into the world (same validation path as the
  // local player's sendCommand). The client only ever sends intent; the sim decides.
  sendCommandFor(id: number, cmd: Command): void {
    this.routeCommand(id, cmd);
  }

  // The ids of all players currently in the world (server snapshot helper).
  players(): ReadonlyArray<number> {
    return this.playerIds;
  }

  // ---------- persistence (server only; offline single-player never calls these) ----------
  // Serialize a player's persistent progression (level/XP/attrs/SP/ranks/bag/equip/gold)
  // to a plain, JSON-safe object for the DB. READ-ONLY — pure data export, never touches
  // gameplay/RNG/tick, so it can't affect a same-seed simulation. Null for a missing id.
  serializePlayer(id: number): PlayerSave | null {
    const p = this.ents.get(id);
    return p && p.kind === 'player' ? toSave(p) : null;
  }

  // Restore a saved character onto a player (the server calls this on join, right after
  // addPlayer, when a save exists). `raw` is UNTRUSTED DB JSON: applySave validates every
  // field and keeps the fresh-spawn value for anything invalid, so a corrupt save can
  // never break the sim. Then derived stats are recomputed and HP/MP topped up. No RNG and
  // no gameplay change — determinism of a same-seed run is unaffected.
  restorePlayer(id: number, raw: unknown): void {
    const p = this.ents.get(id);
    if (!p || p.kind !== 'player') return;
    applySave(p, raw);
    this.recomputeStats(p);
    p.hp = p.maxHp;
    p.mp = p.maxMp;
  }

  // ---------- spawning ----------
  private spawnPlayer(name: string): number {
    const id = this.nextId++;
    const cls = CLASSES[0];
    this.ents.set(id, {
      id, kind: 'player', name,
      x: 0, z: 0, facing: 0,
      hp: cls.baseHp, maxHp: cls.baseHp,
      targetId: null,
      str: cls.baseStr, weaponDamage: cls.weaponDamage,
      baseStr: cls.baseStr, baseWeaponDamage: cls.weaponDamage,
      baseMaxHp: cls.baseHp, baseMaxMp: cls.baseMp,
      swingTicks: Math.round(cls.swingTime * TICK_RATE), nextSwingAt: 0,
      mp: cls.baseMp, maxMp: cls.baseMp, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      gold: 0, bag: [], equipment: { weapon: null, armor: null }, effects: [], tier: 'normal',
      species: '',
      boss: false, summoned: false, spawnZone: -1,
      homeX: 0, homeZ: 0,
      targetX: 0, targetZ: 0, repickAt: 0,
    });
    return id;
  }

  // Spawn a common enemy in ring `zoneIndex` at `spot` (GDD §G3). The mob takes the ring's
  // LEVEL, and its stats scale by level (+tier): farther-out rings are tougher and pay more.
  // The bestiary is distributed across every spawn (species roll, own substream). `tiered`
  // respawns may roll a Champion/Elite tier; the starting pack passes false (baseline). The
  // species/tier/POSITION rolls all use INDEPENDENT substreams, so the main loot/position
  // stream is untouched whatever spawns.
  private spawnEnemy(zoneIndex: number, spot: SpawnSpot, tiered: boolean): void {
    const id = this.nextId++;
    const zone = SPAWN_ZONES[zoneIndex];
    // Position: at the spot with a small jitter from the dedicated spawnRng, clamped to
    // the world. The jitter (< half a ring) keeps the mob inside its ring.
    const x = clamp(spot.x + this.spawnRng.range(-SPAWN_JITTER, SPAWN_JITTER), -WORLD_HALF, WORLD_HALF);
    const z = clamp(spot.z + this.spawnRng.range(-SPAWN_JITTER, SPAWN_JITTER), -WORLD_HALF, WORLD_HALF);
    // The innermost ring (level 1) is the grey-wolf "starter ring" by the town; the deeper
    // rings get the varied humanoid bestiary. The roll runs every spawn (own substream), so
    // the species stream stays independent of this choice.
    const rolled = pickSpecies(this.speciesRng.next());
    const sp = zone.level === 1 ? ENEMY_TEMPLATE : rolled;
    const tier = tiered ? pickEnemyTier(this.tierRng.next()) : ENEMY_TIERS[0];
    const level = zone.level;
    const lhp = levelHpMult(level);
    const ldmg = levelDamageMult(level);
    const hp = Math.round(sp.hp * tier.hpMult * lhp);
    const name = tier.nameSuffix ? `${sp.name} ${tier.nameSuffix}` : sp.name;
    this.ents.set(id, {
      id, kind: 'enemy', name,
      x, z, facing: 0,
      hp, maxHp: hp,
      targetId: null,
      str: Math.round(sp.str * tier.damageMult * ldmg),
      weaponDamage: Math.round(sp.weaponDamage * tier.damageMult * ldmg),
      baseStr: 0, baseWeaponDamage: 0, baseMaxHp: hp, baseMaxMp: 0,
      swingTicks: Math.round(sp.swingTime * TICK_RATE), nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0,
      level, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      gold: 0, bag: [], equipment: { weapon: null, armor: null }, effects: [], tier: tier.id,
      species: sp.id,
      boss: false, summoned: false, spawnZone: zoneIndex,
      homeX: x, homeZ: z,
      targetX: x, targetZ: z, repickAt: 0,
    });
  }

  // The town vendor: a fixed, non-combat NPC. kind 'npc' keeps it out of every
  // enemy code path (no wander, no aggro, not targetable/attackable).
  private spawnVendor(): number {
    const id = this.nextId++;
    this.ents.set(id, {
      id, kind: 'npc', name: VENDOR_NAME,
      x: VENDOR_SPAWN_X, z: VENDOR_SPAWN_Z, facing: 0,
      hp: 100, maxHp: 100,
      targetId: null,
      str: 0, weaponDamage: 0,
      baseStr: 0, baseWeaponDamage: 0, baseMaxHp: 100, baseMaxMp: 0,
      swingTicks: 0, nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      gold: 0, bag: [], equipment: { weapon: null, armor: null }, effects: [], tier: 'normal',
      species: '',
      boss: false, summoned: false, spawnZone: -1,
      homeX: VENDOR_SPAWN_X, homeZ: VENDOR_SPAWN_Z,
      targetX: VENDOR_SPAWN_X, targetZ: VENDOR_SPAWN_Z, repickAt: 0,
    });
    return id;
  }

  // Spawn boss `i` (an index into BOSS_DEFS) at its fixed point. No Rng (fixed
  // position), so it never perturbs the loot/position stream. Announces via 'boss-spawn'.
  private spawnBoss(i: number): void {
    const def = BOSS_DEFS[i];
    const t = def.template;
    const id = this.nextId++;
    this.ents.set(id, {
      id, kind: 'enemy', name: t.name,
      x: def.spawnX, z: def.spawnZ, facing: 0,
      hp: t.hp, maxHp: t.hp,
      targetId: null,
      str: t.str, weaponDamage: t.weaponDamage,
      baseStr: t.str, baseWeaponDamage: t.weaponDamage, baseMaxHp: t.hp, baseMaxMp: 0,
      swingTicks: Math.round(t.swingTime * TICK_RATE), nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      gold: 0, bag: [], equipment: { weapon: null, armor: null }, effects: [], tier: 'normal',
      species: t.id, // the boss id, so kill/summon/render resolve its def
      boss: true, summoned: false, spawnZone: -1,
      homeX: def.spawnX, homeZ: def.spawnZ,
      targetX: def.spawnX, targetZ: def.spawnZ, repickAt: 0,
    });
    const s = this.bossState[i];
    s.entityId = id;
    s.spawnAt = Infinity; // don't schedule another of THIS boss while it lives
    s.summonsFired = 0; // fresh boss -> can summon all its waves again
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'boss-spawn',
      targetId: id,
      amount: 0,
      x: def.spawnX,
      z: def.spawnZ,
      text: t.name,
    });
  }

  // Fire a minion-summon wave for each HP threshold the boss has NEWLY crossed.
  // Resolves the boss's own def via its `species` (= boss id). Thresholds are
  // descending and fire once each, so one big hit crossing several fires several.
  private checkBossSummons(boss: Entity): void {
    const i = BOSS_DEFS.findIndex((d) => d.template.id === boss.species);
    if (i < 0) return;
    const def = BOSS_DEFS[i];
    const s = this.bossState[i];
    const thresholds = def.template.summonThresholds;
    while (s.summonsFired < thresholds.length && boss.hp <= boss.maxHp * thresholds[s.summonsFired]) {
      this.summonMinions(boss, def);
      s.summonsFired++;
    }
  }

  // Spawn a ring of this boss's minions around it and announce the call.
  private summonMinions(boss: Entity, def: BossDef): void {
    const n = def.template.minionCount;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawnMinion(
        clamp(boss.x + Math.cos(a) * def.minionSpawnRadius, -WORLD_HALF, WORLD_HALF),
        clamp(boss.z + Math.sin(a) * def.minionSpawnRadius, -WORLD_HALF, WORLD_HALF),
        def,
      );
    }
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'boss-summon',
      targetId: boss.id,
      amount: 0,
      x: boss.x,
      z: boss.z,
      text: def.template.name,
    });
  }

  // A boss minion: a common-mob-like enemy (selectable/attackable) but ephemeral
  // (summoned:true) so killing it doesn't feed the common respawn queue. Uses the
  // base wolf's combat with the def's minion HP/name/render-species.
  private spawnMinion(x: number, z: number, def: BossDef): void {
    const id = this.nextId++;
    // Combat matches the minion's render species (a wolf minion bites like a wolf, a
    // bandit mercenary like a bandit) so movement and bite are consistent — the Alfa's
    // grey_wolf minion resolves to ENEMY_TEMPLATE, byte-identical to before.
    const ms = SPECIES_BY_ID[def.minionSpecies] ?? ENEMY_TEMPLATE;
    this.ents.set(id, {
      id, kind: 'enemy', name: def.template.minionName,
      x, z, facing: 0,
      hp: def.template.minionHp, maxHp: def.template.minionHp,
      targetId: null,
      str: ms.str, weaponDamage: ms.weaponDamage,
      baseStr: 0, baseWeaponDamage: 0, baseMaxHp: def.template.minionHp, baseMaxMp: 0,
      swingTicks: Math.round(ms.swingTime * TICK_RATE), nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      gold: 0, bag: [], equipment: { weapon: null, armor: null }, effects: [], tier: 'normal',
      species: def.minionSpecies,
      boss: false, summoned: true, spawnZone: -1,
      homeX: x, homeZ: z,
      targetX: x, targetZ: z, repickAt: 0,
    });
  }

  // ---------- IWorld ----------
  localPlayerId(): number | null {
    return this.localId;
  }

  localTargetId(): number | null {
    return this.targetOf(this.localId);
  }

  // The current target (an enemy id) of a SPECIFIC player, or null. The server reads
  // this per client for that player's HUD; the IWorld localTargetId() uses the local one.
  targetOf(id: number): number | null {
    const p = this.ents.get(id);
    return p ? p.targetId : null;
  }

  recentEvents(): ReadonlyArray<SimEvent> {
    // Hand out a snapshot, never the live array — mirrors entities() and keeps
    // render/ui structurally unable to mutate sim state. (Bounded, so cheap.)
    return this.events.slice();
  }

  abilities(): ReadonlyArray<AbilityView> {
    return this.abilitiesFor(this.localId);
  }

  // The action bar for a SPECIFIC player (live cooldown/GCD/MP/rank state). The server
  // queries this per client to build that player's bar; IWorld abilities() uses the local one.
  abilitiesFor(id: number): ReadonlyArray<AbilityView> {
    const p = this.ents.get(id);
    const kit = p ? this.activeMastery(p).abilities : MASTERIES[DEFAULT_MASTERY].abilities;
    return kit.map((def) => {
      const cdLeft = p ? Math.max(0, (p.abilityReadyAt[def.slot] ?? 0) - this.tick) : 0;
      const gcdLeft = p ? Math.max(0, p.gcdUntil - this.tick) : 0;
      const ready = !!p && cdLeft === 0 && gcdLeft === 0 && p.mp >= def.mpCost;
      const rank = p ? this.skillRank(p, def) : 1;
      return {
        slot: def.slot,
        name: def.name,
        icon: def.icon,
        mpCost: def.mpCost,
        ready,
        cooldownRemaining: cdLeft * DT, // ticks -> seconds
        cooldownTotal: def.cooldownSecs,
        rank,
        maxRank: SKILL_MAX_RANK,
        rankCost: skillUpgradeCost(rank),
      };
    });
  }

  inventory(): InventoryView {
    return this.inventoryFor(this.localId);
  }

  // The bag + equipment for a SPECIFIC player (the server sends this to its owner each
  // snapshot). The IWorld inventory() uses the local player.
  inventoryFor(id: number): InventoryView {
    const p = this.ents.get(id);
    const stacks = p
      ? p.bag.map((s) => ({
          itemId: s.itemId,
          name: ITEMS[s.itemId]?.name ?? s.itemId,
          qty: s.qty,
          rarity: s.rarity,
          rarityName: rarityDef(s.rarity).name,
          plus: s.plus,
          equipSlot: ITEMS[s.itemId]?.slot,
          consumable: ITEMS[s.itemId]?.consumable != null,
          sellValue: rarityStat(ITEMS[s.itemId]?.value ?? 0, s.rarity),
        }))
      : [];
    const equipment = EQUIP_SLOTS.map((slot) => {
      const eq = p ? p.equipment[slot] : null;
      return {
        slot,
        itemId: eq?.itemId ?? null,
        name: eq ? (ITEMS[eq.itemId]?.name ?? eq.itemId) : null,
        rarity: eq?.rarity ?? null,
        rarityName: eq ? rarityDef(eq.rarity).name : null,
        plus: eq?.plus ?? 0,
        // both chances, so the UI shows the one matching the Lucky Powder toggle.
        enhanceChance: eq ? enhanceChance(eq.plus, false) : 0,
        enhanceChanceLucky: eq ? enhanceChance(eq.plus, true) : 0,
        durability: eq?.durability ?? 0,
        maxDurability: eq ? MAX_DURABILITY : 0,
        repairCost: eq ? repairCost(eq.durability) : 0,
      };
    });
    return { capacity: BAG_SLOTS, stacks, equipment };
  }

  shop(): ShopView {
    return this.shopFor(this.localId);
  }

  // The vendor storefront for a SPECIFIC player (`inRange` depends on that player's
  // position). The IWorld shop() uses the local player.
  shopFor(id: number): ShopView {
    const p = this.ents.get(id);
    return {
      name: VENDOR_NAME,
      stock: VENDOR_STOCK.map((s) => ({
        itemId: s.itemId,
        name: ITEMS[s.itemId]?.name ?? s.itemId,
        price: s.price,
      })),
      inRange: p ? this.nearVendor(p) : false,
    };
  }

  botActive(): boolean {
    return this.botActiveFor(this.localId);
  }

  // Whether a SPECIFIC player's auto-play is on (the server reads this per client for
  // that player's HUD). IWorld botActive() uses the local player.
  botActiveFor(id: number): boolean {
    return this.botPlayers.has(id);
  }

  sendCommand(cmd: Command): void {
    // The local (offline) player. Networked players use sendCommandFor(id, …).
    this.routeCommand(this.localId, cmd);
  }

  // Movement is a held intent (latest wins); everything else is a one-shot action
  // queued for the next tick — so ALL state mutation still happens inside step().
  private routeCommand(id: number, cmd: Command): void {
    if (cmd.t === 'move' || cmd.t === 'stop') {
      if (this.moveIntents.has(id)) this.moveIntents.set(id, cmd);
    } else {
      this.pendings.get(id)?.push(cmd);
    }
  }

  // ---------- party / co-op (GDD B6) ----------
  // Authoritative party state lives in the deterministic sim, mutated ONLY by these
  // command handlers (the server routes the commands; offline never sends them). All
  // are pure state mutations — no Rng — so determinism is untouched.

  // Form a party with the caller as leader + sole member. The leader fixes BOTH modes
  // here (Silkroad); the XP mode also caps the size. Ignored if already grouped.
  private createParty(p: Entity, exp: PartyExpMode, loot: PartyLootMode): void {
    if (this.partyOfPlayer.has(p.id)) return;
    const id = this.nextPartyId++;
    this.parties.set(id, { id, leaderId: p.id, members: [p.id], expMode: exp, lootMode: loot });
    this.partyOfPlayer.set(p.id, id);
  }

  // Leader invites an ONLINE player by name (the first match that is online, ungrouped,
  // and not already invited). Sets a pending invite the target accepts/refuses.
  private inviteToParty(leader: Entity, name: string): void {
    const pid = this.partyOfPlayer.get(leader.id);
    if (pid === undefined) return; // must form a party first
    const party = this.parties.get(pid)!;
    if (party.leaderId !== leader.id) return; // only the leader invites
    if (party.members.length >= maxPartySize(party.expMode)) return; // full
    for (const tid of this.playerIds) {
      if (tid === leader.id) continue;
      const t = this.ents.get(tid);
      if (!t || t.kind !== 'player' || t.name !== name) continue;
      if (this.partyOfPlayer.has(tid) || this.pendingInvites.has(tid)) continue; // grouped / already invited
      this.pendingInvites.set(tid, { fromId: leader.id, partyId: pid });
      return; // first match only
    }
  }

  // The invited player accepts: join the party if it still exists, isn't full, and the
  // player hasn't grouped elsewhere meanwhile. Always clears the pending invite.
  private acceptInvite(p: Entity): void {
    const inv = this.pendingInvites.get(p.id);
    if (!inv) return;
    this.pendingInvites.delete(p.id);
    if (this.partyOfPlayer.has(p.id)) return;
    const party = this.parties.get(inv.partyId);
    if (!party || party.members.length >= maxPartySize(party.expMode)) return;
    party.members.push(p.id);
    this.partyOfPlayer.set(p.id, party.id);
  }

  // Decline (drop the pending invite).
  private refuseInvite(p: Entity): void {
    this.pendingInvites.delete(p.id);
  }

  // Leader removes a member (not itself — the leader uses leave to depart).
  private kickFromParty(leader: Entity, targetId: number): void {
    const pid = this.partyOfPlayer.get(leader.id);
    if (pid === undefined || targetId === leader.id) return;
    const party = this.parties.get(pid)!;
    if (party.leaderId !== leader.id) return; // only the leader kicks
    if (this.partyOfPlayer.get(targetId) !== pid) return; // not in this party
    this.removeFromParty(targetId);
  }

  // Leader admits a player who asked to join via PARTY MATCHING (the request→approve
  // handshake lives in the server's matching lobby, OUTSIDE the deterministic sim; this
  // command is the authoritative membership change it produces — server-issued only, never
  // accepted from a raw client). Mirrors invite+accept collapsed, re-validating everything
  // (leader, capacity, target is a real, ungrouped, online player) so a stale approval is safe.
  private admitToParty(leader: Entity, targetId: number): void {
    const pid = this.partyOfPlayer.get(leader.id);
    if (pid === undefined || targetId === leader.id) return;
    const party = this.parties.get(pid)!;
    if (party.leaderId !== leader.id) return; // only the leader admits
    if (party.members.length >= maxPartySize(party.expMode)) return; // full
    if (this.partyOfPlayer.has(targetId)) return; // already grouped elsewhere
    const t = this.ents.get(targetId);
    if (!t || t.kind !== 'player') return; // must be a real, online player
    party.members.push(targetId);
    this.partyOfPlayer.set(targetId, party.id);
    this.pendingInvites.delete(targetId); // consume any stale invite to them (parity with accept)
  }

  // Remove a player from whatever party it's in (shared by leave, kick, and disconnect).
  // A leaving LEADER promotes the next member; a party that drops to <=1 member dissolves
  // (the lone member goes solo), and any pending invites into it are dropped.
  private removeFromParty(playerId: number): void {
    const pid = this.partyOfPlayer.get(playerId);
    if (pid === undefined) return;
    this.partyOfPlayer.delete(playerId);
    // Cancel any invites this player had sent (only a leader has outbound ones), so a
    // leaving/kicked inviter never leaves a stale invite naming a non-member behind.
    for (const [inviteeId, inv] of this.pendingInvites) {
      if (inv.fromId === playerId) this.pendingInvites.delete(inviteeId);
    }
    const party = this.parties.get(pid);
    if (!party) return;
    const i = party.members.indexOf(playerId);
    if (i >= 0) party.members.splice(i, 1);
    if (party.leaderId === playerId && party.members.length > 0) party.leaderId = party.members[0];
    if (party.members.length <= 1) {
      for (const m of party.members) this.partyOfPlayer.delete(m);
      this.parties.delete(pid);
      for (const [inviteeId, inv] of this.pendingInvites) {
        if (inv.partyId === pid) this.pendingInvites.delete(inviteeId);
      }
    }
  }

  // The local player's party / pending invite (offline = null; the offline player can't
  // group, since there's no one to invite). The server reads partyViewFor/inviteViewFor
  // per player to fill each `self`; the online ClientWorld mirrors them.
  localParty(): PartyView | null {
    return this.partyViewFor(this.localId);
  }
  localInvite(): PartyInviteView | null {
    return this.inviteViewFor(this.localId);
  }

  partyViewFor(id: number): PartyView | null {
    const pid = this.partyOfPlayer.get(id);
    if (pid === undefined) return null;
    const party = this.parties.get(pid);
    if (!party) return null;
    return {
      id: party.id,
      expMode: party.expMode,
      lootMode: party.lootMode,
      maxMembers: maxPartySize(party.expMode),
      members: party.members.map((mid) => {
        const m = this.ents.get(mid);
        return {
          id: mid,
          name: m?.name ?? '',
          leader: mid === party.leaderId,
          hp: m ? Math.round(m.hp) : 0,
          maxHp: m ? Math.round(m.maxHp) : 0,
          mp: m ? Math.round(m.mp) : 0,
          maxMp: m ? Math.round(m.maxMp) : 0,
          level: m?.level ?? 1,
          dead: m ? m.deadUntil !== 0 : false,
        };
      }),
    };
  }

  inviteViewFor(id: number): PartyInviteView | null {
    const inv = this.pendingInvites.get(id);
    if (!inv) return null;
    const party = this.parties.get(inv.partyId);
    const from = this.ents.get(inv.fromId);
    if (!party || !from) return null;
    return { fromId: inv.fromId, fromName: from.name, expMode: party.expMode, lootMode: party.lootMode };
  }

  entities(): ReadonlyArray<EntityView> {
    const out: EntityView[] = [];
    for (const e of this.ents.values()) {
      out.push({
        id: e.id, kind: e.kind, name: e.name,
        x: e.x, z: e.z, facing: e.facing, hp: e.hp, maxHp: e.maxHp,
        mp: e.mp, maxMp: e.maxMp,
        level: e.level, xp: e.xp, xpToNext: xpForLevel(e.level), attrPoints: e.attrPoints,
        gold: e.gold,
        sp: e.sp,
        str: e.str, weaponDamage: e.weaponDamage,
        int: e.baseInt,
        weaponPlus: e.equipment.weapon?.plus ?? 0,
        boss: e.boss,
        tier: e.tier,
        species: e.species,
        hostile: e.kind === 'enemy' && e.targetId != null,
        dead: e.kind === 'player' && e.deadUntil !== 0,
        statuses: e.effects.map((s) => s.kind),
        // The player's class skin = its active weapon mastery (unarmed -> Sword). Only players
        // have one; enemies/NPCs report the default and the renderer ignores it for them.
        mastery: e.kind === 'player' ? this.activeMastery(e).id : DEFAULT_MASTERY,
      });
    }
    return out;
  }

  // ---------- simulation ----------
  step(): void {
    this.tick++;
    // Tick status effects (DoT damage + expiry) for everyone first, so a just-
    // expired stun lets the entity act this tick. Snapshot: a DoT may remove an entity.
    for (const e of [...this.ents.values()]) this.stepStatuses(e);

    // --- per player: drain one-shot actions (+ the bot), then move ---
    // Each player's bot toggle is always honored; that player's other MANUAL commands
    // apply only while ITS bot is OFF (auto-play ignores manual input). A bot-enabled
    // player is driven by botStep. One player => identical order/behavior to before.
    for (const id of this.playerIds) {
      const p = this.ents.get(id);
      if (!p) continue;
      const pend = this.pendings.get(id)!;
      for (const cmd of pend) {
        if (cmd.t === 'set-bot') {
          if (cmd.on) {
            this.botPlayers.add(id);
          } else {
            this.botPlayers.delete(id);
            this.moveIntents.set(id, { t: 'stop' }); // hand control back to the human
            p.targetId = null;
          }
        } else if (!this.botPlayers.has(id) || PARTY_COMMANDS.has(cmd.t)) {
          // Manual combat/economy input is ignored while auto-play is ON, but SOCIAL
          // party commands still apply (auto-play owns only the player's combat + movement,
          // so you can still accept an invite / manage your group while botting).
          this.applyAction(p, cmd);
        }
      }
      pend.length = 0;
      // A bot-driven player: botStep OWNS its movement (it overwrites moveIntents below
      // every tick), so a racing/tampered client move-intent is harmlessly stomped.
      if (this.botPlayers.has(id)) this.botStep(p);
      this.stepPlayer(p);
    }

    // --- enemies act on the post-move positions (aggro the NEAREST living player) ---
    for (const e of this.ents.values()) {
      if (e.kind === 'enemy') this.stepEnemy(e);
    }

    // --- combat + respawn per player, on the post-movement positions ---
    for (const id of this.playerIds) {
      const p = this.ents.get(id);
      if (p) this.autoAttack(p);
    }
    for (const id of this.playerIds) {
      const p = this.ents.get(id);
      if (p) this.respawnPlayer(p); // revive a downed player once its timer elapses
    }
    this.processRespawns();
    this.updateBoss();
    this.pruneEvents();
    // A target that died or no longer exists clears the selection.
    for (const id of this.playerIds) {
      const p = this.ents.get(id);
      if (p) this.validateTarget(p);
    }
  }

  // ---------- combat (melee auto-attack) ----------
  // When the player has a living target that is in range and in front, land a
  // swing every `swingTicks`. The timer is preserved while out of range, so a
  // ready swing fires the moment the target comes back into reach.
  private autoAttack(p: Entity): void {
    if (p.deadUntil !== 0 || this.isIncapacitated(p)) return; // no swinging while downed or stunned
    if (p.targetId == null || p.swingTicks <= 0) return;
    const t = this.ents.get(p.targetId);
    if (!t || t.kind !== 'enemy' || t.hp <= 0) return; // validateTarget clears it
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > this.attackRange(p)) return; // out of range: hold the swing
    if (this.activeMastery(p).ranged) {
      // A ranged attacker pivots to shoot, so it can fire while kiting (facing away).
      if (dist > CONTACT_DIST) p.facing = Math.atan2(dx, dz);
    } else if (dist > CONTACT_DIST && !inFrontOf(dx, dz, p.facing)) {
      // Melee: require facing the target while approaching. At contact the bodies
      // overlap, the direction vector collapses to ~0, and the player constantly
      // overshoots — requiring "in front" there would skip swings on the enemy
      // we're standing on. (The frontal rule still applies on the approach.)
      return;
    }
    if (this.tick < p.nextSwingAt) return; // swing still on cooldown
    p.nextSwingAt = this.tick + Math.round(p.swingTicks / this.slowFactor(p)); // slow -> slower swings
    // Auto-attack: a basic physical weapon swing (no ability). compute() does the same crit
    // roll the old rollCrit did; combat.mitigate (inside hitEnemy) is passthrough today.
    this.hitEnemy(t, combat.compute({
      attacker: p, rank: 1, damageType: this.damageTypeOf(p), critChance: this.critChance(p), rng: this.rng,
    }), p);
  }

  // Apply a hit to an enemy: subtract HP, surface the floating damage number,
  // fire the boss's minion summons when its HP crosses a threshold, and kill it
  // at 0. Centralized so every damage source goes through the same path.
  private hitEnemy(t: Entity, hit: Damage, killer: Entity): void {
    // Reduce the outgoing hit by the target's defense, then apply it. Enemies have no
    // mitigation today, so mitigate() is a passthrough (dmg === hit.amount) — identical
    // numbers to before. Giving enemies armor later happens here without touching this call.
    const dmg = combat.mitigate({ hit, target: t });
    t.hp -= dmg;
    // Captured at the target's current position so the number shows even on a kill.
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'damage',
      targetId: t.id,
      amount: dmg,
      x: t.x,
      z: t.z,
    });
    // Fire any crossed summon thresholds — even on a lethal blow — so a future
    // retune (bigger hits / smaller HP bands) can never silently drop a wave.
    // The boss isn't removed until killEnemy below, so its position is valid.
    if (t.boss) this.checkBossSummons(t);
    if (t.hp <= 0) {
      t.hp = 0;
      this.killEnemy(t, killer);
    }
  }

  // Drop presentation events older than the retention window. They are purely
  // cosmetic, so this never affects gameplay or determinism of the world state.
  private pruneEvents(): void {
    if (this.events.length === 0) return;
    const cutoff = this.tick - EVENT_TTL_TICKS;
    if (this.events[0].tick > cutoff) return; // nothing old enough yet
    this.events = this.events.filter((e) => e.tick > cutoff);
  }

  private killEnemy(dead: Entity, killer: Entity): void {
    this.ents.delete(dead.id);
    // Which boss died (if any), resolved from its species id (= boss id).
    const bossDef = dead.boss ? (BOSS_DEF_BY_ID[dead.species] ?? BOSS_DEFS[0]) : null;
    if (bossDef) {
      // This boss reschedules on its OWN timer (not the common-mob queue) and
      // announces its defeat WITH the name of whoever landed the kill.
      const s = this.bossState[BOSS_DEFS.indexOf(bossDef)];
      s.entityId = null;
      s.spawnAt = this.tick + bossDef.respawnTicks;
      this.events.push({
        seq: this.nextEventSeq++,
        tick: this.tick,
        kind: 'boss-defeat',
        targetId: dead.id,
        amount: 0,
        x: dead.x,
        z: dead.z,
        text: killer.kind === 'player'
          ? `${killer.name} derrotou ${bossDef.template.name}`
          : `${bossDef.template.name} foi derrotado`,
      });
    } else if (!dead.summoned) {
      // Common enemies respawn after a delay, refilling their OWN ring; summons are ephemeral.
      this.respawnQueue.push({ at: this.tick + RESPAWN_TICKS, zone: dead.spawnZone });
    }
    if (killer.kind === 'player') {
      const tier = ENEMY_TIERS.find((t) => t.id === dead.tier) ?? ENEMY_TIERS[0];
      const st = SPECIES_BY_ID[dead.species] ?? ENEMY_TEMPLATE; // the dead mob's species (xp/sp baseline)
      // A boss pays its big flat XP/SP lump; a common mob scales by tier AND by its LEVEL
      // (deeper rings pay more — GDD §G3). The reward is then distributed by the killer's
      // party mode (solo = all to the killer).
      const lvl = levelRewardMult(dead.level);
      const baseXp = bossDef ? bossDef.template.xp : Math.round(st.xp * tier.xpMult * lvl);
      const baseSp = bossDef ? bossDef.template.sp : Math.round(st.sp * tier.xpMult * lvl);
      this.awardReward(killer, baseXp, baseSp);
      this.rollLoot(killer, dead, bossDef ? 1 : tier.goldMult * lvl);
    }
  }

  // Distribute a kill's XP + SP to the killer's PARTY per its mode (GDD B6 / Silkroad):
  //   solo (no party) -> the killer gets it all (offline + ungrouped: identical to before).
  //   'each-get'      -> the killer keeps its own kill's reward, scaled by the party-size
  //                      bonus (+0/+2/+5/+10% for 1/2/3/4); others get nothing from THIS kill.
  //   'auto-share'    -> split among members within PARTY_SHARE_RANGE of the killer, by level;
  //                      the rounding remainder goes to the killer. Out-of-range members: nothing.
  // Pure deterministic math (no Rng), so the loot/position stream is untouched. The XP/SP
  // tests run solo, so they see the exact pre-party behavior.
  private awardReward(killer: Entity, xp: number, sp: number): void {
    const pid = this.partyOfPlayer.get(killer.id);
    const party = pid !== undefined ? this.parties.get(pid) : undefined;
    if (!party) {
      this.gainXp(killer, xp);
      killer.sp += sp;
      return;
    }
    if (party.expMode === 'each-get') {
      const mult = eachGetBonus(party.members.length);
      this.gainXp(killer, Math.round(xp * mult));
      killer.sp += Math.round(sp * mult);
      return;
    }
    // 'auto-share': split (by level) among the living members within range of the killer.
    const inRange = this.partyMembersInRange(party, killer);
    const sumLevels = inRange.reduce((s, m) => s + m.level, 0);
    if (sumLevels <= 0) { this.gainXp(killer, xp); killer.sp += sp; return; } // degenerate -> killer
    let xpAssigned = 0;
    let spAssigned = 0;
    for (const m of inRange) {
      if (m.id === killer.id) continue; // the killer takes its share + the remainder, below
      const mxp = Math.floor((xp * m.level) / sumLevels);
      const msp = Math.floor((sp * m.level) / sumLevels);
      this.gainXp(m, mxp);
      m.sp += msp;
      xpAssigned += mxp;
      spAssigned += msp;
    }
    this.gainXp(killer, xp - xpAssigned); // killer: its floor share + the rounding remainder
    killer.sp += sp - spAssigned;
  }

  // Roll a kill's loot into the killer's bag. ALL randomness goes through the
  // sim Rng (never Math.random) so the same seed + commands drop the same loot.
  // The boss uses its own (bigger gold, generous drops, far better rarities) table.
  private rollLoot(p: Entity, dead: Entity, goldMult = 1): void {
    // Gold + drop table come from the dead mob: the boss table for a boss, else the
    // killed species' own table (a bandit drops bandit loot). The Rng draw order is
    // unchanged (gold int, then per-drop), so the wolf's loot stream is preserved.
    const bt = dead.boss ? (BOSS_DEF_BY_ID[dead.species]?.template ?? BOSS_DEFS[0].template) : null;
    const t = bt ?? (SPECIES_BY_ID[dead.species] ?? ENEMY_TEMPLATE);
    const rarities = bt ? bt.rarities : RARITIES;
    // Gold goes to the killer/picker (it is not an "item"); same Rng draw as before.
    p.gold += Math.round(this.rng.int(t.goldMin, t.goldMax + 1) * goldMult);
    // Where each dropped ITEM goes: the picker (Item Distribution / solo) or a random
    // in-range party member (Item Auto Share). Resolved once; the per-item random pick
    // uses partyRng, so the ITEM ROLL (which/how rare, via this.rng) is unchanged.
    const recipients = this.lootRecipients(p);
    for (const drop of t.drops) {
      // First decide if the item drops at all, then roll HOW rare it is.
      // Only equippable gear has a meaningful rarity; materials/consumables drop
      // as plain Normal. Everything drops un-enhanced (+0).
      if (this.rng.next() < drop.chance) {
        const equippable = ITEMS[drop.itemId]?.slot != null;
        const rarity = equippable ? rollRarity(this.rng, rarities) : 'normal';
        const to = recipients.length === 1 ? recipients[0] : recipients[this.partyRng.int(0, recipients.length)];
        addToBag(to.bag, drop.itemId, rarity, 0, 1);
      }
    }
  }

  // Who receives this kill's dropped items (GDD B6 loot modes / Silkroad). Solo or
  // "Item Distribution" -> just the picker (the killer), byte-identical to before. "Item
  // Auto Share" -> the living members within PARTY_SHARE_RANGE of the killer (each item
  // then goes to a RANDOM one of these via partyRng); none in range -> falls back to the
  // killer so an item is never lost.
  private lootRecipients(killer: Entity): Entity[] {
    const pid = this.partyOfPlayer.get(killer.id);
    const party = pid !== undefined ? this.parties.get(pid) : undefined;
    if (!party || party.lootMode !== 'auto-share') return [killer];
    const inRange = this.partyMembersInRange(party, killer);
    return inRange.length > 0 ? inRange : [killer];
  }

  // The LIVING party members within share range of the killer — the shared eligibility
  // rule for BOTH auto-share XP and auto-share loot (so the two can never drift). Excludes
  // non-players and downed spirits (Silkroad: a dead member doesn't share); always includes
  // the killer itself (alive, at distance 0). Pure read, no Rng.
  private partyMembersInRange(party: Party, killer: Entity): Entity[] {
    const r2 = PARTY_SHARE_RANGE * PARTY_SHARE_RANGE;
    const out: Entity[] = [];
    for (const mid of party.members) {
      const m = this.ents.get(mid);
      if (!m || m.kind !== 'player' || m.deadUntil !== 0) continue;
      const dx = m.x - killer.x;
      const dz = m.z - killer.z;
      if (dx * dx + dz * dz <= r2) out.push(m);
    }
    return out;
  }

  // Award XP and level up across as many thresholds as it crosses (carrying the
  // remainder), so a big XP gain can grant multiple levels at once.
  private gainXp(p: Entity, amount: number): void {
    p.xp += amount;
    while (p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level);
      this.levelUp(p);
    }
  }

  private levelUp(p: Entity): void {
    p.level += 1;
    p.baseMaxHp += HP_PER_LEVEL;
    p.baseMaxMp += MP_PER_LEVEL;
    this.recomputeStats(p); // fold base + gear into effective max HP/MP
    p.hp = p.maxHp; // ding! restore to full — rewarding, gentle pacing
    p.mp = p.maxMp;
    p.attrPoints += ATTR_POINTS_PER_LEVEL;
    // Presentation event for the level-up effect (amount = the new level).
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'levelup',
      targetId: p.id,
      amount: p.level,
      x: p.x,
      z: p.z,
    });
  }

  private processRespawns(): void {
    if (this.respawnQueue.length === 0) return;
    const remaining: { at: number; zone: number }[] = [];
    for (const r of this.respawnQueue) {
      if (this.tick >= r.at) {
        // Refill the SAME ring at one of its spots (own spawnRng), so each ring keeps its
        // level population. Reinforcements can be Champion/Elite.
        const zone = SPAWN_ZONES[r.zone];
        const spot = zone.spots[this.spawnRng.int(0, zone.spots.length - 1)];
        this.spawnEnemy(r.zone, spot, true);
      } else remaining.push(r);
    }
    this.respawnQueue = remaining;
  }

  // Spawn each world boss once its scheduled tick arrives (and it isn't already alive).
  private updateBoss(): void {
    for (let i = 0; i < BOSS_DEFS.length; i++) {
      const s = this.bossState[i];
      if (s.entityId === null && this.tick >= s.spawnAt) this.spawnBoss(i);
    }
  }

  // ---------- target selection (tab-target) ----------
  private applyAction(p: Entity, cmd: Command): void {
    // Party (social) commands work even while downed/stunned — no combat involved.
    switch (cmd.t) {
      case 'party-create': this.createParty(p, cmd.exp, cmd.loot); return;
      case 'party-invite': this.inviteToParty(p, cmd.name); return;
      case 'party-accept': this.acceptInvite(p); return;
      case 'party-refuse': this.refuseInvite(p); return;
      case 'party-leave': this.removeFromParty(p.id); return;
      case 'party-kick': this.kickFromParty(p, cmd.id); return;
      case 'party-admit': this.admitToParty(p, cmd.playerId); return;
    }
    if (p.deadUntil !== 0 || this.isIncapacitated(p)) return; // downed or stunned -> can't act
    switch (cmd.t) {
      case 'cycle-target':
        this.cycleTarget(p);
        break;
      case 'set-target':
        this.setTarget(p, cmd.id);
        break;
      case 'use-ability':
        this.useAbility(p, cmd.slot);
        break;
      case 'equip':
        this.equip(p, cmd.itemId, cmd.rarity, cmd.plus);
        break;
      case 'unequip':
        this.unequip(p, cmd.slot);
        break;
      case 'enhance':
        this.enhance(p, cmd.slot, cmd.useLuckyPowder);
        break;
      case 'repair':
        this.repair(p, cmd.slot);
        break;
      case 'use-item':
        this.useItem(p, cmd.itemId, cmd.rarity, cmd.plus);
        break;
      case 'spend-attr':
        this.spendAttr(p, cmd.attr);
        break;
      case 'rank-up':
        this.rankUp(p, cmd.slot);
        break;
      case 'buy':
        this.buy(p, cmd.itemId);
        break;
      case 'sell':
        this.sell(p, cmd.itemId, cmd.rarity, cmd.plus);
        break;
      case 'select-class':
        this.selectClass(p, cmd.classId);
        break;
      // 'move'/'stop' never reach here — they are stored as moveIntent.
      default:
        break;
    }
  }

  // ---------- class selection (GDD G1) ----------
  // Apply a chosen starter class: equip its starter weapon (which activates that class's
  // mastery/kit) — but ONLY for a FRESH character with no weapon yet. A returning/equipped
  // player keeps their gear (option b: the screen is then just "confirm your class", never
  // wiping an upgraded +N weapon). Deterministic (no Rng); the player can swap weapons after.
  private selectClass(p: Entity, classId: string): void {
    const cls = PLAYER_CLASS_BY_ID[classId];
    if (!cls) return; // unknown class -> ignore
    if (p.equipment.weapon != null) return; // option (b): never overwrite an existing weapon
    const def = ITEMS[cls.weaponId];
    if (!def || def.slot !== 'weapon') return; // misconfigured class -> ignore
    p.equipment.weapon = { itemId: cls.weaponId, rarity: 'normal', plus: 0, durability: MAX_DURABILITY };
    this.recomputeStats(p); // fold the weapon (+ its mastery passive) into effective stats
    p.hp = p.maxHp; // a fresh character starts at full with its class kit
    p.mp = p.maxMp;
  }

  // ---------- equipment ----------
  // Equip an item the player holds in the bag. Swaps out whatever occupies the
  // target slot (back to the bag) and folds the new gear's stats into combat.
  private equip(p: Entity, itemId: string, rarity: Rarity, plus: number): void {
    const def = ITEMS[itemId];
    if (!def || !def.slot) return; // unknown or not equippable
    if (!removeFromBag(p.bag, itemId, rarity, plus, 1)) return; // must hold that exact stack
    const prev = p.equipment[def.slot];
    p.equipment[def.slot] = { itemId, rarity, plus, durability: MAX_DURABILITY }; // a freshly equipped item is in full repair
    // Return the displaced item to the bag, keeping its "+N". (Removing the new
    // item above frees room in the common qty-1 case; only a full bag of other
    // stacks could lose it — acceptable for now, like the loot-on-full case.)
    if (prev) addToBag(p.bag, prev.itemId, prev.rarity, prev.plus, 1);
    this.recomputeStats(p);
  }

  private unequip(p: Entity, slot: EquipSlot): void {
    const eq = p.equipment[slot];
    if (!eq) return;
    if (!addToBag(p.bag, eq.itemId, eq.rarity, eq.plus, 1)) return; // bag full: keep it
    p.equipment[slot] = null;
    this.recomputeStats(p);
  }

  // ---------- alchemy ("+N") ----------
  // Attempt to raise the equipped item's "+". Consumes the matching Elixir (and,
  // if asked and available, a Lucky Powder for a better chance). Success: +1
  // (cap MAX_PLUS). Failure: -1 (floored at 0 — never breaks, never resets).
  // All randomness via the sim Rng. Refuses (no material cost) at the cap.
  private enhance(p: Entity, slot: EquipSlot, useLuckyPowder: boolean): void {
    const eq = p.equipment[slot];
    if (!eq || eq.plus >= MAX_PLUS) return; // nothing equipped, or already maxed
    const elixirId = slot === 'weapon' ? 'elixir_weapon' : 'elixir_armor';
    if (!removeFromBag(p.bag, elixirId, 'normal', 0, 1)) return; // need the right Elixir
    let lucky = false;
    if (useLuckyPowder && removeFromBag(p.bag, 'lucky_powder', 'normal', 0, 1)) lucky = true;

    const success = this.rng.next() < enhanceChance(eq.plus, lucky);
    eq.plus = success ? Math.min(MAX_PLUS, eq.plus + 1) : Math.max(0, eq.plus - 1);
    this.recomputeStats(p);
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: success ? 'enhance-success' : 'enhance-fail',
      targetId: p.id,
      amount: eq.plus,
      x: p.x,
      z: p.z,
    });
  }

  // ---------- consumables ----------
  // Use a consumable from the bag (e.g. a Health Potion): consume exactly one of
  // the given stack and apply its data-defined effect, each part clamped to the
  // player's maximum. A short shared cooldown stops potion-spam. Refuses — with
  // no consume and no cooldown — when still on cooldown or when the effect would
  // do nothing (e.g. drinking at full HP), so a potion is never wasted.
  // Deterministic: no Rng, purely tick-driven.
  private useItem(p: Entity, itemId: string, rarity: Rarity, plus: number): void {
    const effect = ITEMS[itemId]?.consumable;
    if (!effect) return; // not a consumable
    if (this.tick < p.potionReadyAt) return; // shared potion cooldown still running
    // How much it WOULD restore, each capped to the headroom below the max.
    const healHp = effect.healHp ? Math.min(effect.healHp, p.maxHp - p.hp) : 0;
    const healMp = effect.healMp ? Math.min(effect.healMp, p.maxMp - p.mp) : 0;
    if (healHp <= 0 && healMp <= 0) return; // nothing to do — don't burn the item
    if (!removeFromBag(p.bag, itemId, rarity, plus, 1)) return; // must actually hold it
    p.hp += healHp;
    p.mp += healMp;
    p.potionReadyAt = this.tick + POTION_COOLDOWN_TICKS;
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'heal',
      targetId: p.id,
      amount: healHp + healMp, // the actual amount restored (after the clamp)
      x: p.x,
      z: p.z,
    });
  }

  // ---------- bot (auto-play) ----------
  // Decide the player's actions for this tick when auto-play is on. The goal is a
  // hands-off run that SUSTAINS itself and keeps evolving. Decisions run in strict
  // priority order — SURVIVE > TEND THE BAG > EVOLVE GEAR > HUNT — and every action
  // goes through the SAME applyAction path a human's commands use, so the bot never
  // bypasses the sim (it respects range, cooldowns, MP, gold, the bag). ALL of it is
  // a deterministic function of world state (no Rng/clock in the decisions), so the
  // same seed + commands still produce an identical world.
  private botStep(p: Entity): void {
    // a spirit or a stunned/knocked actor can't act — hold (revive/stun-end is automatic)
    if (p.deadUntil !== 0 || this.isIncapacitated(p)) {
      this.moveIntents.set(p.id, { t: 'stop' });
      return;
    }

    // Always cheap & safe: bank attribute points + SP, and wear the best gear we own.
    this.botSpendAttrs(p);
    this.botRankUp(p);
    this.botEquipBest(p);

    const hpFrac = p.hp / p.maxHp;

    // === PRIORITY 1 — SURVIVE =============================================
    if (hpFrac < BOT_HEAL_FRAC) {
      const drank = this.botDrinkPotion(p);
      if (!drank) {
        // can't heal now (none held, or potion still on cooldown): break off from danger
        const threat = this.nearestEnemyWithin(p, BOT_FLEE_RADIUS);
        if (threat) {
          this.moveIntents.set(p.id, { t: 'move', dx: p.x - threat.x, dz: p.z - threat.z });
          return;
        }
      }
    }

    // === PRIORITY 2 — TEND THE BAG (sell junk / restock at the vendor) =====
    if (this.botWantsVendor(p)) {
      if (this.nearVendor(p)) {
        this.botTrade(p); // sell surplus gear, top up potions, buy spare materials
      } else {
        const v = this.ents.get(this.vendorId);
        if (v) {
          this.moveIntents.set(p.id, { t: 'move', dx: v.x - p.x, dz: v.z - p.z });
          return; // walk to the shop
        }
      }
    }

    // === PRIORITY 3 — EVOLVE GEAR (enhance during a lull, keep a reserve) ==
    if (!this.nearestEnemyWithin(p, BOT_ENHANCE_SAFE_RADIUS)) {
      this.botEnhance(p);
    }

    // === PRIORITY 4 — HUNT ================================================
    const target = this.botChooseTarget(p);
    if (!target) {
      this.moveIntents.set(p.id, { t: 'stop' });
      return;
    }
    this.applyAction(p, { t: 'set-target', id: target.id });
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const reach = this.attackRange(p) - 0.4;
    this.moveIntents.set(p.id, dx * dx + dz * dz > reach * reach ? { t: 'move', dx, dz } : { t: 'stop' });
    this.botUseAbilities(p, target);
  }

  // Força-first build: invest a little Intelligence until the MP pool can sustain a
  // few ability casts, then pour everything into Strength (more damage). Spends ALL
  // banked points each tick, so none ever sit idle.
  private botSpendAttrs(p: Entity): void {
    while (p.attrPoints > 0) {
      this.applyAction(p, { t: 'spend-attr', attr: p.maxMp < BOT_INT_TARGET_MP ? 'int' : 'str' });
    }
  }

  // Spend SP to rank up the active kit — cheapest upgrade first, so it banks the most
  // ranks per point as SP accrues. Pure progression (no movement / risk), so it runs
  // alongside the other always-cheap actions and never competes with survival.
  private botRankUp(p: Entity): void {
    for (;;) {
      let best: AbilityDef | undefined;
      let bestCost = Infinity;
      for (const def of this.activeMastery(p).abilities) {
        const cost = skillUpgradeCost(this.skillRank(p, def));
        if (cost > 0 && cost <= p.sp && cost < bestCost) { best = def; bestCost = cost; }
      }
      if (!best) break;
      this.applyAction(p, { t: 'rank-up', slot: best.slot });
    }
  }

  // Wear the strictly-best item we own in each slot. Weapons are only swapped for a
  // better one of the SAME mastery, so the bot upgrades within its style and never
  // flip-flops its whole kit. The displaced piece drops to the bag (later sold).
  private botEquipBest(p: Entity): void {
    const activeId = this.activeMastery(p).id;
    for (const slot of EQUIP_SLOTS) {
      const eq = p.equipment[slot];
      let bestScore = eq ? botGearScore(eq.itemId, eq.rarity, eq.plus) : -1;
      let best: ItemStack | undefined;
      for (const s of p.bag) {
        const def = ITEMS[s.itemId];
        if (!def || def.slot !== slot) continue;
        if (slot === 'weapon' && (def.mastery ?? DEFAULT_MASTERY) !== activeId) continue;
        const score = botGearScore(s.itemId, s.rarity, s.plus);
        if (score > bestScore) { bestScore = score; best = s; }
      }
      if (best) this.applyAction(p, { t: 'equip', itemId: best.itemId, rarity: best.rarity, plus: best.plus });
    }
  }

  // Drink a Health Potion if we hold one and it's off the shared cooldown. Returns
  // whether a drink actually happened (so the caller can fall back to fleeing).
  private botDrinkPotion(p: Entity): boolean {
    const potion = this.bagStack(p, 'health_potion');
    if (!potion || this.tick < p.potionReadyAt) return false; // none held, or potion sickness
    this.applyAction(p, { t: 'use-item', itemId: potion.itemId, rarity: potion.rarity, plus: potion.plus });
    return true;
  }

  // Worth a trip to the vendor? When the bag is nearly full of sellable surplus, or
  // we've run dry on Health Potions and can afford to restock at least one.
  private botWantsVendor(p: Entity): boolean {
    const bagPressure = BAG_SLOTS - p.bag.length <= BOT_BAG_HEADROOM && this.botJunkCount(p) > 0;
    const potionPrice = botPrice('health_potion');
    const outOfPotions = !this.bagStack(p, 'health_potion') && potionPrice > 0 && p.gold >= potionPrice;
    // worn gear it can afford to repair -> worth a trip (it lost stats on death)
    const gearWorn = EQUIP_SLOTS.some((slot) => {
      const eq = p.equipment[slot];
      return eq != null && eq.durability < DURABILITY_WORN_AT && p.gold >= repairCost(eq.durability);
    });
    return bagPressure || outOfPotions || gearWorn;
  }

  // At the vendor: sell every surplus piece of gear, restock potions (survival comes
  // first, so this may spend down to the last gold), then put any gold above the
  // reserve into alchemy materials so it can keep enhancing.
  private botTrade(p: Entity): void {
    for (const s of p.bag.filter((b) => this.botIsJunk(b)).map((b) => ({ ...b }))) {
      for (let i = 0; i < s.qty; i++) {
        this.applyAction(p, { t: 'sell', itemId: s.itemId, rarity: s.rarity, plus: s.plus });
      }
    }
    const potionPrice = botPrice('health_potion');
    while (potionPrice > 0 && this.botCount(p, 'health_potion') < BOT_POTION_STOCK
      && p.gold >= potionPrice && this.botCanStock(p, 'health_potion')) {
      this.applyAction(p, { t: 'buy', itemId: 'health_potion' });
    }
    // repair worn equipped gear (death cost) — buys back the combat stats it lost
    for (const slot of EQUIP_SLOTS) {
      const eq = p.equipment[slot];
      if (eq && eq.durability < DURABILITY_WORN_AT && p.gold >= repairCost(eq.durability)) {
        this.applyAction(p, { t: 'repair', slot });
      }
    }
    for (const mat of ['elixir_weapon', 'elixir_armor', 'lucky_powder'] as const) {
      const price = botPrice(mat);
      while (price > 0 && this.botCount(p, mat) < BOT_MATERIAL_RESERVE + 2
        && p.gold - price >= BOT_GOLD_RESERVE && this.botCanStock(p, mat)) {
        this.applyAction(p, { t: 'buy', itemId: mat });
      }
    }
  }

  // True when buying one more (Normal, +0) of `itemId` is guaranteed to land — there
  // is a free bag slot, or a matching stack to grow — so a buy-loop can never spin
  // forever refusing the purchase on a full bag.
  private botCanStock(p: Entity, itemId: string): boolean {
    if (p.bag.length < BAG_SLOTS) return true;
    return p.bag.some((s) => s.itemId === itemId && s.rarity === 'normal' && s.plus === 0);
  }

  // Refine the equipped gear when we hold materials ABOVE the reserve (never spend
  // the last ones — "deixar uma reserva"). Weapon first (damage), then armor. One
  // attempt per tick; a failed roll dips the "+", which is the mechanic — it just
  // keeps trying as more materials accumulate. Lucky Powder only when the odds drop.
  private botEnhance(p: Entity): void {
    for (const slot of EQUIP_SLOTS) {
      const eq = p.equipment[slot];
      if (!eq || eq.plus >= MAX_PLUS) continue;
      const elixirId = slot === 'weapon' ? 'elixir_weapon' : 'elixir_armor';
      if (this.botCount(p, elixirId) <= BOT_MATERIAL_RESERVE) continue; // keep a reserve
      const useLucky = enhanceChance(eq.plus, false) < BOT_LUCKY_BELOW_CHANCE
        && this.botCount(p, 'lucky_powder') > BOT_MATERIAL_RESERVE;
      this.applyAction(p, { t: 'enhance', slot, useLuckyPowder: useLucky });
      return; // at most one enhance attempt per tick
    }
  }

  // Pick the best enemy to engage. Braver as it levels (champions, then elites, then
  // the boss — and the boss only with the levels AND a potion stock). When hurt it
  // plays safe: normal mobs only, biased toward isolated ones (avoid pulling a pack).
  private botChooseTarget(p: Entity): Entity | undefined {
    const cautious = p.hp < p.maxHp * BOT_CAUTION_FRAC;
    const canBoss = !cautious && p.level >= BOT_BOSS_MIN_LEVEL
      && this.botCount(p, 'health_potion') >= BOT_BOSS_MIN_POTIONS;
    let best: Entity | undefined;
    let bestScore = Infinity;
    for (const e of this.ents.values()) {
      if (e.kind !== 'enemy' || e.hp <= 0) continue;
      if (e.boss) {
        if (!canBoss) continue;
      } else if (cautious && e.tier !== 'normal') {
        continue; // hurt -> leave the tough ones alone
      } else if (e.tier === 'elite' && p.level < BOT_ELITE_MIN_LEVEL) {
        continue;
      } else if (e.tier === 'champion' && p.level < BOT_CHAMPION_MIN_LEVEL) {
        continue;
      }
      let score = dist2(p, e);
      if (cautious) score += this.botClusterCount(e) * BOT_CLUSTER_PENALTY;
      if (best === undefined || score < bestScore || (score === bestScore && e.id < best.id)) {
        bestScore = score;
        best = e;
      }
    }
    return best;
  }

  // Fire the active kit smartly (not just spam): always land plain damage strikes in
  // reach (conserving MP on trivial foes), pop control (stun/knockdown) and the
  // mitigation/burst buffs only when they matter, and area sweeps only into a crowd.
  // useAbility still gates GCD / cooldown / MP / range, so this only decides INTENT.
  private botUseAbilities(p: Entity, target: Entity): void {
    const inReach = dist2(p, target) <= this.attackRange(p) ** 2;
    const tough = target.boss || target.tier !== 'normal';
    const hurt = p.hp < p.maxHp * BOT_CAUTION_FRAC;
    const targetControlled = target.effects.some((s) => s.kind === 'stun' || s.kind === 'knockdown');
    for (const def of this.activeMastery(p).abilities) {
      const fx = (k: StatusKind): boolean => def.effects?.some((e) => e.kind === k) ?? false;
      let want = false;
      if (def.kind === 'buff') {
        if (fx('defense')) want = tough || hurt; // brace only for a real fight / when low
        else if (fx('crit')) want = inReach && tough; // pop the burst only on a tough target
      } else if (fx('stun') || fx('knockdown')) {
        want = inReach && !targetControlled && (tough || hurt); // control when it counts
      } else if (def.shape === 'cone') {
        want = inReach && !hurt && this.botEnemiesInRange(p) >= 2; // sweep only a crowd
      } else if (def.charge) {
        want = dist2(p, target) <= (def.castRange ?? this.attackRange(p)) ** 2; // close the gap
      } else {
        // plain damage strike (main rotation): spend MP freely on tough foes; on trivial
        // ones only while MP is plentiful (no MP regen — save some for when it matters)
        want = inReach && (tough || p.mp > p.maxMp * BOT_SPEND_MP_FRAC);
      }
      if (want) this.applyAction(p, { t: 'use-ability', slot: def.slot });
    }
  }

  // ---------- bot helpers ----------
  // The nearest living enemy within `radius` (squared distance; id breaks ties).
  private nearestEnemyWithin(p: Entity, radius: number): Entity | undefined {
    const r2 = radius * radius;
    let best: Entity | undefined;
    let bestD2 = Infinity;
    for (const e of this.ents.values()) {
      if (e.kind !== 'enemy' || e.hp <= 0) continue;
      const d2 = dist2(p, e);
      if (d2 > r2) continue;
      if (best === undefined || d2 < bestD2 || (d2 === bestD2 && e.id < best.id)) {
        bestD2 = d2;
        best = e;
      }
    }
    return best;
  }

  // How many OTHER living enemies sit within a cluster radius of `e` (so the bot can
  // avoid pulling a whole pack when it's hurt).
  private botClusterCount(e: Entity): number {
    const r2 = BOT_CLUSTER_RADIUS * BOT_CLUSTER_RADIUS;
    let n = 0;
    for (const o of this.ents.values()) {
      if (o.kind !== 'enemy' || o.hp <= 0 || o.id === e.id) continue;
      if (dist2(e, o) <= r2) n++;
    }
    return n;
  }

  // Count of living enemies within the player's attack range (gates area abilities).
  private botEnemiesInRange(p: Entity): number {
    const r2 = this.attackRange(p) ** 2;
    let n = 0;
    for (const e of this.ents.values()) {
      if (e.kind === 'enemy' && e.hp > 0 && dist2(p, e) <= r2) n++;
    }
    return n;
  }

  // Total quantity of an item id across the bag (stacks may split by rarity/plus).
  private botCount(p: Entity, itemId: string): number {
    let n = 0;
    for (const s of p.bag) if (s.itemId === itemId) n += s.qty;
    return n;
  }

  // Surplus gear the bot would sell: any equippable item still in the bag (the best
  // is already worn, so a bag piece is spare) that's worth gold. Consumables and
  // alchemy materials are NOT junk — those are kept for survival/evolution.
  private botIsJunk(s: ItemStack): boolean {
    const def = ITEMS[s.itemId];
    return def?.slot != null && rarityStat(def.value ?? 0, s.rarity) > 0;
  }
  private botJunkCount(p: Entity): number {
    let n = 0;
    for (const s of p.bag) if (this.botIsJunk(s)) n += s.qty;
    return n;
  }

  // The first held stack of an item (so the bot uses the exact rarity/plus the
  // use-item command needs to match), or undefined if none is carried.
  private bagStack(p: Entity, itemId: string): ItemStack | undefined {
    return p.bag.find((s) => s.itemId === itemId && s.qty > 0);
  }

  // ---------- attributes ----------
  // Spend one unspent attribute point on Strength (more melee damage) or
  // Intelligence (more max MP). Refuses when no points are available. The freshly
  // granted MP is made usable immediately (there's no passive MP regen yet).
  private spendAttr(p: Entity, attr: 'str' | 'int'): void {
    if (p.attrPoints <= 0) return;
    p.attrPoints -= 1;
    if (attr === 'str') p.baseStr += ATTR_STR_PER_POINT;
    else p.baseInt += ATTR_INT_PER_POINT;
    this.recomputeStats(p);
    if (attr === 'int') p.mp = Math.min(p.maxMp, p.mp + MP_PER_INT);
  }

  // ---------- skill ranks (SP) ----------
  // Current rank of an ability for this entity (absent in the map => rank 1).
  private skillRank(p: Entity, def: AbilityDef): number {
    return p.skillRanks[def.id] ?? 1;
  }

  // Spend SP to raise the rank of the ability in `slot` of the ACTIVE kit. Refuses
  // (no cost) at the cap or without enough SP. Deterministic (no Rng). A higher rank
  // makes the ability hit harder and its effects last longer (see useAbility).
  private rankUp(p: Entity, slot: number): void {
    const def = this.activeMastery(p).abilities.find((a) => a.slot === slot);
    if (!def) return;
    const rank = this.skillRank(p, def);
    if (rank >= SKILL_MAX_RANK) return; // already maxed
    const cost = skillUpgradeCost(rank);
    if (cost <= 0 || p.sp < cost) return; // can't afford
    p.sp -= cost;
    p.skillRanks[def.id] = rank + 1;
  }

  // ---------- vendor (shop) ----------
  // Buy one of a vendor stock item. Requires being near the vendor and enough
  // gold; the item is added Normal/+0. Refuses (no charge) if the bag is full.
  private buy(p: Entity, itemId: string): void {
    if (!this.nearVendor(p)) return;
    const entry = VENDOR_STOCK.find((s) => s.itemId === itemId);
    if (!entry || p.gold < entry.price) return; // not sold here, or can't afford
    if (!addToBag(p.bag, itemId, 'normal', 0, 1)) return; // bag full -> no purchase, no charge
    p.gold -= entry.price;
  }

  // Sell one of a bag stack to the vendor for its (rarity-scaled) value. Requires
  // being near the vendor and actually holding that exact stack.
  private sell(p: Entity, itemId: string, rarity: Rarity, plus: number): void {
    if (!this.nearVendor(p)) return;
    const value = rarityStat(ITEMS[itemId]?.value ?? 0, rarity);
    if (value <= 0) return; // worthless here -> don't let the player give it away for nothing
    if (!removeFromBag(p.bag, itemId, rarity, plus, 1)) return; // must hold that exact stack
    p.gold += value;
  }

  // Pay the vendor to restore an equipped item's durability to full (GDD B8). Requires
  // being near the vendor and enough gold; refuses (no charge) at full or when broke.
  // Worn gear gives less of its bonus, so this buys the lost stats back.
  private repair(p: Entity, slot: EquipSlot): void {
    if (!this.nearVendor(p)) return;
    const eq = p.equipment[slot];
    if (!eq || eq.durability >= MAX_DURABILITY) return; // nothing to repair
    const cost = repairCost(eq.durability);
    if (cost <= 0 || p.gold < cost) return; // can't afford
    p.gold -= cost;
    eq.durability = MAX_DURABILITY;
    this.recomputeStats(p); // restore the full bonus now that it's repaired
  }

  // Whether the player is close enough to the vendor NPC to trade.
  private nearVendor(p: Entity): boolean {
    const v = this.ents.get(this.vendorId);
    if (!v) return false;
    const dx = p.x - v.x;
    const dz = p.z - v.z;
    return dx * dx + dz * dz <= VENDOR_INTERACT_RANGE * VENDOR_INTERACT_RANGE;
  }

  // Recompute EFFECTIVE stats = base (class + level) + sum of equipped gear.
  // Combat reads p.str/p.weaponDamage/p.maxHp/p.maxMp, so this is what makes a
  // weapon actually change auto-attack and ability damage. Current HP/MP are
  // clamped down if a max dropped (e.g. unequipping +HP armor).
  private recomputeStats(p: Entity): void {
    let bonusStr = 0;
    let bonusWeapon = 0;
    let bonusMaxHp = 0;
    let bonusMaxMp = 0;
    for (const slot of EQUIP_SLOTS) {
      const eq = p.equipment[slot];
      const stats = eq ? ITEMS[eq.itemId]?.stats : undefined;
      if (!eq || !stats) continue;
      // base -> rarity-scaled -> "+N"-scaled -> durability-scaled. Higher rarity AND
      // higher "+" grow the bonus; worn-down gear (low durability) gives less of it.
      // At full durability the factor is exactly 1, so equipping is unchanged.
      const dmul = durabilityFactor(eq.durability);
      const scale = (v: number): number => Math.round(enhanceStat(rarityStat(v, eq.rarity), eq.plus) * dmul);
      bonusStr += scale(stats.str ?? 0);
      bonusWeapon += scale(stats.weaponDamage ?? 0);
      bonusMaxHp += scale(stats.maxHp ?? 0);
      bonusMaxMp += scale(stats.maxMp ?? 0);
    }
    // The active weapon mastery's passive is always on (e.g. Lança's +HP).
    const passive = this.activeMastery(p).passive;
    bonusStr += passive.str ?? 0;
    bonusWeapon += passive.weaponDamage ?? 0;
    bonusMaxHp += passive.maxHp ?? 0;
    bonusMaxMp += passive.maxMp ?? 0;
    p.str = p.baseStr + bonusStr;
    p.weaponDamage = p.baseWeaponDamage + bonusWeapon;
    p.maxHp = p.baseMaxHp + bonusMaxHp;
    p.maxMp = p.baseMaxMp + p.baseInt * MP_PER_INT + bonusMaxMp; // Intelligence adds max MP
    if (p.hp > p.maxHp) p.hp = p.maxHp;
    if (p.mp > p.maxMp) p.mp = p.maxMp;
  }

  // ---------- weapon mastery ----------
  // The active mastery comes from the equipped weapon; unarmed (or a weapon with
  // no mastery tag) falls back to the Sword tree — the starter style.
  private activeMastery(p: Entity): MasteryDef {
    const w = p.equipment.weapon;
    const id = w ? ITEMS[w.itemId]?.mastery : undefined;
    return MASTERIES[id ?? DEFAULT_MASTERY] ?? MASTERIES[DEFAULT_MASTERY];
  }
  // How far this player's auto-attack and (non-charge) abilities reach — the
  // active mastery's range, or the default melee range when it sets none.
  private attackRange(p: Entity): number {
    return this.activeMastery(p).attackRange ?? MELEE_RANGE;
  }
  // The damage type this attacker's hits deal — the active mastery's type (the Mago's
  // staff is 'magical'; sword/spear/bow are 'physical'). Resolved here so the
  // auto-attack and every cast of a given mastery agree.
  private damageTypeOf(p: Entity): DamageType {
    return this.activeMastery(p).damageType ?? 'physical';
  }

  // Cast an action-bar ability from the active mastery's kit. Gated by the global
  // cooldown, the ability's own cooldown, MP, and (for targeted strikes) range —
  // all checked deterministically here. A successful cast deals its hit(s) and
  // emits the same damage event the auto-attack does, so numbers/flashes show.
  private useAbility(p: Entity, slot: number): void {
    const def = this.activeMastery(p).abilities.find((a) => a.slot === slot);
    if (!def) return;
    if (this.tick < p.gcdUntil) return; // global cooldown
    if (this.tick < (p.abilityReadyAt[slot] ?? 0)) return; // own cooldown
    if (p.mp < def.mpCost) return; // not enough MP

    // A self-buff (Postura Defensiva / Fúria) needs no target/range: spend the
    // cost, start the cooldowns, and apply its effects to the caster.
    if (def.kind === 'buff') {
      this.commitCast(p, def, slot);
      this.applyCastEffects(p, def, p);
      return;
    }

    // A cone sweep (Varredura) hits every enemy in front within reach — anchored
    // on the current target's direction when one is selected.
    if (def.shape === 'cone') {
      if (p.targetId == null) return; // press it with a target to orient the sweep
      const t = this.ents.get(p.targetId);
      if (!t || t.kind !== 'enemy' || t.hp <= 0) return;
      if (Math.hypot(t.x - p.x, t.z - p.z) > this.attackRange(p)) return; // anchor must be in reach
      p.facing = Math.atan2(t.x - p.x, t.z - p.z); // face the target so the cone is predictable
      this.commitCast(p, def, slot);
      for (const e of this.enemiesInCone(p)) {
        // One compute() per enemy => one crit roll per enemy, exactly as the old per-enemy
        // rollCrit. Same rng draw order, so the hash is unchanged.
        this.hitEnemy(e, combat.compute({
          attacker: p, ability: def, rank: this.skillRank(p, def), damageType: this.damageTypeOf(p),
          critChance: this.critChance(p), rng: this.rng,
        }), p);
        if (e.hp > 0) this.applyCastEffects(e, def, p);
      }
      return;
    }

    if (p.targetId == null) return;
    const t = this.ents.get(p.targetId);
    if (!t || t.kind !== 'enemy' || t.hp <= 0) return; // needs a living enemy target
    let dx = t.x - p.x;
    let dz = t.z - p.z;
    let dist = Math.hypot(dx, dz);

    // A charge (Investida) is a gap-closer: castable from afar, it dashes the
    // player to just within reach of the target, then strikes.
    if (def.charge) {
      if (dist > (def.castRange ?? this.attackRange(p))) return; // too far to charge
      this.dashTo(p, t);
      dx = t.x - p.x;
      dz = t.z - p.z;
      dist = Math.hypot(dx, dz);
    } else {
      // Actions are drained before movement, so this range/facing gate sees
      // start-of-tick positions (auto-attack checks post-move). One-tick edge on
      // the exact range boundary; deterministic either way.
      if (dist > this.attackRange(p)) return; // out of reach
      if (this.activeMastery(p).ranged) {
        if (dist > CONTACT_DIST) p.facing = Math.atan2(dx, dz); // pivot to shoot (kiting)
      } else if (dist > CONTACT_DIST && !inFrontOf(dx, dz, p.facing)) {
        return;
      }
    }
    this.commitCast(p, def, slot);
    this.hitEnemy(t, combat.compute({
      attacker: p, ability: def, rank: this.skillRank(p, def), damageType: this.damageTypeOf(p),
      critChance: this.critChance(p), rng: this.rng,
    }), p);
    // Debuff the target — only if it survived the hit.
    if (t.hp > 0) this.applyCastEffects(t, def, p);
  }

  // Spend MP and start the global + own cooldowns for a committed cast.
  private commitCast(p: Entity, def: AbilityDef, slot: number): void {
    p.mp -= def.mpCost;
    p.gcdUntil = this.tick + GCD_TICKS;
    p.abilityReadyAt[slot] = this.tick + Math.round(def.cooldownSecs * TICK_RATE);
  }

  // Dash the player to just inside attack range of a target (a gap-closer),
  // facing it. Clamped to the world, so it can never leave the map.
  private dashTo(p: Entity, t: Entity): void {
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const d = Math.hypot(dx, dz);
    if (d <= 0) return;
    const stop = Math.max(0, d - (this.attackRange(p) - 0.3)); // leave us in reach, not on top
    p.x = clamp(p.x + (dx / d) * stop, -WORLD_HALF, WORLD_HALF);
    p.z = clamp(p.z + (dz / d) * stop, -WORLD_HALF, WORLD_HALF);
    p.facing = Math.atan2(dx, dz);
  }

  // Every living enemy caught in the player's frontal cone within attack range
  // (anything overlapping us is included, mirroring the auto-attack's contact rule).
  private enemiesInCone(p: Entity): Entity[] {
    const range = this.attackRange(p);
    const hit: Entity[] = [];
    for (const e of this.ents.values()) {
      if (e.kind !== 'enemy' || e.hp <= 0) continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = Math.hypot(dx, dz);
      if (d > range) continue;
      if (d > CONTACT_DIST && !inFrontOf(dx, dz, p.facing)) continue;
      hit.push(e);
    }
    return hit;
  }

  // Apply an ability's status effects to `target` (the enemy for a strike, the
  // caster for a buff), converting the data-as-code seconds to ticks. `caster`
  // credits any DoT damage back to the player.
  private applyCastEffects(target: Entity, def: AbilityDef, caster: Entity): void {
    if (!def.effects) return;
    // A higher ability rank lengthens its effects (stun/slow/bleed/buff). We never
    // touch the magnitude (a slow/defense FACTOR), so rank can only make it stronger.
    const durMult = rankEffectMult(this.skillRank(caster, def));
    for (const ef of def.effects) {
      this.applyStatus(
        target, ef.kind, Math.round(ef.durationSecs * durMult * TICK_RATE),
        ef.magnitude ?? 0, ef.periodSecs ? Math.round(ef.periodSecs * TICK_RATE) : 0, caster.id,
      );
    }
  }

  // Tab: select the nearest living enemy in front; repeated presses cycle
  // through the front candidates (by distance). Falls back to any enemy when
  // nothing is in front, so Tab always grabs a target if one exists.
  private cycleTarget(p: Entity): void {
    const enemies: Entity[] = [];
    for (const e of this.ents.values()) {
      if (e.kind === 'enemy' && e.hp > 0) enemies.push(e);
    }
    if (enemies.length === 0) {
      p.targetId = null;
      return;
    }
    const inFront = enemies.filter((e) => inFrontOf(e.x - p.x, e.z - p.z, p.facing));
    const pool = inFront.length > 0 ? inFront : enemies;
    // Sort by distance; break ties by id so cycling is deterministic.
    pool.sort((a, b) => {
      const da = dist2(p, a);
      const db = dist2(p, b);
      return da !== db ? da - db : a.id - b.id;
    });
    const cur = pool.findIndex((e) => e.id === p.targetId);
    p.targetId = (cur === -1 ? pool[0] : pool[(cur + 1) % pool.length]).id;
  }

  // Click: select a specific entity. Only living enemies are valid targets;
  // anything else (self, dead, gone) is ignored so the current target stays.
  private setTarget(p: Entity, id: number | null): void {
    if (id == null) {
      p.targetId = null;
      return;
    }
    const e = this.ents.get(id);
    if (e && e.kind === 'enemy' && e.hp > 0) p.targetId = id;
  }

  private validateTarget(p: Entity): void {
    if (p.targetId == null) return;
    const t = this.ents.get(p.targetId);
    if (!t || t.kind !== 'enemy' || t.hp <= 0) p.targetId = null;
  }

  private stepPlayer(p: Entity): void {
    if (p.deadUntil !== 0) return; // frozen while a spirit
    if (this.isIncapacitated(p) || this.isRooted(p)) return; // can't move while stunned or rooted
    const intent = this.moveIntents.get(p.id);
    if (!intent || intent.t !== 'move') return;
    // Same integration the server runs (src/sim/movement.ts); slow debuffs cut speed.
    const m = applyMove(p.x, p.z, intent.dx, intent.dz, PLAYER_SPEED * this.slowFactor(p), DT, WORLD_HALF);
    if (!m) return;
    p.x = m.x;
    p.z = m.z;
    p.facing = m.facing;
  }

  // Enemy AI. An idle enemy pulls aggro when a living player comes within its
  // aggro radius; once aggroed it chases and bites in melee every swingTicks,
  // and leashes (drops aggro, heals to full, ambles back) if led past its leash
  // radius from where the chase began. The world boss never chases — it holds
  // its ground and only bites what steps into melee. Deterministic: movement is
  // arithmetic; only the idle wander destination draws from the sim Rng.
  // The nearest LIVING player to an entity. Multiplayer: an idle mob aggros whoever
  // is closest. Single-player: returns the one local player when it's alive, else
  // undefined — so the aggro check below behaves exactly as it did before.
  private nearestLivingPlayer(e: Entity): Entity | undefined {
    let best: Entity | undefined;
    let bestD2 = Infinity;
    for (const id of this.playerIds) {
      const p = this.ents.get(id);
      if (!p || p.hp <= 0) continue;
      const dx = p.x - e.x;
      const dz = p.z - e.z;
      const d2 = dx * dx + dz * dz;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
    return best;
  }

  private stepEnemy(e: Entity): void {
    if (this.isIncapacitated(e)) return; // stunned / knocked down -> does nothing this tick
    // Per-species / per-boss behavior. `sp` is the species template (undefined for a
    // boss); `bdef` is the boss def (undefined for a common mob). reach/move default to
    // the baseline wolf (MELEE_RANGE / ENEMY_SPEED), so a species that omits them behaves
    // exactly like the old wolf. A rooted boss (Alfa) never chases; a non-rooted boss
    // (Warlord) chases at its def speed. Bosses never wander, so they stay Rng-free.
    const sp = e.boss ? undefined : (SPECIES_BY_ID[e.species] ?? ENEMY_TEMPLATE);
    const bdef = e.boss ? (BOSS_DEF_BY_ID[e.species] ?? BOSS_DEFS[0]) : undefined;
    const tmpl = sp ?? bdef!.template; // for the aggro/leash radii (both shapes carry them)
    const rooted = bdef ? bdef.rooted : false; // a rooted boss holds its ground
    const reach = sp?.attackRange ?? MELEE_RANGE; // strike when the target is within this (boss = melee)
    const moveSpeed = (sp?.speed ?? (bdef ? bdef.speed : ENEMY_SPEED)) * this.slowFactor(e); // slow -> slower chase
    // A ranged species holds its distance (stop just inside its reach); a meleer
    // closes to CONTACT_DIST, byte-identical to the original wolf.
    const stopDist = reach > MELEE_RANGE ? reach - 0.5 : CONTACT_DIST;

    // --- decide aggro / leash ---
    if (e.targetId == null) {
      // idle: pull aggro toward the NEAREST living player within range (multiplayer:
      // a mob locks onto whoever is closest; single-player this is just the local one).
      const player = this.nearestLivingPlayer(e);
      // The central safe-zone is sanctuary: mobs never aggro a player standing in it.
      if (player && !zoneAt(player.x, player.z).safe) {
        const dx = player.x - e.x;
        const dz = player.z - e.z;
        if (dx * dx + dz * dz <= tmpl.aggroRadius * tmpl.aggroRadius) {
          e.targetId = player.id;
          e.homeX = e.x; // anchor the chase here (leash origin)
          e.homeZ = e.z;
          e.nextSwingAt = this.tick + e.swingTicks; // a beat of wind-up before the first bite
        }
      }
    } else {
      const t = this.ents.get(e.targetId);
      if (!t || t.hp <= 0) {
        // target gone or dead -> just drop aggro. (Player death is handled by the
        // death/respawn slice; we deliberately don't heal/reset here, so a boss
        // mid-fight with a downed player stays killable rather than resetting.)
        e.targetId = null;
      } else {
        // Leash if led past leashRadius from the anchor OR the (living) target
        // outran us by more than leashRadius. The second covers the rooted boss,
        // which never leaves its anchor — it disengages once the player walks off.
        const hx = e.x - e.homeX;
        const hz = e.z - e.homeZ;
        const tx = e.x - t.x;
        const tz = e.z - t.z;
        const lr2 = tmpl.leashRadius * tmpl.leashRadius;
        if (hx * hx + hz * hz > lr2 || tx * tx + tz * tz > lr2) {
          e.targetId = null;
          e.hp = e.maxHp; // reset to full, classic-MMO style (anti-kite)
          e.targetX = e.homeX; // amble back toward the anchor...
          e.targetZ = e.homeZ;
          e.repickAt = this.tick + 60; // ...before resuming the random wander
        }
      }
    }

    // --- act on the current target (re-fetched, so a JUST-acquired aggro chases
    // this very tick instead of wasting one on a stale lookup) ---
    const target = e.targetId != null ? this.ents.get(e.targetId) : undefined;
    if (target) {
      const dx = target.x - e.x;
      const dz = target.z - e.z;
      const dist = Math.hypot(dx, dz);
      // No bite while the target stands in the safe-zone (it can chase to the edge, but
      // the town is sanctuary — mobs don't attack there).
      if (dist <= reach && e.swingTicks > 0 && this.tick >= e.nextSwingAt && !zoneAt(target.x, target.z).safe) {
        e.nextSwingAt = this.tick + Math.round(e.swingTicks / this.slowFactor(e)); // slow -> slower bites
        // An enemy bite: a basic physical hit. critChance 0 => no crit roll (enemies never
        // crit today), so it draws NO rng — identical to the old direct meleeDamage call.
        this.hitPlayer(target, combat.compute({
          attacker: e, rank: 1, damageType: 'physical', critChance: 0, rng: this.rng,
        }));
        this.applyEnemyOnHit(e, target); // chance to inflict a status (slow / bleed / stun)
      }
      if (!rooted && !this.isRooted(e) && dist > stopDist) {
        // A rooted boss (and a stunned/rooted enemy) holds position — it only bites in
        // melee. Everything else closes the gap; a ranged species stops at stopDist
        // (just inside its reach) and shoots from there.
        const len = dist < 1e-4 ? 1 : dist;
        e.x = clamp(e.x + (dx / len) * moveSpeed * DT, -WORLD_HALF, WORLD_HALF);
        e.z = clamp(e.z + (dz / len) * moveSpeed * DT, -WORLD_HALF, WORLD_HALF);
        e.facing = Math.atan2(dx / len, dz / len);
      }
      return;
    }

    // Idle: the boss holds its ground; common enemies wander.
    if (e.boss) return;
    if (this.tick >= e.repickAt) {
      // Wander LOCALLY (around the current spot), so a mob roams its ring instead of
      // crossing the whole (now 300x300) world and leaving its zone. Same draw count as
      // before (2 range + 1 int), so the main Rng stream's shape is unchanged.
      e.targetX = clamp(e.x + this.rng.range(-WANDER_RADIUS, WANDER_RADIUS), -WORLD_HALF, WORLD_HALF);
      e.targetZ = clamp(e.z + this.rng.range(-WANDER_RADIUS, WANDER_RADIUS), -WORLD_HALF, WORLD_HALF);
      e.repickAt = this.tick + this.rng.int(40, 120); // re-pick every 2..6s
    }
    if (this.isRooted(e)) return; // rooted -> may pick a wander target but can't move to it
    const dx = e.targetX - e.x;
    const dz = e.targetZ - e.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return;
    e.x += (dx / len) * moveSpeed * DT;
    e.z += (dz / len) * moveSpeed * DT;
    e.facing = Math.atan2(dx / len, dz / len);
  }

  // Apply a melee hit to the player. Emits the same 'damage' event the player's
  // own swings use (so the renderer flashes the player and pops the number), and
  // downs the player when HP hits 0.
  private hitPlayer(p: Entity, hit: Damage): void {
    if (hit.amount <= 0 || p.deadUntil !== 0) return; // ignore hits on an already-downed spirit
    // Gear/armor mitigation (combat.mitigate): passthrough today (no armor yet), so
    // `incoming` === hit.amount. Then the Postura Defensiva BUFF — a temporary STATUS, not
    // gear — applies here at the apply step (GDD option A), floored at 1 so a mitigated blow
    // still registers; the event shows the ACTUAL HP lost.
    const incoming = combat.mitigate({ hit, target: p });
    const taken = Math.max(1, Math.round(incoming * this.defenseFactor(p)));
    p.hp = Math.max(0, p.hp - taken);
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'damage',
      targetId: p.id,
      amount: taken,
      x: p.x,
      z: p.z,
    });
    if (p.hp <= 0) this.killPlayer(p);
  }

  // ---------- status effects ----------
  // Apply (or refresh) a status effect on an entity. One effect per kind: a fresh
  // application of the same kind replaces the existing one.
  private applyStatus(
    e: Entity, kind: StatusKind, durTicks: number, magnitude = 0, periodTicks = 0, source = 0,
  ): void {
    if (durTicks <= 0) return;
    if (e.effects.length > 0) e.effects = e.effects.filter((s) => s.kind !== kind);
    e.effects.push({
      kind,
      expiresAt: this.tick + durTicks,
      magnitude,
      period: periodTicks,
      nextAt: kind === 'dot' ? this.tick + Math.max(1, periodTicks) : 0,
      source,
    });
  }

  // An enemy/boss can inflict a status on the player when its bite LANDS (slow, a
  // bleeding DoT, a brief stun…). The chance is rolled on a SEPARATE Rng (procRng),
  // so it never touches the main loot/position stream — a same-seed run is unaffected.
  // Only enemies do this to players (never the reverse); used with parsimony (the
  // `onHit` fields in content). Skips a downed spirit (and never procs without an onHit).
  private applyEnemyOnHit(e: Entity, target: Entity): void {
    if (target.kind !== 'player' || target.deadUntil !== 0) return;
    const onHit = e.boss
      ? (BOSS_DEF_BY_ID[e.species] ?? BOSS_DEFS[0]).template.onHit
      : (SPECIES_BY_ID[e.species] ?? ENEMY_TEMPLATE).onHit;
    if (!onHit || this.procRng.next() >= onHit.chance) return;
    this.applyStatus(
      target, onHit.kind, Math.round(onHit.durationSecs * TICK_RATE),
      onHit.magnitude ?? 0, onHit.periodSecs ? Math.round(onHit.periodSecs * TICK_RATE) : 0, e.id,
    );
  }

  // Stun and knockdown both prevent ALL action (move + attack + cast).
  private isIncapacitated(e: Entity): boolean {
    return e.effects.some((s) => s.kind === 'stun' || s.kind === 'knockdown');
  }
  private isRooted(e: Entity): boolean {
    return e.effects.some((s) => s.kind === 'root');
  }
  // The strongest active slow (smallest factor), or 1 when not slowed. Only honors
  // a valid slow factor in (0,1): magnitude<=0 (or a malformed/missing one) is
  // ignored, so it can never produce a 0/negative factor that divides into the
  // swing interval (Infinity / past-tick) or reverses movement.
  private slowFactor(e: Entity): number {
    let f = 1;
    for (const s of e.effects) {
      if (s.kind === 'slow' && s.magnitude > 0 && s.magnitude < f) f = s.magnitude;
    }
    return f;
  }
  // Incoming-damage multiplier from active 'defense' buffs (the strongest, i.e.
  // smallest, applies), or 1 when unbuffed. Mirrors slowFactor's clamp: only a
  // valid factor in (0,1) counts, so a malformed buff can never amplify damage.
  private defenseFactor(e: Entity): number {
    let f = 1;
    for (const s of e.effects) {
      if (s.kind === 'defense' && s.magnitude > 0 && s.magnitude < f) f = s.magnitude;
    }
    return f;
  }
  // Active crit chance (0..1): the active mastery's always-on baseCrit (Arco's
  // precision passive) plus any 'crit' buffs (Spear's Fúria), capped at 1.
  private critChance(e: Entity): number {
    let c = this.activeMastery(e).baseCrit ?? 0;
    for (const s of e.effects) if (s.kind === 'crit' && s.magnitude > 0) c += s.magnitude;
    return c > 1 ? 1 : c;
  }

  // Tick an entity's status effects: apply any DoT damage due this tick, then drop
  // expired effects. Called for every entity at the start of each tick.
  private stepStatuses(e: Entity): void {
    if (e.effects.length === 0) return;
    for (const s of e.effects) {
      if (s.kind !== 'dot') continue;
      const period = Math.max(1, s.period);
      while (this.tick >= s.nextAt && this.tick < s.expiresAt && e.hp > 0) {
        this.applyDotDamage(e, s.magnitude, s.source);
        s.nextAt += period;
      }
      if (e.hp <= 0) break; // died to the DoT — it may have been removed
    }
    if (e.effects.some((s) => this.tick >= s.expiresAt)) {
      e.effects = e.effects.filter((s) => this.tick < s.expiresAt);
    }
  }

  // Route DoT damage through the normal damage path (so it can kill, credit the
  // source for XP/loot, and trigger boss summons on HP thresholds).
  private applyDotDamage(e: Entity, dmg: number, source: number): void {
    if (dmg <= 0) return;
    // A DoT tick is a FIXED magnitude (no attacker-stat generation, no crit), so it does NOT
    // go through combat.compute. We wrap it in a Damage and route it through the SAME apply
    // path (so it still mitigates on the player, can kill, and credits the source for loot).
    const hit: Damage = { amount: dmg, type: 'physical', crit: false };
    if (e.kind === 'player') {
      this.hitPlayer(e, hit);
    } else if (e.kind === 'enemy') {
      // Credit the source if it still exists; otherwise credit no one (use the
      // victim as a non-player "killer" so killEnemy grants no XP/loot) rather
      // than handing the local player free credit for a kill it didn't cause.
      const killer = this.ents.get(source) ?? e;
      this.hitEnemy(e, hit, killer);
    }
  }

  // Down the player: enter the "spirit" state, schedule a respawn, and announce
  // the death. Enemies drop the player as a target via their hp<=0 de-aggro.
  private killPlayer(p: Entity): void {
    p.deadUntil = this.tick + DEATH_RESPAWN_TICKS;
    p.targetId = null;
    p.effects.length = 0; // death clears debuffs (no DoT/stun carrying into the spirit/respawn)
    // Death penalty (GDD B8): equipped gear loses durability (floored at 0). Worn gear
    // gives less of its stat bonus until repaired at the vendor — so repeated dying
    // (e.g. attriting the boss) makes you progressively weaker, at a gold cost to undo.
    let worn = false;
    for (const slot of EQUIP_SLOTS) {
      const eq = p.equipment[slot];
      if (eq && eq.durability > 0) {
        eq.durability = Math.max(0, eq.durability - DEATH_DURABILITY_LOSS);
        worn = true;
      }
    }
    if (worn) this.recomputeStats(p); // fold the weaker (worn) bonus into effective stats now
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'death',
      targetId: p.id,
      amount: 0,
      x: p.x,
      z: p.z,
      text: p.name,
    });
  }

  // Once the respawn delay elapses, revive the player at the safe point with
  // HP/MP restored. The wait is the (provisional) death penalty.
  private respawnPlayer(p: Entity): void {
    if (p.deadUntil === 0 || this.tick < p.deadUntil) return;
    p.deadUntil = 0;
    p.x = PLAYER_SPAWN_X;
    p.z = PLAYER_SPAWN_Z;
    this.recomputeStats(p); // keep effective maxHp/maxMp current, then top up
    p.hp = p.maxHp;
    p.mp = p.maxMp;
    p.targetId = null;
    this.moveIntents.set(p.id, { t: 'stop' }); // don't drift from a pre-death movement intent
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'respawn',
      targetId: p.id,
      amount: 0,
      x: p.x,
      z: p.z,
      text: p.name,
    });
  }

  // Deterministic fingerprint of world state — used by tests to prove that
  // the same seed + inputs produce the same world.
  hash(): string {
    let h = 2166136261 >>> 0;
    const mix = (n: number): void => {
      const q = Math.round(n * 1000) | 0; // quantize to avoid FP noise
      for (let b = 0; b < 4; b++) {
        h ^= (q >>> (b * 8)) & 0xff;
        h = Math.imul(h, 16777619) >>> 0;
      }
    };
    const ids = [...this.ents.keys()].sort((a, b) => a - b);
    for (const id of ids) {
      const e = this.ents.get(id)!;
      mix(id); mix(e.x); mix(e.z); mix(e.facing); mix(e.hp);
      mix(e.targetId == null ? 0 : e.targetId);
      mix(e.nextSwingAt);
      mix(e.homeX); mix(e.homeZ); // leash anchor (aggro/chase state)
      mix(e.targetX); mix(e.targetZ); mix(e.repickAt); // wander/leash-return scheduling
      mix(e.mp); mix(e.gcdUntil); mix(e.potionReadyAt); mix(e.deadUntil);
      // Per-slot ability cooldowns are gameplay state too (sibling of gcdUntil).
      // Fingerprint a fixed slot range so it stays complete across masteries.
      for (let slot = 1; slot <= MAX_ABILITY_SLOTS; slot++) mix(e.abilityReadyAt[slot] ?? 0);
      // Progression (level implies maxHp/maxMp, so they need not be mixed too).
      mix(e.level); mix(e.xp); mix(e.attrPoints);
      mix(e.baseStr); mix(e.baseInt); // spent attribute points (str/int)
      // Skill progression: the SP wallet + each ability's rank (sorted keys -> stable).
      mix(e.sp);
      for (const sid of Object.keys(e.skillRanks).sort()) { mix(strHash(sid)); mix(e.skillRanks[sid]); }
      // Economy & bag (stacks are in deterministic insertion order).
      mix(e.gold);
      for (const s of e.bag) {
        mix(strHash(s.itemId)); mix(strHash(s.rarity)); mix(s.plus); mix(s.qty);
      }
      // Equipped gear (effective str/weaponDamage/maxHp derive from these + base).
      for (const slot of EQUIP_SLOTS) {
        const eq = e.equipment[slot];
        mix(strHash(eq ? `${eq.itemId}:${eq.rarity}` : ''));
        mix(eq ? eq.plus : -1);
        mix(eq ? eq.durability : -1); // durability is gameplay state (it scales the bonus)
      }
      mix(strHash(e.tier)); // enemy strength tier (scales hp/damage/reward)
      // Active status effects (kind + timing/magnitude/source all drive future behavior).
      for (const s of e.effects) {
        mix(strHash(s.kind)); mix(s.expiresAt); mix(s.magnitude);
        mix(s.period); mix(s.nextAt); mix(s.source);
      }
    }
    // Pending respawns are deterministic state too (FIFO order is stable).
    for (const r of this.respawnQueue) { mix(r.at); mix(r.zone); }
    // Each boss's schedule (Infinity while alive -> sentinel) + summon progress.
    for (const s of this.bossState) {
      mix(s.entityId ?? -1);
      mix(Number.isFinite(s.spawnAt) ? s.spawnAt : -1);
      mix(s.summonsFired);
    }
    // Party state (deterministic order: parties by id with members in join order, then
    // pending invites by invitee id). Empty offline, so this adds nothing to the hash there.
    for (const pid of [...this.parties.keys()].sort((a, b) => a - b)) {
      const party = this.parties.get(pid)!;
      mix(party.id); mix(party.leaderId);
      mix(strHash(party.expMode)); mix(strHash(party.lootMode));
      for (const m of party.members) mix(m);
      mix(-1); // member-list terminator
    }
    for (const iid of [...this.pendingInvites.keys()].sort((a, b) => a - b)) {
      const inv = this.pendingInvites.get(iid)!;
      mix(iid); mix(inv.fromId); mix(inv.partyId);
    }
    // The monotonic event counter fingerprints "how much combat has happened".
    mix(this.nextEventSeq);
    mix(this.tick);
    return h.toString(16);
  }
}

function rarityDef(id: Rarity): RarityDef {
  return RARITIES.find((r) => r.id === id) ?? RARITIES[0];
}

// Lucky drop roll: most results are the common tier; rarer tiers have very low
// probability. Draws ONE value from the sim Rng (never Math.random). The last
// tier absorbs the remaining probability mass so rounding can't bias the roll.
export function rollRarity(rng: Rng, rarities: RarityDef[] = RARITIES): Rarity {
  const r = rng.next();
  let acc = 0;
  for (let i = 0; i < rarities.length - 1; i++) {
    acc += rarities[i].dropWeight;
    if (r < acc) return rarities[i].id;
  }
  return rarities[rarities.length - 1].id;
}

// Scale an equipped item's flat bonus by its rarity, so a rarer copy is
// stronger. Pure & deterministic. Provisional multipliers live in content.
export function rarityStat(value: number, rarity: Rarity): number {
  return Math.round(value * rarityDef(rarity).statMultiplier);
}

// Success chance of an enhance attempt from `plus` -> plus+1, optionally boosted
// by a Lucky Powder. 0 at the cap. Pure & deterministic.
export function enhanceChance(plus: number, lucky: boolean): number {
  if (plus < 0 || plus >= MAX_PLUS) return 0;
  const base = ENHANCE_SUCCESS[plus] ?? 0;
  return Math.min(ENHANCE_CHANCE_CAP, base + (lucky ? LUCKY_POWDER_BONUS : 0));
}

// A "+N" item's bonus: the rarity-scaled stat, then +ENHANCE_STAT_PER_PLUS per
// level. Pure & deterministic. So a higher "+" means a bigger stat.
export function enhanceStat(rarityScaled: number, plus: number): number {
  return Math.round(rarityScaled * (1 + ENHANCE_STAT_PER_PLUS * plus));
}

// True when the offset (dx,dz) points into the forward half-plane for `facing`
// (the actor's forward is +Z at facing 0). Used by both target cycling and the
// melee swing gate. Normalization is unnecessary — only the sign matters.
export function inFrontOf(dx: number, dz: number, facing: number): boolean {
  return dx * Math.sin(facing) + dz * Math.cos(facing) > 0;
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}

// A deterministic score for ranking gear the auto-play bot might wear: damage-
// weighted, with HP worth less and MP least. Folds in rarity and "+N" using the
// same scaling combat applies, so a rarer / more-enhanced piece ranks higher.
function botGearScore(itemId: string, rarity: Rarity, plus: number): number {
  const stats = ITEMS[itemId]?.stats;
  if (!stats) return -1;
  const v = (base?: number): number => enhanceStat(rarityStat(base ?? 0, rarity), plus);
  return v(stats.weaponDamage) * 2 + v(stats.str) * 2 + v(stats.maxHp) + v(stats.maxMp) * 0.5;
}

// The vendor's BUY price for an item id, or 0 if the vendor doesn't stock it.
function botPrice(itemId: string): number {
  return VENDOR_STOCK.find((s) => s.itemId === itemId)?.price ?? 0;
}

// Stable 32-bit hash of a string, for folding item ids into the world hash().
function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
