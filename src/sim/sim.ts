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
import { applyMove, slideThroughGates } from './movement';
import { type Party, maxPartySize, eachGetBonus, PARTY_SHARE_RANGE } from './party';
import type { Duel } from './pvp';
import type { Entity, ItemStack, EquippedItem } from './types';
import type {
  IWorld, EntityView, Command, SimEvent, AbilityView, InventoryView, ItemStackView, ShopView, StorageView, PetBagView, TeleporterView, TeleporterCityView, EquipSlot, Rarity, StallView, StallEntryView, MarketView, MarketListingView,
  StatusKind, DamageType, PartyView, PartyInviteView, DuelView, DuelInviteView, PartyExpMode, PartyLootMode,
} from '../world_api';
import { CLASSES, PLAYER_CLASS_BY_ID } from './content/classes';
import {
  ENEMY_TEMPLATE, ENEMY_TIERS, pickEnemyTier, speciesForLevel, SPECIES_BY_ID,
  levelHpMult, levelDamageMult, levelRewardMult,
} from './content/enemies';
import { SPAWN_ZONES, WORLD_HALF, RING_WIDTH, zoneAt, CITIES, type SpawnSpot } from './zones';
import { cityNear, cityById, cityIndex, teleporterEntityId, TELEPORT_COST, RETURN_COOLDOWN_SECS, TELEPORTER_NAME } from './teleport';
import { LOOT_DESPAWN_SECS, DEATH_DROP_CHANCE, LOOT_PICKUP_RANGE, PET_GRAB_RADIUS } from './loot';
import { MASTERIES, DEFAULT_MASTERY, abilityUnlockLevel, type AbilityDef, type MasteryDef } from './content/abilities';
import { ITEMS, POTION_COOLDOWN_SECS } from './content/items';
import { meetsLevelReq, equipLevelReq } from './content/degrees';
import { RARITIES, type RarityDef } from './content/rarity';
import { BOSS_DEFS, BOSS_DEF_BY_ID, type BossDef } from './content/bosses';
import {
  MAX_PLUS, RISK_FLOOR, BREAK_CHANCE, DROP_ON_FAIL, PROTECT_STONE_ID,
} from './content/enhance';
import { enhanceChance, enhanceStat, resolveEnhance, needsBreakRoll } from './enhance';
import {
  SKILL_MAX_RANK, skillUpgradeCost, skillSpInvested, rankEffectMult,
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
import { BAG_SLOTS, EQUIP_SLOTS, STORAGE_SLOTS, PETBAG_SLOTS, addToBag, removeFromBag, freeBagSlots, moveBagSlot } from './inventory';
import {
  WAREHOUSE_NAME, WAREHOUSE_SPAWN_X, WAREHOUSE_SPAWN_Z, WAREHOUSE_INTERACT_RANGE, WAREHOUSE_ENTITY_ID,
  depositStack, withdrawStack, canAccept, depositToPet, withdrawFromPet,
} from './storage';
import { toSave, applySave, type PlayerSave } from './save';
import {
  VENDOR_NAME, VENDOR_INTERACT_RANGE, VENDOR_STOCK,
  TOWN_SHOPS, shopEntityId, type VendorStockEntry,
} from './content/vendor';

// Fresh, fully-populated equipment record (every slot null). One source so every
// spawn literal stays exhaustive under TS strict when EQUIP_SLOTS changes.
function emptyEquipment(): Record<EquipSlot, EquippedItem | null> {
  const eq = {} as Record<EquipSlot, EquippedItem | null>;
  for (const slot of EQUIP_SLOTS) eq[slot] = null;
  return eq;
}

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE; // seconds per tick
// The world half-extent comes from the zone model now (the outermost ring's edge -> a
// 300x300 world). Re-exported so every existing importer (render, ui, tests) keeps
// getting WORLD_HALF from sim unchanged.
export { WORLD_HALF };

export const PLAYER_SPEED = 6; // units/sec (also reused by the authoritative server)
// GDD v0.5 (Pets): a summoned pet trails its owner. Slightly faster than the player so it catches up,
// then idles within a deadband so it doesn't jitter on top of them. Pure follow (applyMove), no Rng.
const PET_FOLLOW_SPEED = PLAYER_SPEED * 1.25;
const PET_FOLLOW_DEADBAND = 1.6; // world units: closer than this, the pet stands still
const PET_SPAWN_OFFSET = 1.4; // spawn just behind the owner so it doesn't pop on top of them
// GDD v0.5 (Stalls): a buyer must be within this of a stall's owner to trade; a stall offers at most N items.
const STALL_INTERACT_RANGE = 5; // world units
const STALL_MAX_LISTINGS = 12;
// Global marketplace: at most N listings per seller (anti-spam). Buys move ONE unit, from anywhere.
const MARKET_MAX_PER_SELLER = 12;
// City wall (Jangan): a square stone rampart at this Chebyshev half-extent — MUST match render's
// WALL_H in village.ts. The player can't cross it except through a gate gap of ±GATE_HALF at each
// cardinal mid-point (slightly wider than the visual ~2 opening, for comfortable passage).
export const CITY_WALL_HALF = 26;
export const GATE_HALF = 2.5;
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
// Out-of-combat regen (Silkroad-style sustain). After a short lull with no damage dealt OR taken,
// a player slowly restores HP and MP — so the farm loop flows (and a caster isn't stranded with no
// mana). Deterministic: a fixed per-second tick, no Rng. In-combat regen stays OFF (tension intact).
export const REGEN_LINGER_TICKS = 5 * TICK_RATE; // seconds after the last hit before regen resumes
const REGEN_PERIOD_TICKS = TICK_RATE; // apply once per second (cheap + clean per-second numbers)
const REGEN_HP_FRAC = 0.02; // HP restored per second out of combat (~50s to full) — gentle, tunable
const REGEN_MP_FRAC = 0.02; // MP restored per second out of combat (mirrors HP)
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
export const BOT_MATERIAL_RESERVE = 2; // never spend a material (Elixir/Pedra) below this count
const BOT_ENHANCE_SAFE_RADIUS = 11; // only enhance during a lull (nearest enemy beyond this)
const BOT_LOOT_RADIUS = 20; // the bot walks to ground loot within this radius to grab it (GDD v0.5 loot físico)
// Target selection: braver as it levels up
const BOT_CHAMPION_MIN_LEVEL = 3;
const BOT_ELITE_MIN_LEVEL = 5;
const BOT_BOSS_MIN_LEVEL = 8;
const BOT_BOSS_MIN_POTIONS = 3; // attempt the world boss only with a stock of potions
const BOT_CLUSTER_RADIUS = 6; // other enemies within this of a candidate form a "cluster"
const BOT_CLUSTER_PENALTY = 100; // when cautious, bias away from clustered targets (units²)
export const EVENT_TTL_TICKS = TICK_RATE; // keep presentation events ~1s for the renderer
export const GCD_TICKS = Math.round(1.5 * TICK_RATE); // 1.5s global cooldown between abilities
// Auto-attack damage is normalized to this baseline cadence (Espada / 2.0s): a weapon's swingTime changes
// only the FEEL (rhythm + per-hit number), not its auto-DPS — see combat.OffenseContext.autoMult (Opção A).
export const AUTO_DPS_BASE_SWING = 2.0;
export const POTION_COOLDOWN_TICKS = Math.round(POTION_COOLDOWN_SECS * TICK_RATE); // shared "potion sickness"
export const RETURN_COOLDOWN_TICKS = Math.round(RETURN_COOLDOWN_SECS * TICK_RATE); // GDD v0.5: free Return recall cooldown
export const LOOT_DESPAWN_TICKS = Math.round(LOOT_DESPAWN_SECS * TICK_RATE); // GDD v0.5: ground-loot lifetime before it vanishes

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
// Strength also raises max HP (Silkroad: Str = physical damage + HP + phys def). Each point of
// Strength adds STR_TO_HP max HP. Applied to baseMaxHp when a point is SPENT (see spendAttr) — NOT
// from p.baseStr in recompute — because the class's innate base Strength must NOT inflate baseline
// HP (Intelligence has no such base, so Int -> MP can live in recompute; Str can't).
export const STR_TO_HP = 10;
// XP needed to go from `level` to level+1. Integer curve (no Math.pow, so it's
// bit-exact across engines): 25·L·(L+1) => L1:50, L2:150, L3:300, L4:500...
// With a 25-XP wolf that's ~2 kills for level 2, ramping gently after.
export function xpForLevel(level: number): number {
  return 25 * level * (level + 1);
}

// Level cap. The ceiling follows the CONTENT: the deepest zone is ring10 (level-10 mobs), so
// leveling stops at 10 — the Silkroad principle of a cap that tracks the top zone and rises with
// each world expansion (80→90→100→110), scaled to our compact world. Below the cap everything
// lands (gear reqLevel ≤ 8, skills unlock ≤ nv 7), leaving the 8→10 climb as the at-cap endgame
// grind. Raise this when the map gains rings.
export const LEVEL_CAP = 10;

// Party (social) commands — applied even when a player's auto-play (bot) is ON, since
// auto-play owns only combat + movement, not the player's group membership.
// Social commands work even while auto-play (bot) is ON — the bot owns only combat + movement.
const SOCIAL_COMMANDS: ReadonlySet<Command['t']> = new Set([
  'party-create', 'party-invite', 'party-accept', 'party-refuse', 'party-leave', 'party-kick', 'party-admit',
  'duel-challenge', 'duel-accept', 'duel-decline',
]);

export class Sim implements IWorld {
  tick = 0;

  private rng: Rng;
  private tierRng: Rng; // independent substream for enemy-tier rolls (see constructor)
  private procRng: Rng; // independent substream for enemy on-hit status procs (see constructor)
  private spawnRng: Rng; // independent substream for zone spawn POSITIONS (see constructor)
  private dropRng: Rng; // independent substream for player-death loot drops (GDD v0.5; never perturbs the main stream)
  // GDD v0.5 (loot físico): ids of the kind 'loot' ground items in this.ents, so the despawn scan is O(loot) not O(all).
  private lootIds = new Set<number>();
  private ents = new Map<number, Entity>();
  // O3 — entities() view cache. Built lazily on first read each tick and reused by every caller
  // (render/ui hit it ~8x/frame) until step()/addPlayer/removePlayer/restorePlayer invalidate it.
  // PURE presentation cache: hash() reads `this.ents` directly (never entities()), so memoizing
  // the projection cannot change the determinism fingerprint.
  private entityViewCache: ReadonlyArray<EntityView> | null = null;
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
  // PvP duel (Tier 1 A1). Consensual 1v1, authoritative here (mutated only by commands) and folded
  // into the hash. Offline single-player never duels, so these stay empty and the hash is unchanged.
  // No PvP damage yet — A1 is only the challenge/accept handshake (the damage is A2).
  private nextDuelId = 1;
  private duels = new Map<number, Duel>(); // duelId -> duel
  private duelOf = new Map<number, number>(); // playerId -> duelId (absent = not dueling)
  private duelInvites = new Map<number, number>(); // inviteeId -> challengerId
  // Ticks at which a dead enemy should respawn (FIFO; processed each tick).
  private respawnQueue: { at: number; zone: number }[] = []; // {when, which ring} to refill
  // World bosses: one runtime slot per entry in BOSS_DEFS (same order). Each tracks
  // the live entity id (null when dead), the tick its next spawn is due (Infinity
  // while alive), and how many summon waves it has fired this life. Tick-driven; no Rng.
  private bossState = BOSS_DEFS.map((d) => ({ entityId: null as number | null, spawnAt: d.firstSpawnTick, summonsFired: 0 }));
  // Per-boss damage ledger: bossEntityId -> (playerId -> total damage dealt over the boss's life).
  // The biggest contributor is credited with the kill/loot (Silkroad uniques), not the last hit.
  // Pure bookkeeping (deterministic, not part of the world hash); single-player = the one player.
  private bossDamage = new Map<number, Map<number, number>>();
  // Recent presentation events (damage numbers, hit flashes). Bounded by age
  // (EVENT_TTL_TICKS) so it never grows unbounded; `seq` is monotonic forever.
  private events: SimEvent[] = [];
  private nextEventSeq = 1;

  // The town vendor NPC's entity id (a fixed, non-combat shopkeeper).
  private vendorId = 0;
  // Shop NPCs: entity id -> the stock that NPC sells. Built at spawn (fixed, no Rng). Lets shopFor/buy
  // resolve against the NEAREST shop NPC in range — so the single all-in-one vendor can later split into
  // specialized shops (ferreiro/armadureiro/…) with no change to the buy/sell path. Not hashed (static).
  private shopStock = new Map<number, readonly VendorStockEntry[]>();
  // The town WAREHOUSE keeper NPC's entity id (K5 — the armazém/banco interaction anchor).
  private warehouseId = 0;
  // Auto-play: the set of player ids whose bot is ON. The bot drives each of those
  // players (survive/evolve) through the SAME applyAction path a human's commands use,
  // and manual input from a bot-driven player is ignored. Per-player so the server can
  // run a bot for each client independently; single-player just has the one local id.
  private botPlayers = new Set<number>();
  // GDD v0.5 (Pets): the summoned pet per owner (ownerId -> pet entity id). The pet itself lives in
  // this.ents (so it hashes + snapshots like any entity); this is the lookup that drives follow/grab and
  // the petActive HUD flag. Rebuilt deterministically from the set-pet command stream on every host.
  private petOf = new Map<number, number>();
  // GDD v0.5 (Stalls): per-player personal shops — sellerId -> the items offered (with prices). IN the sim
  // (unlike the guild registry) because gold + items are HASHED gameplay state both hosts must agree on;
  // the prices are deterministic and fold into the hash. A seller has at most one open stall.
  private stalls = new Map<number, { itemId: string; rarity: Rarity; plus: number; price: number }[]>();
  // Global marketplace: listingId -> a reference to a seller's bag stack + per-unit price. IN the sim
  // (gold + items are hashed). Buyable from ANYWHERE; the item stays in the seller's bag until sold
  // (re-validated at buy), so nothing is escrowed and there's nothing to return on disconnect.
  // Global marketplace — listings hold the ESCROWED item (taken out of the seller's bag) + the seller's
  // NAME + a per-unit price, so a sale can happen while the seller is OFFLINE. IN the sim (gold+items are
  // hashed); anti-dup is free (single-threaded tick). Persisted as a blob (serializeMarket) — survives restart.
  private marketListings = new Map<number, { sellerName: string; item: ItemStack; price: number }>();
  // Sale proceeds + returned items waiting for a player to collect (keyed by LOWERCASED name). Persisted.
  private mailbox = new Map<string, { gold: number; items: ItemStack[] }>();
  private nextMarketId = 1;

  // `spawnLocal` controls whether a local player is created; `localName` is its name.
  // The default 'Hero' keeps offline + tests bit-identical to before; the name-entry
  // screen passes the player's chosen name (identity only — never part of the item
  // save). Offline keeps the default — one local player. The SERVER
  // passes `false`: it has NO local player and instead adds networked players via
  // addPlayer(), so its world is purely the connected clients + the shared mobs.
  constructor(seed: number, spawnLocal = true, localName = 'Hero') {
    this.rng = new Rng(seed);
    // Enemy tiers roll from an INDEPENDENT deterministic substream so adding the
    // feature doesn't reshuffle the main loot/position Rng — worlds stay comparable.
    this.tierRng = new Rng((seed ^ 0x9e3779b9) >>> 0);
    // Enemy on-hit status PROCS roll from their own substream, so a mob/boss
    // debuffing the player never perturbs the main loot/position stream.
    this.procRng = new Rng((seed ^ 0xc2b2ae35) >>> 0);
    // And zone spawn POSITIONS roll from their own substream, so scattering mobs across
    // the rings never perturbs the main loot/position stream (determinism stays clean).
    this.spawnRng = new Rng((seed ^ 0x165667b1) >>> 0);
    // And player-death loot drops roll from their own substream, so dropping items on death never
    // perturbs the main loot/position stream (the world stays comparable across the feature).
    this.dropRng = new Rng((seed ^ 0x4f574d41) >>> 0);
    if (spawnLocal) {
      this.localId = this.spawnPlayer(localName);
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
    this.vendorId = this.spawnShops(); // 4 specialized shop NPCs at RESERVED ids; returns the boticário (bot anchor)
    this.warehouseId = this.spawnWarehouse(); // RESERVED id
    this.spawnTeleporters(); // GDD v0.5 TP3: one hub NPC per city, RESERVED ids
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
    this.invalidateEntityViews(); // O3: added an entity outside step()
    return id;
  }

  // Remove a networked player (on disconnect). Drops its per-player state and clears
  // any enemy that was aggroed on it, so no mob chases a ghost.
  removePlayer(id: number): void {
    // Leave any party first (promotes a new leader / dissolves a now-too-small party, and
    // cancels the player's outbound invites), then drop this player's OWN pending invite.
    this.removeFromParty(id);
    this.removeFromDuel(id); // a disconnecting duelist dissolves its duel + clears its challenges
    this.pendingInvites.delete(id);
    this.ents.delete(id);
    this.moveIntents.delete(id);
    this.pendings.delete(id);
    this.botPlayers.delete(id);
    // GDD v0.5 (Pets): a disconnecting owner takes its pet with it (despawn the follower + drop the index).
    const petId = this.petOf.get(id);
    if (petId !== undefined) { this.ents.delete(petId); this.petOf.delete(id); }
    this.stalls.delete(id); // GDD v0.5 (Stalls): a disconnecting seller closes their stall
    // Global marketplace: listings + mailbox PERSIST across disconnect (keyed by name; the item is escrowed
    // in the listing) — that's what lets a sale happen while the seller is offline. Nothing to clean up here.
    const i = this.playerIds.indexOf(id);
    if (i >= 0) this.playerIds.splice(i, 1);
    for (const e of this.ents.values()) if (e.targetId === id) e.targetId = null;
    this.invalidateEntityViews(); // O3: removed an entity outside step()
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
    this.invalidateEntityViews(); // O3: restore mutated projected fields outside step()
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
      basePhyDef: 0, baseMagDef: 0, phyDef: 0, magDef: 0, // K3: defense (player starts with none innate)
      swingTicks: Math.round(cls.swingTime * TICK_RATE), nextSwingAt: 0,
      mp: cls.baseMp, maxMp: cls.baseMp, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0, combatUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      // SPARSE/positional bag: a fixed 20-slot grid (holes = null) so a drag-placed item keeps its slot.
      gold: 0, bag: Array(BAG_SLOTS).fill(null), storage: [], equipment: emptyEquipment(), effects: [], tier: 'normal',
      species: '',
      boss: false, summoned: false, spawnZone: -1,
      homeX: 0, homeZ: 0,
      returnCity: 'town', // GDD v0.5: registered city (Return recall + respawn point); default = central town
      returnReadyAt: 0,
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
    // Each ring spawns its OWN species (GDD v0.3 §G3 / Silkroad: every area has its own
    // creature) — a deterministic anel→espécie map keyed by the ring's level, no species roll.
    const sp = speciesForLevel(zone.level);
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
      basePhyDef: 0, baseMagDef: 0, phyDef: 0, magDef: 0, // K3: enemies have no defense (take full damage)
      swingTicks: Math.round(sp.swingTime * TICK_RATE), nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0, combatUntil: 0,
      level, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      gold: 0, bag: [], storage: [], equipment: emptyEquipment(), effects: [], tier: tier.id,
      species: sp.id,
      boss: false, summoned: false, spawnZone: zoneIndex,
      homeX: x, homeZ: z,
      returnCity: '', // N/A: player-only state
      returnReadyAt: 0,
      targetX: x, targetZ: z, repickAt: 0,
    });
  }

  // The town vendor: a fixed, non-combat NPC. kind 'npc' keeps it out of every
  // enemy code path (no wander, no aggro, not targetable/attackable).
  // A fixed, non-combat town NPC (vendor/warehouse/teleporter shape): full HP, no swing, no aggro, not
  // targetable. Position is its home (it never wanders). Factored so every fixed NPC is byte-identical.
  private makeFixedNpc(id: number, name: string, x: number, z: number, species: string): Entity {
    return {
      id, kind: 'npc', name,
      x, z, facing: 0,
      hp: 100, maxHp: 100,
      targetId: null,
      str: 0, weaponDamage: 0,
      baseStr: 0, baseWeaponDamage: 0, baseMaxHp: 100, baseMaxMp: 0,
      basePhyDef: 0, baseMagDef: 0, phyDef: 0, magDef: 0, // K3
      swingTicks: 0, nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0, combatUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      gold: 0, bag: [], storage: [], equipment: emptyEquipment(), effects: [], tier: 'normal',
      species, // the gameplay/shop tag AND the renderer's model key (not hashed)
      boss: false, summoned: false, spawnZone: -1,
      homeX: x, homeZ: z,
      returnCity: '', // N/A: player-only state
      returnReadyAt: 0,
      targetX: x, targetZ: z, repickAt: 0,
    };
  }

  // Spawn the town's SPECIALIZED shop NPCs (Silkroad-style: ferreiro/armadureiro/boticário/alquimista),
  // each at a RESERVED id with the stock it sells registered in shopStock. No Rng (fixed spots) -> doesn't
  // perturb the stream. Returns the BOTICÁRIO's id: the auto-play bot's town-run anchors there (potions are
  // its critical restock; it sells/repairs at any shop and finds alchemy materials from drops).
  private spawnShops(): number {
    let anchorId = 0;
    TOWN_SHOPS.forEach((shop, i) => {
      const id = shopEntityId(i);
      this.ents.set(id, this.makeFixedNpc(id, shop.name, shop.x, shop.z, shop.species));
      this.shopStock.set(id, shop.stock);
      if (shop.species === 'apothecary') anchorId = id;
    });
    return anchorId;
  }

  // The town WAREHOUSE keeper NPC (armazém) — same fixed, non-combat NPC shape as the vendor,
  // at a distinct spot (10,18). Spawned AFTER the vendor so the vendor stays the first 'npc'
  // (tests/UI that find "the npc" still resolve to the vendor). The bank items live on each
  // PLAYER (Entity.storage); this NPC is only the interaction anchor.
  private spawnWarehouse(): number {
    const id = WAREHOUSE_ENTITY_ID; // RESERVED id (not this.nextId) — keeps networked player ids/positions stable
    this.ents.set(id, {
      id, kind: 'npc', name: WAREHOUSE_NAME,
      x: WAREHOUSE_SPAWN_X, z: WAREHOUSE_SPAWN_Z, facing: 0,
      hp: 100, maxHp: 100,
      targetId: null,
      str: 0, weaponDamage: 0,
      baseStr: 0, baseWeaponDamage: 0, baseMaxHp: 100, baseMaxMp: 0,
      basePhyDef: 0, baseMagDef: 0, phyDef: 0, magDef: 0,
      swingTicks: 0, nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0, combatUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      gold: 0, bag: [], storage: [], equipment: emptyEquipment(), effects: [], tier: 'normal',
      species: 'warehouse', // cosmetic tag so the renderer can give the bank keeper its own model (not hashed)
      boss: false, summoned: false, spawnZone: -1,
      homeX: WAREHOUSE_SPAWN_X, homeZ: WAREHOUSE_SPAWN_Z,
      returnCity: '', // N/A: player-only state
      returnReadyAt: 0,
      targetX: WAREHOUSE_SPAWN_X, targetZ: WAREHOUSE_SPAWN_Z, repickAt: 0,
    });
    return id;
  }

  // A teleporter NPC at the CENTRE of every city (GDD v0.5 TP3) — the visible, clickable travel hub.
  // Same fixed, non-combat NPC shape as the vendor/warehouse, but one per CITIES and tagged
  // species 'teleporter' (the renderer picks its look + the UI opens the menu on a click). RESERVED
  // ids (teleporterEntityId, above the warehouse's) keep networked player id allocation stable.
  // Spawned AFTER the warehouse so the town vendor stays the first 'npc'. The teleport/register/return
  // RULES already live in the sim (TP1/TP2, proximity via cityNear); this NPC is only the anchor.
  private spawnTeleporters(): void {
    for (const city of CITIES) {
      const id = teleporterEntityId(city.id); // RESERVED, stable across sessions (never from nextId)
      this.ents.set(id, {
        id, kind: 'npc', name: TELEPORTER_NAME,
        x: city.cx, z: city.cz, facing: 0,
        hp: 100, maxHp: 100,
        targetId: null,
        str: 0, weaponDamage: 0,
        baseStr: 0, baseWeaponDamage: 0, baseMaxHp: 100, baseMaxMp: 0,
        basePhyDef: 0, baseMagDef: 0, phyDef: 0, magDef: 0,
        swingTicks: 0, nextSwingAt: 0,
        mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0, combatUntil: 0,
        level: 1, xp: 0, attrPoints: 0, baseInt: 0,
        sp: 0, skillRanks: {},
        gold: 0, bag: [], storage: [], equipment: emptyEquipment(), effects: [], tier: 'normal',
        species: 'teleporter',
        boss: false, summoned: false, spawnZone: -1,
        homeX: city.cx, homeZ: city.cz,
        returnCity: '', // N/A: player-only state
        returnReadyAt: 0,
        targetX: city.cx, targetZ: city.cz, repickAt: 0,
      });
    }
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
      basePhyDef: 0, baseMagDef: 0, phyDef: 0, magDef: 0, // K3
      swingTicks: Math.round(t.swingTime * TICK_RATE), nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0, combatUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      gold: 0, bag: [], storage: [], equipment: emptyEquipment(), effects: [], tier: 'normal',
      species: t.id, // the boss id, so kill/summon/render resolve its def
      boss: true, summoned: false, spawnZone: -1,
      homeX: def.spawnX, homeZ: def.spawnZ,
      returnCity: '', // N/A: player-only state
      returnReadyAt: 0,
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
  // minion species' combat with the def's minion HP/name/render-species.
  private spawnMinion(x: number, z: number, def: BossDef): void {
    const id = this.nextId++;
    // Combat matches the minion's species (the Alfa summons skeleton_minion, the Warlord
    // skeleton_rogue) so movement and bite stay consistent; an unknown id falls back to the
    // base ENEMY_TEMPLATE.
    const ms = SPECIES_BY_ID[def.minionSpecies] ?? ENEMY_TEMPLATE;
    this.ents.set(id, {
      id, kind: 'enemy', name: def.template.minionName,
      x, z, facing: 0,
      hp: def.template.minionHp, maxHp: def.template.minionHp,
      targetId: null,
      str: ms.str, weaponDamage: ms.weaponDamage,
      baseStr: 0, baseWeaponDamage: 0, baseMaxHp: def.template.minionHp, baseMaxMp: 0,
      basePhyDef: 0, baseMagDef: 0, phyDef: 0, magDef: 0, // K3
      swingTicks: Math.round(ms.swingTime * TICK_RATE), nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0, combatUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      gold: 0, bag: [], storage: [], equipment: emptyEquipment(), effects: [], tier: 'normal',
      species: def.minionSpecies,
      boss: false, summoned: true, spawnZone: -1,
      homeX: x, homeZ: z,
      returnCity: '', // N/A: player-only state
      returnReadyAt: 0,
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

  // The active-skill list for a SPECIFIC player (live cooldown/GCD/MP/rank state) — the WHOLE kit, locked
  // and unlocked, each flagged with `unlocked`/`unlockLevel` (Sistema 1). The server queries this per
  // client; IWorld abilities() uses the local one. The HUD renders only the unlocked ones on the action
  // bar (the bar grows with level) and previews the locked ones greyed in the skills panel.
  abilitiesFor(id: number): ReadonlyArray<AbilityView> {
    const p = this.ents.get(id);
    const src = p ? this.activeMastery(p).abilities : MASTERIES[DEFAULT_MASTERY].abilities;
    return src.filter((def) => def.kind !== 'passive').map((def) => this.projectSkill(p, def));
  }

  passives(): ReadonlyArray<AbilityView> {
    return this.passivesFor(this.localId);
  }

  // The learnable PASSIVE skills for a SPECIFIC player (Sistema 2) — the active mastery's passives (locked
  // AND unlocked, flagged), so the skills panel can preview + rank them. NEVER the action bar (abilitiesFor);
  // passives are always-on and never cast.
  passivesFor(id: number): ReadonlyArray<AbilityView> {
    const p = this.ents.get(id);
    const src = p ? this.activeMastery(p).abilities : MASTERIES[DEFAULT_MASTERY].abilities;
    return src.filter((def) => def.kind === 'passive').map((def) => this.projectSkill(p, def));
  }

  // Project one ability/passive def into its live AbilityView (or the default kit when p is undefined).
  // Carries the destrave flags (Sistema 1: unlocked/unlockLevel) so the HUD can grow the action bar and
  // preview locked skills. A locked or passive skill is never "ready" to cast.
  private projectSkill(p: Entity | undefined, def: AbilityDef): AbilityView {
    const passive = def.kind === 'passive';
    const unlocked = p ? this.skillUnlocked(p, def) : true;
    const cdLeft = p && !passive ? Math.max(0, (p.abilityReadyAt[def.slot] ?? 0) - this.tick) : 0;
    const gcdLeft = p && !passive ? Math.max(0, p.gcdUntil - this.tick) : 0;
    const rank = p ? this.skillRank(p, def) : 1;
    return {
      slot: def.slot,
      name: def.name,
      icon: def.icon,
      mpCost: passive ? 0 : def.mpCost,
      ready: passive ? unlocked : unlocked && !!p && cdLeft === 0 && gcdLeft === 0 && p.mp >= def.mpCost,
      cooldownRemaining: cdLeft * DT, // ticks -> seconds (0 for passives / no player)
      cooldownTotal: passive ? 0 : def.cooldownSecs,
      rank,
      maxRank: SKILL_MAX_RANK,
      rankCost: skillUpgradeCost(rank),
      unlocked,
      unlockLevel: abilityUnlockLevel(def),
    };
  }

  inventory(): InventoryView {
    return this.inventoryFor(this.localId);
  }

  // The bag + equipment for a SPECIFIC player (the server sends this to its owner each
  // snapshot). The IWorld inventory() uses the local player.
  inventoryFor(id: number): InventoryView {
    const p = this.ents.get(id);
    // Build a view for ONE stack; reused to produce the positional `slots` and the dense `stacks`.
    const toView = (s: ItemStack): ItemStackView => {
      const def = ITEMS[s.itemId];
      return {
        itemId: s.itemId,
        name: def?.name ?? s.itemId,
        qty: s.qty,
        rarity: s.rarity,
        rarityName: rarityDef(s.rarity).name,
        plus: s.plus,
        equipSlot: def?.slot,
        consumable: def?.consumable != null,
        sellValue: rarityStat(def?.value ?? 0, s.rarity),
        // K2 degrees: grau do item + requisito de nível + se o DONO (p) pode equipar agora.
        // Só faz sentido para equipáveis (têm slot); não-equipáveis ficam undefined.
        degree: def?.degree,
        reqLevel: def && def.slot != null ? equipLevelReq(def) : undefined,
        canEquip: def && def.slot != null ? meetsLevelReq(def, p ? p.level : 1) : undefined,
      };
    };
    // POSITIONAL view: one entry per grid cell (null = empty hole), ALWAYS length === capacity (the
    // seam contract) — even with no player. DENSE view: holes filtered out.
    const slots: (ItemStackView | null)[] = p ? p.bag.map((s) => (s ? toView(s) : null)) : new Array(BAG_SLOTS).fill(null);
    const stacks = slots.filter((s): s is ItemStackView => s != null);
    const equipment = EQUIP_SLOTS.map((slot) => {
      const eq = p ? p.equipment[slot] : null;
      return {
        slot,
        itemId: eq?.itemId ?? null,
        name: eq ? (ITEMS[eq.itemId]?.name ?? eq.itemId) : null,
        rarity: eq?.rarity ?? null,
        rarityName: eq ? rarityDef(eq.rarity).name : null,
        plus: eq?.plus ?? 0,
        enhanceChance: eq ? enhanceChance(eq.plus) : 0,
        // K4 alchemy risk readout (0 / gentle below RISK_FLOOR).
        breakChance: eq && eq.plus >= RISK_FLOOR ? (BREAK_CHANCE[eq.plus] ?? 0) : 0,
        dropOnFail: eq && eq.plus >= RISK_FLOOR ? (DROP_ON_FAIL[eq.plus] ?? 1) : 1,
        durability: eq?.durability ?? 0,
        maxDurability: eq ? MAX_DURABILITY : 0,
        repairCost: eq ? repairCost(eq.durability) : 0,
      };
    });
    return { capacity: BAG_SLOTS, stacks, slots, equipment };
  }

  shop(): ShopView {
    return this.shopFor(this.localId);
  }

  // The storefront for a SPECIFIC player: the NEAREST shop NPC in range and ITS stock (`inRange`
  // depends on that player's position). The IWorld shop() uses the local player. Near a shop -> show
  // that shop's catalog; otherwise keep the catalog title greyed (with one all-in-one vendor that's the
  // vendor — the click-to-open-a-specific-shop model supersedes this fallback later).
  shopFor(id: number): ShopView {
    const p = this.ents.get(id);
    const shop = p ? this.nearestShop(p) : null;
    const stock = shop ? shop.stock : VENDOR_STOCK;
    return {
      name: shop ? shop.npc.name : VENDOR_NAME,
      stock: stock.map((s) => ({
        itemId: s.itemId,
        name: ITEMS[s.itemId]?.name ?? s.itemId,
        price: s.price,
      })),
      inRange: shop != null,
    };
  }

  storage(): StorageView {
    return this.storageFor(this.localId);
  }

  // The warehouse (armazém) contents for a SPECIFIC player. `inRange` depends on that player's
  // position; the items themselves live on the player (Entity.storage). Mirrors inventoryFor's
  // stack mapping (storage holds no equipment).
  storageFor(id: number): StorageView {
    const p = this.ents.get(id);
    const stacks = p
      ? p.storage.filter((s): s is ItemStack => s != null).map((s) => {
          const def = ITEMS[s.itemId];
          return {
            itemId: s.itemId,
            name: def?.name ?? s.itemId,
            qty: s.qty,
            rarity: s.rarity,
            rarityName: rarityDef(s.rarity).name,
            plus: s.plus,
            equipSlot: def?.slot,
            consumable: def?.consumable != null,
            sellValue: rarityStat(def?.value ?? 0, s.rarity),
          };
        })
      : [];
    return { name: WAREHOUSE_NAME, capacity: STORAGE_SLOTS, stacks, inRange: p ? this.nearWarehouse(p) : false };
  }

  petBag(): PetBagView {
    return this.petBagFor(this.localId);
  }

  // GDD v0.5 (Pets PET2): the transport pet's portable bag for a SPECIFIC player. `available` = a pet is
  // summoned (the bag rides with it; no NPC). Mirrors storageFor's stack mapping.
  petBagFor(id: number): PetBagView {
    const p = this.ents.get(id);
    const stacks = p && p.petBag
      ? p.petBag.filter((s): s is ItemStack => s != null).map((s) => {
          const def = ITEMS[s.itemId];
          return {
            itemId: s.itemId,
            name: def?.name ?? s.itemId,
            qty: s.qty,
            rarity: s.rarity,
            rarityName: rarityDef(s.rarity).name,
            plus: s.plus,
            equipSlot: def?.slot,
            consumable: def?.consumable != null,
            sellValue: rarityStat(def?.value ?? 0, s.rarity),
          };
        })
      : [];
    return { name: 'Mochila do Pet', capacity: PETBAG_SLOTS, stacks, available: this.petActiveFor(id) };
  }

  teleporter(): TeleporterView {
    return this.teleporterFor(this.localId);
  }

  // The teleporter menu state for a SPECIFIC player (TP3): the city list + fixed cost, the city they're
  // standing at (for "register here"), their registered Return city, and whether Return is usable now
  // (off cooldown AND not in combat — mirrors the returnToCity gate). The IWorld teleporter() uses the
  // local player; the server calls this per client for the SelfSnap.
  teleporterFor(id: number): TeleporterView {
    const p = this.ents.get(id);
    const at = p ? cityNear(p.x, p.z) : null;
    const cities: TeleporterCityView[] = CITIES.map((c) => ({
      id: c.id,
      name: c.name,
      cost: at && at.id === c.id ? 0 : TELEPORT_COST,
      current: at != null && at.id === c.id,
    }));
    const onCooldown = p != null && this.tick < p.returnReadyAt;
    const inFight = p != null && this.inCombat(p);
    let blocked: string | null = null;
    if (!p) blocked = 'Indisponível';
    else if (inFight) blocked = 'Em combate';
    else if (onCooldown) blocked = `Cooldown: ${Math.ceil((p.returnReadyAt - this.tick) / TICK_RATE)}s`;
    return {
      inRange: at != null,
      atCityId: at?.id ?? null,
      registeredCityId: p?.returnCity ?? 'town',
      cities,
      returnReady: p != null && !onCooldown && !inFight,
      returnBlockedReason: blocked,
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

  // Sistema 15 (QoL): the local player's auto-pot HP threshold (IWorld autoPotHpPct() uses the local player).
  autoPotHpPct(): number {
    return this.autoPotHpPctFor(this.localId);
  }
  // A SPECIFIC player's auto-pot HP threshold (the server reads this per client for that player's HUD).
  autoPotHpPctFor(id: number): number {
    return this.ents.get(id)?.autoPotHpPct ?? 0;
  }
  // Sistema 15 (QoL, Fatia 2): the local player's auto-pot MP threshold.
  autoPotMpPct(): number {
    return this.autoPotMpPctFor(this.localId);
  }
  autoPotMpPctFor(id: number): number {
    return this.ents.get(id)?.autoPotMpPct ?? 0;
  }

  // GDD v0.5 (Pets): whether THIS player has a pet summoned (IWorld petActive() uses the local player).
  petActive(): boolean {
    return this.petActiveFor(this.localId);
  }
  petActiveFor(id: number): boolean {
    return this.petOf.has(id);
  }

  // Owning the pet = holding the pet item (bought from the vendor). Permanent — summoning never consumes it.
  private ownsPet(p: Entity): boolean {
    return p.bag.some((s) => s != null && s.itemId === 'pet_grab');
  }

  // Summon the owned pet: spawn an inert kind 'pet' follower just behind the owner (no-op if one is
  // already out or the player doesn't own one). The pet lives in this.ents so it draws/snapshots/hashes
  // like any entity; combat/AI ignore kind 'pet' exactly as they ignore 'loot'/'npc'.
  private summonPet(owner: Entity): void {
    if (this.petOf.has(owner.id) || !this.ownsPet(owner)) return;
    const id = this.nextId++;
    this.ents.set(id, {
      id, kind: 'pet', name: 'Coletor',
      x: owner.x - PET_SPAWN_OFFSET, z: owner.z - PET_SPAWN_OFFSET, facing: owner.facing,
      hp: 1, maxHp: 1,
      targetId: null,
      str: 0, weaponDamage: 0,
      baseStr: 0, baseWeaponDamage: 0, baseMaxHp: 1, baseMaxMp: 0,
      basePhyDef: 0, baseMagDef: 0, phyDef: 0, magDef: 0,
      swingTicks: 0, nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0, combatUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      gold: 0, bag: [], storage: [], equipment: emptyEquipment(), effects: [], tier: 'normal',
      species: 'pet_grab',
      boss: false, summoned: false, spawnZone: -1,
      homeX: owner.x, homeZ: owner.z,
      returnCity: '', returnReadyAt: 0,
      targetX: owner.x, targetZ: owner.z, repickAt: 0,
      pet: { ownerId: owner.id },
    });
    this.petOf.set(owner.id, id);
  }

  // Dismiss the pet: remove the follower entity + the index. No-op if none is out.
  private dismissPet(owner: Entity): void {
    const petId = this.petOf.get(owner.id);
    if (petId === undefined) return;
    this.ents.delete(petId);
    this.petOf.delete(owner.id);
  }

  // GDD v0.5 (Pets): each summoned pet trails its owner. Pure follow via applyMove (deterministic, no
  // Rng); a deadband stops it jittering on top of the owner. Sorted by owner id for a stable order.
  private stepPets(): void {
    if (this.petOf.size === 0) return;
    for (const ownerId of [...this.petOf.keys()].sort((a, b) => a - b)) {
      const pet = this.ents.get(this.petOf.get(ownerId)!);
      const owner = this.ents.get(ownerId);
      if (!pet || !owner) continue;
      // follow: trail the owner, idling inside the deadband so it doesn't jitter on top of them
      const dx = owner.x - pet.x, dz = owner.z - pet.z;
      if (Math.hypot(dx, dz) > PET_FOLLOW_DEADBAND) {
        const m = applyMove(pet.x, pet.z, dx, dz, PET_FOLLOW_SPEED, DT, WORLD_HALF);
        if (m) { pet.x = m.x; pet.z = m.z; pet.facing = m.facing; }
      }
      this.petGrabNearby(owner, pet); // GDD v0.5 (Pets) PET1: vacuum ground loot near the pet into the owner's bag
    }
  }

  // GDD v0.5 (Pets) PET1: the summoned pet auto-collects ground loot within PET_GRAB_RADIUS of the PET into
  // the OWNER's bag — FFA, like the manual pickup, just automated (the loot-físico work made the drops; the
  // pet gathers them). Deterministic: snapshots lootIds (insertion order, stable across hosts since loot
  // spawns deterministically); reuses addToBag, and a full bag simply leaves the loot on the ground.
  private petGrabNearby(owner: Entity, pet: Entity): void {
    if (this.lootIds.size === 0) return;
    for (const lootId of [...this.lootIds]) {
      const e = this.ents.get(lootId);
      if (!e || !e.loot) continue;
      const dx = pet.x - e.x, dz = pet.z - e.z;
      if (dx * dx + dz * dz > PET_GRAB_RADIUS * PET_GRAB_RADIUS) continue; // out of the pet's reach
      const s = e.loot.stack;
      if (!addToBag(owner.bag, s.itemId, s.rarity, s.plus, s.qty)) continue; // bag full -> leave it on the ground
      this.ents.delete(lootId);
      this.lootIds.delete(lootId);
    }
  }

  // ---------- Stalls (GDD v0.5 §5): personal P2P shops + the atomic transfer ----------
  // IWorld seam: the open stall the LOCAL player is in range of (to browse + buy), or null.
  stall(): StallView | null {
    return this.stallFor(this.localId);
  }

  // The open stall a buyer is within range of (the nearest seller with a stall), or null. Built per-buyer
  // like shopFor; `qty` is read LIVE from the seller's bag, and sold-out lines are hidden.
  stallFor(buyerId: number): StallView | null {
    const buyer = this.ents.get(buyerId);
    if (!buyer) return null;
    let best: Entity | null = null;
    let bestD = STALL_INTERACT_RANGE * STALL_INTERACT_RANGE;
    for (const [sellerId, listings] of this.stalls) {
      if (sellerId === buyerId || listings.length === 0) continue;
      const seller = this.ents.get(sellerId);
      if (!seller) continue;
      const dx = buyer.x - seller.x, dz = buyer.z - seller.z;
      const d = dx * dx + dz * dz;
      if (d <= bestD) { bestD = d; best = seller; }
    }
    if (!best) return null;
    const entries: StallEntryView[] = [];
    for (const l of this.stalls.get(best.id)!) {
      let qty = 0;
      for (const s of best.bag) if (s != null && s.itemId === l.itemId && s.rarity === l.rarity && s.plus === l.plus) qty += s.qty;
      if (qty <= 0) continue; // hide a sold-out line
      entries.push({ itemId: l.itemId, name: ITEMS[l.itemId]?.name ?? l.itemId, rarity: l.rarity, plus: l.plus, price: l.price, qty });
    }
    return { sellerId: best.id, sellerName: best.name, entries, inRange: true };
  }

  // GDD v0.5 (Stalls) ST0 — the ATOMIC, dup-proof P2P transfer of ONE unit + gold. Validates EVERYTHING
  // (seller still holds it, buyer can afford it, buyer has room so addToBag CANNOT fail) BEFORE any
  // mutation; every early return leaves BOTH players byte-identical, so no item is removed-without-added
  // (destroy) or added-without-removed (dup). Pure (no Rng); both bags + golds already fold into the hash.
  // Single-threaded tick = no races: two buyers of one stack serialize, the second aborts (stack gone).
  private transferItem(seller: Entity, buyer: Entity, itemId: string, rarity: Rarity, plus: number, price: number): boolean {
    if (seller.id === buyer.id) return false; // no self-trade
    let have = 0;
    for (const s of seller.bag) if (s != null && s.itemId === itemId && s.rarity === rarity && s.plus === plus) have += s.qty;
    if (have < 1) return false; // seller no longer holds it
    if (buyer.gold < price) return false; // buyer can't afford it
    if (!canAccept(buyer.bag, itemId, rarity, plus, BAG_SLOTS)) return false; // buyer has no room -> abort (addToBag would fail)
    // all checks passed -> the four mutations below are infallible
    removeFromBag(seller.bag, itemId, rarity, plus, 1);
    addToBag(buyer.bag, itemId, rarity, plus, 1, BAG_SLOTS);
    buyer.gold -= price;
    seller.gold += price;
    return true;
  }

  // ST1 — open a personal stall offering bag items at owner-set prices. A listing is kept only if the
  // player holds the item and the price is a positive integer; re-opening replaces the prior stall.
  private openStall(p: Entity, requested: ReadonlyArray<{ itemId: string; rarity: Rarity; plus: number; price: number }>): void {
    if (!Array.isArray(requested)) return;
    const listings: { itemId: string; rarity: Rarity; plus: number; price: number }[] = [];
    for (const r of requested) {
      if (listings.length >= STALL_MAX_LISTINGS) break;
      if (!r || !Number.isInteger(r.price) || r.price <= 0) continue; // free/garbage price rejected
      const holds = p.bag.some((s) => s != null && s.itemId === r.itemId && s.rarity === r.rarity && s.plus === r.plus);
      if (!holds) continue; // can only list what you carry
      if (listings.some((l) => l.itemId === r.itemId && l.rarity === r.rarity && l.plus === r.plus)) continue; // dedupe
      listings.push({ itemId: r.itemId, rarity: r.rarity, plus: r.plus, price: r.price });
    }
    if (listings.length === 0) this.stalls.delete(p.id);
    else this.stalls.set(p.id, listings);
  }

  private closeStall(p: Entity): void {
    this.stalls.delete(p.id);
  }

  // ST2 — buy ONE unit of a listed item from a seller's stall. Gated on proximity to the seller + the
  // listing existing, then runs the atomic transferItem; re-validates at apply time (a stale/absent seller
  // is a no-op). Drops the listing once the seller runs out.
  private stallBuy(buyer: Entity, sellerId: number, itemId: string, rarity: Rarity, plus: number): void {
    const seller = this.ents.get(sellerId);
    if (!seller || seller.kind !== 'player') return;
    const listings = this.stalls.get(sellerId);
    if (!listings) return; // no open stall
    const listing = listings.find((l) => l.itemId === itemId && l.rarity === rarity && l.plus === plus);
    if (!listing) return; // not offered
    const dx = buyer.x - seller.x, dz = buyer.z - seller.z;
    if (dx * dx + dz * dz > STALL_INTERACT_RANGE * STALL_INTERACT_RANGE) return; // too far from the stall
    if (!this.transferItem(seller, buyer, itemId, rarity, plus, listing.price)) return; // atomic; clean abort on any failure
    const stillHas = seller.bag.some((s) => s != null && s.itemId === itemId && s.rarity === rarity && s.plus === plus);
    if (!stillHas) {
      const i = listings.indexOf(listing);
      if (i >= 0) listings.splice(i, 1);
      if (listings.length === 0) this.stalls.delete(sellerId);
    }
  }

  // ---------- Global Marketplace: list / browse / buy from ANYWHERE, even with the seller OFFLINE ----------
  // IWorld seam: the global board + the local player's mailbox of proceeds.
  market(): MarketView {
    return this.marketFor(this.localId);
  }

  // The global board (same listings for everyone) + the VIEWER's mailbox (proceeds to collect). The listed
  // item is ESCROWED in the listing, so the seller needn't be online; `own` is per-viewer (by name).
  marketFor(viewerId: number): MarketView {
    const vkey = (this.ents.get(viewerId)?.name ?? '').toLowerCase();
    const listings: MarketListingView[] = [];
    for (const lid of [...this.marketListings.keys()].sort((a, b) => a - b)) {
      const l = this.marketListings.get(lid)!;
      listings.push({
        id: lid, sellerName: l.sellerName,
        itemId: l.item.itemId, name: ITEMS[l.item.itemId]?.name ?? l.item.itemId,
        rarity: l.item.rarity, plus: l.item.plus, price: l.price, qty: l.item.qty,
        own: l.sellerName.toLowerCase() === vkey,
      });
    }
    const mb = this.mailbox.get(vkey);
    const mailboxItems = mb ? mb.items.reduce((n, s) => n + s.qty, 0) : 0;
    return { listings, mailboxGold: mb?.gold ?? 0, mailboxItems };
  }

  // List a bag stack for sale globally: ESCROW the whole stack OUT of the bag into the listing, so it can
  // sell while you're offline. Validates a positive-int price, ownership, and the per-seller cap.
  private marketList(p: Entity, itemId: string, rarity: Rarity, plus: number, price: number): void {
    if (!Number.isInteger(price) || price <= 0) return;
    let qty = 0;
    for (const s of p.bag) if (s != null && s.itemId === itemId && s.rarity === rarity && s.plus === plus) qty += s.qty;
    if (qty <= 0) return; // must hold it
    let mine = 0;
    for (const l of this.marketListings.values()) if (l.sellerName.toLowerCase() === p.name.toLowerCase()) mine++;
    if (mine >= MARKET_MAX_PER_SELLER) return; // anti-spam cap
    if (!removeFromBag(p.bag, itemId, rarity, plus, qty)) return; // escrow: take it out of the bag
    this.marketListings.set(this.nextMarketId++, { sellerName: p.name, item: { itemId, rarity, plus, qty }, price });
  }

  // Cancel YOUR listing: return the escrowed item to your bag (overflow -> your mailbox), drop the listing.
  private marketCancel(p: Entity, listingId: number): void {
    const l = this.marketListings.get(listingId);
    if (!l || l.sellerName.toLowerCase() !== p.name.toLowerCase()) return; // only the owner cancels
    this.marketListings.delete(listingId);
    if (!addToBag(p.bag, l.item.itemId, l.item.rarity, l.item.plus, l.item.qty, BAG_SLOTS)) {
      this.mailboxAddItem(p.name, l.item); // bag full -> hold the returned stack in the mailbox
    }
  }

  // Buy ONE unit from ANYWHERE (no proximity; the seller may be OFFLINE). The item comes from the listing's
  // ESCROW; the gold goes to the seller's MAILBOX. Anti-dup is free (single-threaded tick serializes buys).
  private marketBuy(buyer: Entity, listingId: number): void {
    const l = this.marketListings.get(listingId);
    if (!l) return;
    if (l.sellerName.toLowerCase() === buyer.name.toLowerCase()) return; // can't buy your own (cancel instead)
    if (buyer.gold < l.price) return; // can't afford it
    if (!canAccept(buyer.bag, l.item.itemId, l.item.rarity, l.item.plus, BAG_SLOTS)) return; // no room -> abort
    // all checks passed -> the mutations are infallible (no dup: the escrow qty decrements atomically)
    addToBag(buyer.bag, l.item.itemId, l.item.rarity, l.item.plus, 1, BAG_SLOTS);
    buyer.gold -= l.price;
    this.creditMailboxGold(l.sellerName, l.price);
    l.item.qty -= 1;
    if (l.item.qty <= 0) this.marketListings.delete(listingId); // sold out
  }

  // Collect your mailbox: credit the proceeds gold + pull returned items into your bag (overflow stays in
  // the mailbox for next time). Driven by the market-collect command.
  private marketCollect(p: Entity): void {
    const key = p.name.toLowerCase();
    const mb = this.mailbox.get(key);
    if (!mb) return;
    p.gold += mb.gold;
    mb.gold = 0;
    const remaining: ItemStack[] = [];
    for (const s of mb.items) {
      if (!addToBag(p.bag, s.itemId, s.rarity, s.plus, s.qty, BAG_SLOTS)) remaining.push(s); // bag full -> keep for later
    }
    mb.items = remaining;
    if (mb.gold === 0 && mb.items.length === 0) this.mailbox.delete(key);
  }

  // ---- mailbox helpers (proceeds + returned items, keyed by lowercased name) ----
  private creditMailboxGold(name: string, gold: number): void {
    const key = name.toLowerCase();
    const mb = this.mailbox.get(key) ?? { gold: 0, items: [] as ItemStack[] };
    mb.gold += gold;
    this.mailbox.set(key, mb);
  }
  private mailboxAddItem(name: string, item: ItemStack): void {
    const key = name.toLowerCase();
    const mb = this.mailbox.get(key) ?? { gold: 0, items: [] as ItemStack[] };
    const existing = mb.items.find((s) => s.itemId === item.itemId && s.rarity === item.rarity && s.plus === item.plus);
    if (existing) existing.qty += item.qty;
    else mb.items.push({ ...item });
    this.mailbox.set(key, mb);
  }

  // ---- Marketplace persistence (server-side blob; DATA-ONLY, no Rng/tick — like serializePlayer) ----
  serializeMarket(): {
    listings: { id: number; sellerName: string; item: ItemStack; price: number }[];
    mailbox: { name: string; gold: number; items: ItemStack[] }[];
    nextId: number;
  } {
    return {
      listings: [...this.marketListings.entries()].map(([id, l]) => ({ id, sellerName: l.sellerName, item: { ...l.item }, price: l.price })),
      mailbox: [...this.mailbox.entries()].map(([name, mb]) => ({ name, gold: mb.gold, items: mb.items.map((s) => ({ ...s })) })),
      nextId: this.nextMarketId,
    };
  }

  // Apply an UNTRUSTED persisted blob (Postgres JSON) back onto the marketplace, DEFENSIVELY — any
  // malformed listing/mailbox entry is skipped, so a corrupt row can't break the sim (never throws).
  restoreMarket(raw: unknown): void {
    this.marketListings.clear();
    this.mailbox.clear();
    this.nextMarketId = 1;
    if (!raw || typeof raw !== 'object') return;
    const r = raw as { listings?: unknown; mailbox?: unknown; nextId?: unknown };
    const stack = (v: unknown): ItemStack | null => {
      if (!v || typeof v !== 'object') return null;
      const s = v as Record<string, unknown>;
      if (typeof s.itemId !== 'string' || !ITEMS[s.itemId]) return null;
      if (s.rarity !== 'normal' && s.rarity !== 'sos' && s.rarity !== 'som' && s.rarity !== 'sun') return null;
      if (!Number.isInteger(s.plus) || (s.plus as number) < 0) return null;
      if (!Number.isInteger(s.qty) || (s.qty as number) < 1) return null;
      return { itemId: s.itemId, rarity: s.rarity, plus: s.plus as number, qty: s.qty as number };
    };
    let maxId = 0;
    if (Array.isArray(r.listings)) {
      for (const e of r.listings) {
        if (!e || typeof e !== 'object') continue;
        const o = e as Record<string, unknown>;
        const item = stack(o.item);
        if (typeof o.id !== 'number' || !Number.isInteger(o.id) || typeof o.sellerName !== 'string' || !o.sellerName ||
            !item || typeof o.price !== 'number' || !Number.isInteger(o.price) || o.price <= 0) continue;
        if (this.marketListings.has(o.id)) continue;
        this.marketListings.set(o.id, { sellerName: o.sellerName, item, price: o.price });
        maxId = Math.max(maxId, o.id);
      }
    }
    this.nextMarketId = typeof r.nextId === 'number' && Number.isInteger(r.nextId) && r.nextId > maxId ? r.nextId : maxId + 1;
    if (Array.isArray(r.mailbox)) {
      for (const e of r.mailbox) {
        if (!e || typeof e !== 'object') continue;
        const o = e as Record<string, unknown>;
        if (typeof o.name !== 'string' || !o.name) continue;
        const gold = typeof o.gold === 'number' && Number.isInteger(o.gold) && o.gold >= 0 ? o.gold : 0;
        const items: ItemStack[] = [];
        if (Array.isArray(o.items)) for (const it of o.items) { const s = stack(it); if (s) items.push(s); }
        if (gold > 0 || items.length > 0) this.mailbox.set(o.name.toLowerCase(), { gold, items });
      }
    }
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

  // PvP duel (Tier 1 A1) — consensual 1v1, mirroring the party invite/accept handshake. Challenge an
  // online player by name; they accept (forms the pair) or decline. NO damage yet (that's A2): A1
  // only tracks who challenged whom and who is paired. All pure mutations, no Rng — determinism-safe.
  private challengeDuel(p: Entity, name: string): void {
    if (this.duelOf.has(p.id)) return; // already dueling
    for (const tid of this.playerIds) {
      if (tid === p.id) continue;
      const t = this.ents.get(tid);
      if (!t || t.kind !== 'player' || t.name !== name) continue;
      if (this.duelOf.has(tid) || this.duelInvites.has(tid)) continue; // dueling / already challenged
      this.duelInvites.set(tid, p.id);
      return; // first match only (name is not unique; mirrors inviteToParty)
    }
  }

  // The challenged player accepts: form the duel pair if both are still online and not already
  // dueling. Always clears the pending challenge.
  private acceptDuel(p: Entity): void {
    const fromId = this.duelInvites.get(p.id);
    if (fromId === undefined) return;
    this.duelInvites.delete(p.id);
    if (this.duelOf.has(p.id)) return; // paired meanwhile
    const from = this.ents.get(fromId);
    if (!from || from.kind !== 'player' || this.duelOf.has(fromId)) return; // challenger gone / now dueling
    const id = this.nextDuelId++;
    const a = Math.min(p.id, fromId);
    const b = Math.max(p.id, fromId);
    this.duels.set(id, { id, a, b });
    this.duelOf.set(a, id);
    this.duelOf.set(b, id);
  }

  // Decline (drop the pending challenge).
  private declineDuel(p: Entity): void {
    this.duelInvites.delete(p.id);
  }

  // Remove a player from any duel and clear challenges it's part of (shared by disconnect; A2 also
  // calls this when a duel ends by a downing). Mirrors removeFromParty.
  private removeFromDuel(playerId: number): void {
    this.duelInvites.delete(playerId); // drop a challenge TO this player
    for (const [inviteeId, fromId] of this.duelInvites) {
      if (fromId === playerId) this.duelInvites.delete(inviteeId); // drop challenges FROM this player
    }
    const did = this.duelOf.get(playerId);
    if (did === undefined) return;
    const duel = this.duels.get(did);
    this.duelOf.delete(playerId);
    if (duel) {
      const other = duel.a === playerId ? duel.b : duel.a;
      this.duelOf.delete(other); // the duel dissolves for both
      this.duels.delete(did);
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
  localDuel(): DuelView | null {
    return this.duelViewFor(this.localId);
  }
  localDuelInvite(): DuelInviteView | null {
    return this.duelInviteViewFor(this.localId);
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

  duelViewFor(id: number): DuelView | null {
    const did = this.duelOf.get(id);
    if (did === undefined) return null;
    const duel = this.duels.get(did);
    if (!duel) return null;
    const otherId = duel.a === id ? duel.b : duel.a;
    const other = this.ents.get(otherId);
    if (!other) return null;
    return { opponentId: otherId, opponentName: other.name };
  }

  duelInviteViewFor(id: number): DuelInviteView | null {
    const fromId = this.duelInvites.get(id);
    if (fromId === undefined) return null;
    const from = this.ents.get(fromId);
    if (!from) return null;
    return { fromId, fromName: from.name };
  }

  entities(): ReadonlyArray<EntityView> {
    // O3: memoize the projection per tick. Callers hit this ~8x/frame; rebuilding it each time
    // churned ~400 throwaway view objects/frame. The cache is invalidated by step() and the
    // out-of-step mutators (add/remove/restorePlayer).
    if (this.entityViewCache === null) this.entityViewCache = this.buildEntityViews();
    return this.entityViewCache;
  }

  // The projection itself — byte-for-byte the same fields as before; entities() just caches it.
  private buildEntityViews(): EntityView[] {
    const out: EntityView[] = [];
    for (const e of this.ents.values()) {
      out.push({
        id: e.id, kind: e.kind, name: e.name,
        x: e.x, z: e.z, facing: e.facing, hp: e.hp, maxHp: e.maxHp,
        mp: e.mp, maxMp: e.maxMp,
        level: e.level, xp: e.xp, xpToNext: e.level >= LEVEL_CAP ? 0 : xpForLevel(e.level), attrPoints: e.attrPoints,
        gold: e.gold,
        sp: e.sp,
        str: e.str, weaponDamage: e.weaponDamage,
        int: e.baseInt,
        weaponPlus: e.equipment.weapon?.plus ?? 0,
        phyDef: e.phyDef, magDef: e.magDef, // K6: defesa efetiva (base+gear) p/ a ficha
        boss: e.boss,
        tier: e.tier,
        species: e.species,
        hostile: e.kind === 'enemy' && e.targetId != null,
        dead: e.kind === 'player' && e.deadUntil !== 0,
        statuses: e.effects.map((s) => s.kind),
        // The player's class skin = its active weapon mastery (unarmed -> Sword). Only players
        // have one; enemies/NPCs report the default and the renderer ignores it for them.
        mastery: e.kind === 'player' ? this.activeMastery(e).id : DEFAULT_MASTERY,
        loot: e.loot
          ? { itemId: e.loot.stack.itemId, name: ITEMS[e.loot.stack.itemId]?.name ?? e.loot.stack.itemId,
              rarity: e.loot.stack.rarity, plus: e.loot.stack.plus, qty: e.loot.stack.qty }
          : null,
        pkActive: e.pkActive === true, // GDD v0.5 (PK livre): public PK flag -> drives the "dangerous player" marker
        stallOpen: this.stalls.has(e.id), // GDD v0.5 (Stalls): public flag -> buyers/renderer see who has a stall
      });
    }
    return out;
  }

  // Drop the cached views so the next entities() re-projects. hash() reads this.ents directly
  // (never entities()), so this NEVER affects determinism — it only refreshes the presentation
  // view. Every within-tick mutation runs through step(); the only out-of-step mutators are
  // addPlayer/removePlayer/restorePlayer, which call this too. Keep that invariant if you add one.
  private invalidateEntityViews(): void {
    this.entityViewCache = null;
  }

  // ---------- simulation ----------
  step(): void {
    this.tick++;
    this.invalidateEntityViews(); // O3: this tick's mutations invalidate the cached views
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
            // PK livre: auto-play has no "hands on the controls", so it can't hold the ALT/PK modifier.
            // Clear it here — the client's corrective set-pk would be dropped (non-social input is ignored
            // while botting), so without this an armed-then-botted player stays flagged PK (a stuck red
            // ring + a stuck hash bit). Mirrors how the OFF branch below clears targetId.
            p.pkActive = false;
          } else {
            this.botPlayers.delete(id);
            this.moveIntents.set(id, { t: 'stop' }); // hand control back to the human
            p.targetId = null;
          }
        } else if (!this.botPlayers.has(id) || SOCIAL_COMMANDS.has(cmd.t)) {
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
      else this.tryPlayerAutoPot(p); // Sistema 15 (QoL): human auto-pot (the bot has its own SURVIVE logic)
      this.stepPlayer(p);
    }
    this.stepPets(); // GDD v0.5 (Pets): each summoned pet trails its owner, after the owners moved

    // --- enemies act on the post-move positions (aggro the NEAREST living player) ---
    for (const e of this.ents.values()) {
      if (e.kind === 'enemy') this.stepEnemy(e);
    }

    // --- combat + respawn per player, on the post-movement positions ---
    for (const id of this.playerIds) {
      const p = this.ents.get(id);
      if (p) this.autoAttack(p);
    }
    // Out-of-combat regen, on this tick's post-combat HP (combat above refreshed combatUntil).
    for (const id of this.playerIds) {
      const p = this.ents.get(id);
      if (p) this.regenPlayer(p);
    }
    for (const id of this.playerIds) {
      const p = this.ents.get(id);
      if (p) this.respawnPlayer(p); // revive a downed player once its timer elapses
    }
    this.processRespawns();
    this.despawnGroundLoot(); // GDD v0.5: remove ground loot whose lifetime elapsed
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
  // The single PvP-eligibility chokepoint: may `attacker` damage/target `target`? Today only living
  // enemies are valid (the game is 100% PvE), so this returns exactly what the scattered
  // `kind === 'enemy'` guards did — A0 is byte-identical. Later slices OR duel-pair / guild-war
  // membership in here, so every attack/target path shares one rule. The self-exclusion
  // (target.id !== attacker.id) is always true today (an enemy is never the attacking player) and
  // becomes load-bearing once players can target players.
  private canAttack(attacker: Entity, target: Entity): boolean {
    if (target.hp <= 0 || target.id === attacker.id) return false;
    if (target.kind === 'enemy') return true; // PvE (unchanged): any living enemy
    if (target.kind !== 'player' || attacker.kind !== 'player') return false; // only player-vs-player past here
    // PvP path 1 — consensual DUEL: always eligible vs your pair. The safe-zone is enforced at the DAMAGE
    // step (hitPlayer), not here, so you can target/approach across the town edge; the blow is withheld inside.
    if (this.areDueling(attacker.id, target.id)) return true;
    // PvP path 2 — free PK (GDD v0.5 §2): eligible only when the attacker has PK mode ON (ALT held) AND
    // BOTH players stand OUTSIDE any city safe-zone. With PK off, players are never eligible — so a normal
    // attack / Tab cycle only ever finds mobs (PK is click-targeted, like Silkroad).
    return attacker.pkActive === true && !this.inSafeZone(attacker) && !this.inSafeZone(target);
  }

  // Whether the entity stands inside a city safe-zone (no PvP, no aggro). The canonical "in a city" test
  // (zoneAt covers town + Vila do Leste); shared by the PK eligibility check above and mirrored by the
  // damage-step withhold in hitPlayer, so PK targeting and PK damage agree at the city edge.
  private inSafeZone(e: Entity): boolean {
    return zoneAt(e.x, e.z).safe;
  }

  // Whether two players are in the SAME active duel (consensual PvP). Both ids map to the same
  // duel id exactly when they form a pair. Pure read of duel state — determinism-safe.
  private areDueling(a: number, b: number): boolean {
    const da = this.duelOf.get(a);
    return da !== undefined && da === this.duelOf.get(b);
  }

  // Routes a landed hit to the right apply-function. A PvE hit reaches an enemy (hitEnemy); a PvP
  // hit reaches the duel opponent (hitPlayer, which honors the safe-zone + ends/credits the duel on
  // a down). canAttack already gated WHO is hittable, so a player target here is always the active
  // duel opponent — the routing stays a simple kind switch.
  private hitTarget(t: Entity, hit: Damage, attacker: Entity): void {
    if (t.kind === 'player') this.hitPlayer(t, hit, attacker);
    else this.hitEnemy(t, hit, attacker);
  }

  // swing every `swingTicks`. The timer is preserved while out of range, so a
  // ready swing fires the moment the target comes back into reach.
  private autoAttack(p: Entity): void {
    if (p.deadUntil !== 0 || this.isIncapacitated(p)) return; // no swinging while downed or stunned
    if (p.targetId == null || p.swingTicks <= 0) return;
    const t = this.ents.get(p.targetId);
    if (!t || !this.canAttack(p, t)) return; // validateTarget clears it
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
    this.hitTarget(t, combat.compute({
      attacker: p, rank: 1, damageType: this.damageTypeOf(p), critChance: this.critChance(p), rng: this.rng,
      autoMult: this.activeMastery(p).swingTime / AUTO_DPS_BASE_SWING, // Opção A: faster weapon hits softer, slower harder
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
    if (killer.kind === 'player') killer.combatUntil = this.tick + REGEN_LINGER_TICKS; // dealing damage holds off regen
    // Boss loot goes to the biggest damage contributor, so tally each player's damage to the boss.
    if (t.boss && killer.kind === 'player' && dmg > 0) this.recordBossDamage(t.id, killer.id, dmg);
    // Captured at the target's current position so the number shows even on a kill.
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'damage',
      targetId: t.id,
      amount: dmg,
      x: t.x,
      z: t.z,
      crit: hit.crit, // already rolled in compute(); forwarded for a distinct crit pop (no new rng draw)
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
    // A boss credits the BIGGEST damage contributor over its life (Silkroad uniques), not the last
    // hit; common mobs credit the last hitter. The credited player still exists (players aren't
    // removed here). Single-player: the top damager IS the last hitter, so behavior is unchanged.
    const credited = bossDef
      ? (this.ents.get(this.topBossDamager(dead.id) ?? killer.id) ?? killer)
      : killer;
    if (bossDef) {
      this.bossDamage.delete(dead.id); // the boss is gone — clear its damage ledger
      // This boss reschedules on its OWN timer (not the common-mob queue) and announces its
      // defeat WITH the name of whoever earned the kill (the top damage contributor).
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
        text: credited.kind === 'player'
          ? `${credited.name} derrotou ${bossDef.template.name}`
          : `${bossDef.template.name} foi derrotado`,
      });
    } else if (!dead.summoned) {
      // Common enemies respawn after a delay, refilling their OWN ring; summons are ephemeral.
      this.respawnQueue.push({ at: this.tick + RESPAWN_TICKS, zone: dead.spawnZone });
    }
    if (credited.kind === 'player') {
      const tier = ENEMY_TIERS.find((t) => t.id === dead.tier) ?? ENEMY_TIERS[0];
      const st = SPECIES_BY_ID[dead.species] ?? ENEMY_TEMPLATE; // the dead mob's species (xp/sp baseline)
      // A boss pays its big flat XP/SP lump; a common mob scales by tier AND by its LEVEL
      // (deeper rings pay more — GDD §G3). The reward is then distributed by the killer's
      // party mode (solo = all to the credited player).
      const lvl = levelRewardMult(dead.level);
      const baseXp = bossDef ? bossDef.template.xp : Math.round(st.xp * tier.xpMult * lvl);
      const baseSp = bossDef ? bossDef.template.sp : Math.round(st.sp * tier.xpMult * lvl);
      this.awardReward(credited, baseXp, baseSp);
      this.rollLoot(credited, dead, bossDef ? 1 : tier.goldMult * lvl);
    }
  }

  // Tally per-player damage dealt to a boss (over its life), for "most damage wins the loot".
  private recordBossDamage(bossId: number, playerId: number, dmg: number): void {
    let byPlayer = this.bossDamage.get(bossId);
    if (!byPlayer) { byPlayer = new Map(); this.bossDamage.set(bossId, byPlayer); }
    byPlayer.set(playerId, (byPlayer.get(playerId) ?? 0) + dmg);
  }

  // The player who dealt the most damage to a boss (ties -> lowest player id), or null if none.
  // Deterministic: explicit tie-break, independent of map iteration order.
  private topBossDamager(bossId: number): number | null {
    const byPlayer = this.bossDamage.get(bossId);
    if (!byPlayer) return null;
    let bestId = -1;
    let bestDmg = -1;
    for (const [pid, d] of byPlayer) {
      if (d > bestDmg || (d === bestDmg && pid < bestId)) { bestDmg = d; bestId = pid; }
    }
    return bestId < 0 ? null : bestId;
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
    // GDD v0.5 (loot físico LF-S4): a mob's dropped ITEMS now fall to the GROUND at its spot (FFA pickup)
    // instead of going straight to the killer's bag. Gold still goes to the killer (above). The this.rng
    // draw order (per-drop chance, then rarity) is UNCHANGED, so the loot STREAM is preserved; only the
    // destination (ground vs bag) changes. Party loot MODES no longer apply to mob loot (the ground is FFA).
    for (const drop of t.drops) {
      // First decide if the item drops at all, then roll HOW rare it is. Only equippable gear has a
      // meaningful rarity; materials/consumables drop as plain Normal. Everything drops un-enhanced (+0).
      if (this.rng.next() < drop.chance) {
        const equippable = ITEMS[drop.itemId]?.slot != null;
        const rarity = equippable ? rollRarity(this.rng, rarities) : 'normal';
        this.spawnGroundLoot(dead.x, dead.z, { itemId: drop.itemId, rarity, plus: 0, qty: 1 });
      }
    }
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
    if (p.level >= LEVEL_CAP) return; // capped — XP is frozen at the content ceiling
    p.xp += amount;
    while (p.level < LEVEL_CAP && p.xp >= xpForLevel(p.level)) {
      p.xp -= xpForLevel(p.level);
      this.levelUp(p);
    }
    if (p.level >= LEVEL_CAP) p.xp = 0; // hit the cap this call — no dangling partial bar
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

  // ---------- teleporte entre cidades (GDD v0.5) ----------
  // Teleport the player to another city's centre: must be standing at a city teleport point, the
  // destination must be a DIFFERENT known city, and the fixed gold cost must be affordable. Pure
  // position + gold mutation (no Rng) — determinism-safe; folded into the hash via the entity.
  private teleportTo(p: Entity, cityId: string): void {
    const from = cityNear(p.x, p.z);
    if (!from) return; // not at a teleport point (the NPC sits at a city centre)
    const dest = cityById(cityId);
    if (!dest || dest.id === from.id) return; // unknown destination, or already there
    if (p.gold < TELEPORT_COST) return; // can't afford the trip
    p.gold -= TELEPORT_COST;
    this.warpTo(p, dest.cx, dest.cz);
  }

  // Warp a player to a world position, clamped in-bounds, dropping the target + any drift movement intent.
  // Shared by teleport, the free Return recall, and the return scroll — all pure position writes (no Rng),
  // so determinism holds and the new position is folded into the hash via the entity.
  private warpTo(p: Entity, cx: number, cz: number): void {
    p.x = clamp(cx, -WORLD_HALF, WORLD_HALF);
    p.z = clamp(cz, -WORLD_HALF, WORLD_HALF);
    p.targetId = null;
    this.moveIntents.set(p.id, { t: 'stop' });
  }

  // Register the city the player is STANDING at (its teleporter NPC) as their Return/respawn city
  // (GDD v0.5 TP2). Free, no-op when not at a teleport point. Pure per-player state write — the
  // new value is deterministic and folded into the hash, so it's desync-detectable.
  private registerCity(p: Entity): void {
    const c = cityNear(p.x, p.z);
    if (c) p.returnCity = c.id; // remember this hub; Return + death respawn now route here
  }

  // Free Return recall (GDD v0.5 TP2): warp the player to their REGISTERED city centre from anywhere.
  // BLOCKED while in combat (dueling, in a PK fight, or a mob aggroed on them) and gated by a cooldown.
  // Pure position/cooldown mutation (no Rng) — deterministic and folded into the hash.
  private returnToCity(p: Entity): void {
    if (this.inCombat(p)) return; // headline block: can't recall mid-fight (no escaping a duel or a hunting mob)
    if (this.tick < p.returnReadyAt) return; // and a cooldown between recalls (checked AFTER combat, so the
    // teleporter view's blocked-reason priority — combat first, then cooldown — matches this gate order)
    const dest = cityById(p.returnCity) ?? cityById('town');
    if (!dest) return; // defensive: registered city unknown and even 'town' missing
    this.warpTo(p, dest.cx, dest.cz);
    p.returnReadyAt = this.tick + RETURN_COOLDOWN_TICKS;
  }

  // Is the player in COMBAT for the purpose of blocking Return? True while dueling, while engaged in free
  // PK (as aggressor or victim), or while any LIVING enemy is aggroed on them. O(entities), but only runs
  // on a Return attempt (player-initiated, rare). Pure read, no Rng — deterministic.
  private inCombat(p: Entity): boolean {
    if (this.duelOf.has(p.id)) return true; // a consensual duel
    // PK livre (GDD v0.5 §2): as the AGGRESSOR you can't flag PK and instantly recall to safety while
    // locked on a living player — no hit-and-run escape.
    if (p.pkActive && p.targetId != null) {
      const t = this.ents.get(p.targetId);
      if (t && t.kind === 'player' && t.hp > 0) return true;
    }
    for (const e of this.ents.values()) {
      if (e.hp <= 0) continue;
      if (e.kind === 'enemy' && e.targetId === p.id) return true; // a mob is hunting you
      // ...and as the VICTIM you can't recall-escape while a PK-flagged player is locked on you.
      if (e.kind === 'player' && e.pkActive && e.targetId === p.id) return true;
    }
    return false;
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
      case 'duel-challenge': this.challengeDuel(p, cmd.name); return;
      case 'duel-accept': this.acceptDuel(p); return;
      case 'duel-decline': this.declineDuel(p); return;
      // PK livre (GDD v0.5): toggle the held PK modifier. Pre-gate (like the social commands) so
      // RELEASING ALT clears it even while downed/stunned — a player never respawns stuck in PK mode.
      case 'set-pk': p.pkActive = cmd.on; return;
      // Pets (GDD v0.5): summon/dismiss the owned pet. Pre-gate so a dismiss works even while downed.
      case 'set-pet': if (cmd.on) this.summonPet(p); else this.dismissPet(p); return;
      // Sistema 15 (QoL): set the auto-pot HP and/or MP thresholds (fraction of the max; 0 = off). Each is
      // optional so a control can set one axis without disturbing the other. Pre-gate — pure config, applies
      // even while downed/stunned. Clamped to [0,1] so a tampered client can't force perpetual drinking.
      case 'set-auto-pot':
        if (cmd.hpPct !== undefined) p.autoPotHpPct = Math.max(0, Math.min(1, cmd.hpPct));
        if (cmd.mpPct !== undefined) p.autoPotMpPct = Math.max(0, Math.min(1, cmd.mpPct));
        return;
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
        this.unequip(p, cmd.slot, cmd.toBagSlot);
        break;
      case 'move-item':
        this.moveItem(p, cmd.from, cmd.to);
        break;
      case 'enhance':
        this.enhance(p, cmd.slot, cmd.useProtection);
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
      case 'teleport':
        this.teleportTo(p, cmd.cityId);
        break;
      case 'register-city':
        this.registerCity(p);
        break;
      case 'return':
        this.returnToCity(p);
        break;
      case 'pickup':
        this.pickupLoot(p, cmd.lootId);
        break;
      case 'pickup-nearby':
        this.pickupNearby(p);
        break;
      case 'deposit':
        this.deposit(p, cmd.itemId, cmd.rarity, cmd.plus);
        break;
      case 'withdraw':
        this.withdraw(p, cmd.itemId, cmd.rarity, cmd.plus);
        break;
      // Pets PET2 (GDD v0.5 §4): the transport pet's portable bag (no NPC; the pet must be summoned).
      case 'pet-deposit':
        this.petDeposit(p, cmd.itemId, cmd.rarity, cmd.plus);
        break;
      case 'pet-withdraw':
        this.petWithdraw(p, cmd.itemId, cmd.rarity, cmd.plus);
        break;
      // Stalls (GDD v0.5 §5): personal P2P shops. Economy-gated (after the downed/stunned check), like buy/sell.
      case 'stall-open':
        this.openStall(p, cmd.listings);
        break;
      case 'stall-close':
        this.closeStall(p);
        break;
      case 'stall-buy':
        this.stallBuy(p, cmd.sellerId, cmd.itemId, cmd.rarity, cmd.plus);
        break;
      // Global Marketplace: list/cancel/buy a global listing (economy-gated like buy/sell; no proximity).
      case 'market-list':
        this.marketList(p, cmd.itemId, cmd.rarity, cmd.plus, cmd.price);
        break;
      case 'market-cancel':
        this.marketCancel(p, cmd.listingId);
        break;
      case 'market-buy':
        this.marketBuy(p, cmd.listingId);
        break;
      case 'market-collect':
        this.marketCollect(p);
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
    if (!meetsLevelReq(def, p.level)) return; // K2: gate de nível (degrees) — recusa silenciosa. (1 linha no topo de equip(); avisar K1/Gabriel.)
    // Remember WHERE this stack sat so the displaced item can take the vacated slot (a clean
    // positional swap), instead of being auto-organized into the first free hole.
    const srcIdx = p.bag.findIndex((s) => s != null && s.itemId === itemId && s.rarity === rarity && s.plus === plus);
    if (srcIdx < 0) return; // must hold that exact stack
    if (!removeFromBag(p.bag, itemId, rarity, plus, 1)) return;
    const prev = p.equipment[def.slot];
    p.equipment[def.slot] = { itemId, rarity, plus, durability: MAX_DURABILITY }; // a freshly equipped item is in full repair
    if (prev) {
      // Land the displaced item in the slot just vacated (qty-1 case); if the source stack still
      // holds items (equipped one of a qty>1 stack), fall back to the first free hole.
      if (p.bag[srcIdx] == null) {
        p.bag[srcIdx] = { itemId: prev.itemId, rarity: prev.rarity, plus: prev.plus, qty: 1 };
      } else {
        addToBag(p.bag, prev.itemId, prev.rarity, prev.plus, 1); // bag full -> acceptable loss, like loot-on-full
      }
    }
    this.recomputeStats(p);
  }

  private unequip(p: Entity, slot: EquipSlot, toBagSlot?: number): void {
    const eq = p.equipment[slot];
    if (!eq) return;
    // Drag placement: if a specific EMPTY bag slot is named, put the item exactly there; otherwise
    // (click/keyboard, or an occupied/invalid target) fall back to the first free hole in F-order.
    if (toBagSlot != null && Number.isInteger(toBagSlot) && toBagSlot >= 0 && toBagSlot < BAG_SLOTS && p.bag[toBagSlot] == null) {
      p.bag[toBagSlot] = { itemId: eq.itemId, rarity: eq.rarity, plus: eq.plus, qty: 1 };
    } else if (!addToBag(p.bag, eq.itemId, eq.rarity, eq.plus, 1)) {
      return; // bag full: keep it equipped
    }
    p.equipment[slot] = null;
    this.recomputeStats(p);
  }

  // Rearrange the bag: swap/move the stacks at two slot indices (positional drag-and-drop). Pure.
  private moveItem(p: Entity, from: number, to: number): void {
    moveBagSlot(p.bag, from, to); // bounds/empty-source checked inside; no stat change
  }

  // ---------- alchemy ("+N") ----------
  // Attempt to raise the equipped item's "+". Consumes the matching Elixir (and, if asked +
  // held, a Lucky Powder for a better chance). K4 — REAL RISK at high "+": at/above
  // RISK_FLOOR a failure can QUEBRAR (destroy) the item or drop multiple levels; a Pedra de
  // Proteção (asked + held) caps the drop to <=1 and prevents the break, and is consumed
  // ONLY when it actually prevents a bad outcome. Below RISK_FLOOR a failure stays a gentle
  // -1. Determinism: a FIXED Rng draw order — roll1 (success) always; roll2 (break vs
  // degrade) ONLY on an unprotected failure at/above RISK_FLOOR. Refuses (no cost) at the cap.
  private enhance(p: Entity, slot: EquipSlot, useProtection?: boolean): void {
    const eq = p.equipment[slot];
    if (!eq || eq.plus >= MAX_PLUS) return; // nothing equipped, or already maxed
    const elixirId = slot === 'weapon' ? 'elixir_weapon' : 'elixir_armor';
    if (!removeFromBag(p.bag, elixirId, 'normal', 0, 1)) return; // need the right Elixir
    // Protection: a NON-MUTATING held-check (botCount only sums the bag); the stone is
    // consumed below ONLY when it actually prevents a break/multi-drop.
    const protectedAttempt = !!useProtection && this.botCount(p, PROTECT_STONE_ID) > 0;

    // Fixed draw order: roll1 (success) always; roll2 (break vs degrade) ONLY when needsBreakRoll
    // says so (unprotected failure at/above RISK_FLOOR) — the SAME predicate resolveEnhance uses to
    // consume roll2, so the draw count here and the consumption there can never drift apart.
    const roll1 = this.rng.next();
    const roll2 = needsBreakRoll(eq.plus, protectedAttempt, roll1) ? this.rng.next() : 0;
    const outcome = resolveEnhance(eq.plus, protectedAttempt, roll1, roll2);

    if (outcome.kind === 'break') {
      const brokenName = ITEMS[eq.itemId]?.name ?? eq.itemId;
      p.equipment[slot] = null; // the item is destroyed
      this.recomputeStats(p);
      this.events.push({
        seq: this.nextEventSeq++, tick: this.tick, kind: 'enhance-break',
        targetId: p.id, amount: 0, x: p.x, z: p.z, text: brokenName,
      });
      return;
    }
    const wasAtRisk = eq.plus >= RISK_FLOOR; // captured before applying the new "+"
    eq.plus = outcome.nextPlus;
    // Consume the protection stone on ANY protected FAILURE (degrade) at/above RISK_FLOOR. It
    // does NOT guarantee a break/level was actually averted: at +4 the protected drop (−1) equals
    // the unprotected non-break drop, so there the stone only buys break-immunity (its drop-cap
    // matters from +5 up). Success / low-"+" never burns it.
    if (protectedAttempt && outcome.kind === 'degrade' && wasAtRisk) {
      removeFromBag(p.bag, PROTECT_STONE_ID, 'normal', 0, 1);
    }
    this.recomputeStats(p);
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: outcome.kind === 'success' ? 'enhance-success' : 'enhance-fail',
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
    // Sistema 2 (respec): a skill-reset scroll refunds ALL SP spent above rank 1 and zeros every rank, to
    // re-allocate the build. Faithful to Silkroad's reset item (escopo 1828). Not gated by the potion
    // cooldown; refuses (no consume, no change) when nothing was invested, so it's never wasted. Pure
    // arithmetic over p.sp/p.skillRanks (both already saved) — deterministic, no Rng.
    if (effect.resetSkills) {
      const refunded = Object.values(p.skillRanks).reduce((sp, rank) => sp + skillSpInvested(rank), 0);
      if (refunded <= 0) return; // nada investido -> não queima o pergaminho
      if (!removeFromBag(p.bag, itemId, rarity, plus, 1)) return; // must actually hold it
      p.sp += refunded;
      p.skillRanks = {};
      this.recomputeStats(p); // passives fold by rank -> zerar os ranks derruba-os ao baseline (rank 1)
      return;
    }
    // Sistema 15 (QoL): a recall scroll teleports the player without the free-Return cooldown (the item is
    // the cost). Blocked in combat (not a flee button), like the free Return; consumes 1. Pure position
    // write (warpTo) — deterministic. 'lastSpot' (reverse) comes in Fatia 2.
    if (effect.recall) {
      if (this.inCombat(p)) return; // fiel: bloqueado em combate — não é fuga instantânea
      const dest = effect.recall === 'registered' ? (cityById(p.returnCity) ?? cityById('town')) : undefined;
      if (!dest) return; // destino desconhecido (ou 'lastSpot' antes da Fatia 2) -> no-op, sem consumir
      if (!removeFromBag(p.bag, itemId, rarity, plus, 1)) return; // must actually hold it
      this.warpTo(p, dest.cx, dest.cz);
      return;
    }
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
      const drank = this.drinkHealthPotion(p);
      if (!drank) {
        // can't heal now (none held, or potion still on cooldown): break off from danger
        const threat = this.nearestEnemyWithin(p, BOT_FLEE_RADIUS);
        if (threat) {
          this.moveIntents.set(p.id, { t: 'move', dx: p.x - threat.x, dz: p.z - threat.z });
          return;
        }
      }
    }

    // === PRIORITY 1.5 — SCAVENGE (collect nearby ground loot — GDD v0.5 loot físico) ====
    // After survival, before tending the bag / hunting: walk to the nearest dropped pile and grab it,
    // so looted gear + materials flow back into botEquipBest / botEnhance (the LF-S4 economy fix).
    // Skipped when the bag is full (the VENDOR phase below then sells junk to free a slot, avoiding a
    // stuck loop). Deterministic: positions + ids only, no Rng.
    const loot = freeBagSlots(p.bag) > 0 ? this.botNearestLoot(p) : undefined;
    if (loot) {
      const ldx = loot.x - p.x;
      const ldz = loot.z - p.z;
      if (ldx * ldx + ldz * ldz <= LOOT_PICKUP_RANGE * LOOT_PICKUP_RANGE) {
        this.applyAction(p, { t: 'pickup-nearby' }); // in reach -> grab the whole pile at once
        this.moveIntents.set(p.id, { t: 'stop' });
      } else {
        this.moveIntents.set(p.id, this.botMoveToward(p, loot.x, loot.z)); // walk to the pile (gate-aware)
      }
      return; // looting takes this tick (survival already had priority); hunt/vendor resume once clear
    }

    // === PRIORITY 2 — TEND THE BAG (sell junk / restock at the vendor) =====
    if (this.botWantsVendor(p)) {
      if (this.nearVendor(p)) {
        this.botTrade(p); // sell surplus gear, top up potions, buy spare materials
      } else {
        const v = this.ents.get(this.vendorId);
        if (v) {
          this.moveIntents.set(p.id, this.botMoveToward(p, v.x, v.z));
          return; // walk to the shop (gate-aware)
        }
      }
    }

    // === PRIORITY 3 — EVOLVE GEAR (enhance during a lull, keep a reserve) ==
    if (!this.nearestEnemyWithin(p, BOT_ENHANCE_SAFE_RADIUS)) {
      this.botEnhance(p);
    }

    // === PRIORITY 4 — HUNT ================================================
    // BR-S3: climb to the ring matching the bot's level. If it's well INSIDE its level's ring (it has
    // out-levelled where it stands), venture OUTWARD toward that ring's radius (through the gate, via
    // botMoveToward) for tougher mobs + better loot. Survival/scavenge already had priority this tick.
    const targetCheb = this.botTargetCheb(p);
    const cheb = Math.max(Math.abs(p.x), Math.abs(p.z));
    if (cheb < targetCheb - RING_WIDTH / 2) {
      const k = cheb > 0 ? targetCheb / cheb : 0;
      const tx = cheb > 0 ? p.x * k : targetCheb; // a point at the target ring's radius, same bearing (+x at the origin)
      const tz = cheb > 0 ? p.z * k : 0;
      this.moveIntents.set(p.id, this.botMoveToward(p, tx, tz));
      return;
    }
    const target = this.botChooseTarget(p);
    if (!target) {
      this.moveIntents.set(p.id, { t: 'stop' });
      return;
    }
    this.applyAction(p, { t: 'set-target', id: target.id });
    const dx = target.x - p.x;
    const dz = target.z - p.z;
    const reach = this.attackRange(p) - 0.4;
    this.moveIntents.set(p.id, dx * dx + dz * dz > reach * reach ? this.botMoveToward(p, target.x, target.z) : { t: 'stop' });
    this.botUseAbilities(p, target);
  }

  // The nearest ground-loot pile within the bot's acquisition radius (or undefined). Deterministic:
  // scans lootIds, keeps the closest, ties broken by lowest id. No Rng. (GDD v0.5 loot físico BR-S1.)
  private botNearestLoot(p: Entity): Entity | undefined {
    const r2 = BOT_LOOT_RADIUS * BOT_LOOT_RADIUS;
    let best: Entity | undefined;
    let bestD = 0;
    for (const lootId of this.lootIds) {
      const e = this.ents.get(lootId);
      if (!e || !e.loot) continue;
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const d = dx * dx + dz * dz;
      if (d > r2) continue; // outside the acquisition radius
      if (best === undefined || d < bestD || (d === bestD && e.id < best.id)) { best = e; bestD = d; }
    }
    return best;
  }

  // BR-S2: a move-intent toward (tx,tz) that AIMS AT THE NEAREST GATE when the straight path would
  // cross the town wall (bot and goal on opposite sides) — so the bot heads for the opening instead of
  // scraping the rampart (slideThroughGates still does the final collision). Pure/deterministic.
  private botMoveToward(p: Entity, tx: number, tz: number): { t: 'move'; dx: number; dz: number } {
    const inP = Math.max(Math.abs(p.x), Math.abs(p.z)) < CITY_WALL_HALF;
    const inT = Math.max(Math.abs(tx), Math.abs(tz)) < CITY_WALL_HALF;
    if (inP !== inT) { // the segment crosses the wall ring -> steer to the nearest cardinal gate first
      const gates: ReadonlyArray<readonly [number, number]> = [
        [CITY_WALL_HALF, 0], [-CITY_WALL_HALF, 0], [0, CITY_WALL_HALF], [0, -CITY_WALL_HALF],
      ];
      let gx = CITY_WALL_HALF, gz = 0, bestD = Infinity;
      for (const [gcx, gcz] of gates) {
        const d = (gcx - p.x) ** 2 + (gcz - p.z) ** 2;
        if (d < bestD) { bestD = d; gx = gcx; gz = gcz; }
      }
      if ((gx - p.x) ** 2 + (gz - p.z) ** 2 > 4) return { t: 'move', dx: gx - p.x, dz: gz - p.z }; // until ~on the gate
    }
    return { t: 'move', dx: tx - p.x, dz: tz - p.z };
  }

  // BR-S3: the Chebyshev radius (a ring's mid-band) the bot should hunt at for its level — it climbs
  // outward as it levels. Mirrors the ZONES bands (ring1 @30-60, ring2 @60-90, ring4 @90-120, ring10
  // @120-150). Pure function of level -> deterministic.
  private botTargetCheb(p: Entity): number {
    const lvl = p.level;
    if (lvl >= 10) return 135;
    if (lvl >= 5) return 105;
    if (lvl >= 3) return 75;
    return 45;
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
        if (!this.skillUnlocked(p, def)) continue; // anti-loop: nunca ranquear skill bloqueada (o for(;;) giraria)
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
        if (!s) continue; // skip empty slots (sparse bag)
        const def = ITEMS[s.itemId];
        if (!def || def.slot !== slot) continue;
        if (slot === 'weapon' && (def.mastery ?? DEFAULT_MASTERY) !== activeId) continue;
        if (!meetsLevelReq(def, p.level)) continue; // K2: só considerar gear que o bot PODE equipar — senão o 'best' vira inalcançável e ele nunca troca pelo item vestível
        const score = botGearScore(s.itemId, s.rarity, s.plus);
        if (score > bestScore) { bestScore = score; best = s; }
      }
      if (best) this.applyAction(p, { t: 'equip', itemId: best.itemId, rarity: best.rarity, plus: best.plus });
    }
  }

  // Drink `itemId` from the bag if held and off the shared potion cooldown. Returns whether a drink was
  // issued (so a caller can fall back to fleeing). Reused by the bot's SURVIVE step, the player HP auto-pot,
  // and the player MP auto-pot — the caller decides the threshold, this just drinks.
  private drinkPotion(p: Entity, itemId: string): boolean {
    const potion = this.bagStack(p, itemId);
    if (!potion || this.tick < p.potionReadyAt) return false; // none held, or potion sickness
    this.applyAction(p, { t: 'use-item', itemId: potion.itemId, rarity: potion.rarity, plus: potion.plus });
    return true;
  }
  // Bot alias — keeps botStep's SURVIVE call byte-identical.
  private drinkHealthPotion(p: Entity): boolean {
    return this.drinkPotion(p, 'health_potion');
  }

  // Sistema 15 (QoL): the player auto-pot — a HUMAN (bot off) with a toggle armed drinks a held potion the
  // moment the stat dips below its threshold. HP is checked FIRST (survival), then MP; both share the potion
  // cooldown, so at most one drinks per tick (faithful to the SRO potion delay). No-op when off (0).
  private tryPlayerAutoPot(p: Entity): void {
    const hpThr = p.autoPotHpPct ?? 0;
    if (hpThr > 0 && p.maxHp > 0 && p.hp / p.maxHp < hpThr && this.drinkPotion(p, 'health_potion')) return;
    const mpThr = p.autoPotMpPct ?? 0;
    if (mpThr > 0 && p.maxMp > 0 && p.mp / p.maxMp < mpThr) this.drinkPotion(p, 'mana_potion');
  }

  // Worth a trip to the vendor? When the bag is nearly full of sellable surplus, or
  // we've run dry on Health Potions and can afford to restock at least one.
  private botWantsVendor(p: Entity): boolean {
    const bagPressure = freeBagSlots(p.bag) <= BOT_BAG_HEADROOM && this.botJunkCount(p) > 0;
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
    for (const s of p.bag.filter((b): b is ItemStack => b != null && this.botIsJunk(b)).map((b) => ({ ...b }))) {
      for (let i = 0; i < s.qty; i++) {
        this.applyAction(p, { t: 'sell', itemId: s.itemId, rarity: s.rarity, plus: s.plus });
      }
    }
    const potionPrice = botPrice('health_potion');
    while (potionPrice > 0 && this.botCount(p, 'health_potion') < BOT_POTION_STOCK
      && p.gold >= potionPrice && this.botCanStock(p, 'health_potion')
      && this.botShopSells(p, 'health_potion')) {
      this.applyAction(p, { t: 'buy', itemId: 'health_potion' });
    }
    // repair worn equipped gear (death cost) — buys back the combat stats it lost
    for (const slot of EQUIP_SLOTS) {
      const eq = p.equipment[slot];
      if (eq && eq.durability < DURABILITY_WORN_AT && p.gold >= repairCost(eq.durability)) {
        this.applyAction(p, { t: 'repair', slot });
      }
    }
    for (const mat of ['elixir_weapon', 'elixir_armor'] as const) {
      const price = botPrice(mat);
      while (price > 0 && this.botCount(p, mat) < BOT_MATERIAL_RESERVE + 2
        && p.gold - price >= BOT_GOLD_RESERVE && this.botCanStock(p, mat)
        && this.botShopSells(p, mat)) {
        this.applyAction(p, { t: 'buy', itemId: mat });
      }
    }
  }

  // True when buying one more (Normal, +0) of `itemId` is guaranteed to land — there
  // is a free bag slot, or a matching stack to grow — so a buy-loop can never spin
  // forever refusing the purchase on a full bag.
  private botCanStock(p: Entity, itemId: string): boolean {
    if (freeBagSlots(p.bag) > 0) return true;
    return p.bag.some((s) => s != null && s.itemId === itemId && s.rarity === 'normal' && s.plus === 0);
  }

  // True when the shop the bot is standing at actually stocks `itemId`. The split town
  // (ferreiro/boticário/armadureiro/alquimista) sells only PART of the catalog per NPC, so a
  // buy for an item this shop doesn't carry silently no-ops — guard the restock-loops with this
  // so they can never spin forever waiting on a purchase that can't land. The bot anchors at the
  // boticário (potions = survival); Elixirs live at the alquimista, so it sources those from drops.
  private botShopSells(p: Entity, itemId: string): boolean {
    const shop = this.nearestShop(p);
    return shop != null && shop.stock.some((s) => s.itemId === itemId);
  }

  // Refine the equipped gear when we hold materials ABOVE the reserve (never spend
  // the last ones — "deixar uma reserva"). Weapon first (damage), then armor. One
  // attempt per tick; a failed roll dips the "+", which is the mechanic — it just
  // keeps trying as more materials accumulate. Lucky Powder only when the odds drop.
  private botEnhance(p: Entity): void {
    for (const slot of EQUIP_SLOTS) {
      const eq = p.equipment[slot];
      if (!eq || eq.plus >= RISK_FLOOR) continue; // K4: bot never gambles into the break band
      const elixirId = slot === 'weapon' ? 'elixir_weapon' : 'elixir_armor';
      if (this.botCount(p, elixirId) <= BOT_MATERIAL_RESERVE) continue; // keep a reserve
      this.applyAction(p, { t: 'enhance', slot });
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
    // BR-S3: hunt within the bot's level band — never CHASE a (roaming) mob past the outer edge of the
    // ring its level targets, so a low-level bot won't drift out into a deadlier ring following a wanderer.
    // (The outward-TRAVEL step pulls it up to its ring; this cap stops it from overshooting beyond it.)
    const ringCap = this.botTargetCheb(p) + RING_WIDTH / 2;
    let best: Entity | undefined;
    let bestScore = Infinity;
    for (const e of this.ents.values()) {
      if (e.kind !== 'enemy' || e.hp <= 0) continue;
      if (Math.max(Math.abs(e.x), Math.abs(e.z)) > ringCap) continue; // beyond my band -> leave it
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
      if (def.kind === 'passive') continue; // Sistema 2: passivas não se castam (o bot só ranqueia)
      if (!this.skillUnlocked(p, def)) continue; // só considera skills destravadas
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
    for (const s of p.bag) if (s != null && s.itemId === itemId) n += s.qty;
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
    for (const s of p.bag) if (s != null && this.botIsJunk(s)) n += s.qty;
    return n;
  }

  // The first held stack of an item (so the bot uses the exact rarity/plus the
  // use-item command needs to match), or undefined if none is carried.
  private bagStack(p: Entity, itemId: string): ItemStack | undefined {
    return p.bag.find((s) => s != null && s.itemId === itemId && s.qty > 0) ?? undefined;
  }

  // ---------- attributes ----------
  // Spend one unspent attribute point on Strength (more melee damage) or
  // Intelligence (more max MP). Refuses when no points are available. The freshly
  // granted MP is made usable immediately (there's no passive MP regen yet).
  private spendAttr(p: Entity, attr: 'str' | 'int'): void {
    if (p.attrPoints <= 0) return;
    p.attrPoints -= 1;
    if (attr === 'str') {
      p.baseStr += ATTR_STR_PER_POINT;
      p.baseMaxHp += ATTR_STR_PER_POINT * STR_TO_HP; // Strength also raises max HP (Silkroad); permanent
    } else {
      p.baseInt += ATTR_INT_PER_POINT;
    }
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
    if (!this.skillUnlocked(p, def)) return; // Sistema 1: não dá pra ranquear skill bloqueada
    const rank = this.skillRank(p, def);
    if (rank >= SKILL_MAX_RANK) return; // already maxed
    const cost = skillUpgradeCost(rank);
    if (cost <= 0 || p.sp < cost) return; // can't afford
    p.sp -= cost;
    p.skillRanks[def.id] = rank + 1;
    // Sistema 2: a passive's bonus lives in recomputeStats, so a new rank must re-fold it into the
    // effective stats now (active skills read their rank live in combat, so they need no recompute).
    if (def.kind === 'passive') this.recomputeStats(p);
  }

  // ---------- vendor (shop) ----------
  // Buy one of a vendor stock item. Requires being near the vendor and enough
  // gold; the item is added Normal/+0. Refuses (no charge) if the bag is full.
  private buy(p: Entity, itemId: string): void {
    const shop = this.nearestShop(p);
    if (!shop) return; // not near any shop NPC
    const entry = shop.stock.find((s) => s.itemId === itemId);
    if (!entry || p.gold < entry.price) return; // not sold by this shop, or can't afford
    if (!addToBag(p.bag, itemId, 'normal', 0, 1)) return; // bag full -> no purchase, no charge
    p.gold -= entry.price;
  }

  // Sell one of a bag stack to the nearest shop NPC for its (rarity-scaled) value. Requires being near a
  // shop NPC and actually holding that exact stack.
  private sell(p: Entity, itemId: string, rarity: Rarity, plus: number): void {
    if (!this.nearestShop(p)) return;
    const value = rarityStat(ITEMS[itemId]?.value ?? 0, rarity);
    if (value <= 0) return; // worthless here -> don't let the player give it away for nothing
    if (!removeFromBag(p.bag, itemId, rarity, plus, 1)) return; // must hold that exact stack
    p.gold += value;
  }

  // K5: bank a whole bag stack into the player's own warehouse. Requires being near the
  // warehouse NPC; the pure helper handles capacity + the non-destructive put-back on a full bank.
  private deposit(p: Entity, itemId: string, rarity: Rarity, plus: number): void {
    if (!this.nearWarehouse(p)) return;
    depositStack(p.bag, p.storage, itemId, rarity, plus);
  }

  // K5: take a whole stack back from the warehouse to the bag (near the warehouse).
  private withdraw(p: Entity, itemId: string, rarity: Rarity, plus: number): void {
    if (!this.nearWarehouse(p)) return;
    withdrawStack(p.storage, p.bag, itemId, rarity, plus);
  }

  // GDD v0.5 (Pets PET2): move a whole stack bag <-> the transport pet's portable bag. Gated on a pet
  // being SUMMONED (the bag travels with the pet) — NO NPC near-check. Lazily creates the petBag array.
  private petDeposit(p: Entity, itemId: string, rarity: Rarity, plus: number): void {
    if (!this.petActiveFor(p.id)) return; // no pet out -> no portable bag
    const petBag = p.petBag ?? (p.petBag = []);
    depositToPet(p.bag, petBag, itemId, rarity, plus);
  }
  private petWithdraw(p: Entity, itemId: string, rarity: Rarity, plus: number): void {
    if (!this.petActiveFor(p.id) || !p.petBag) return;
    withdrawFromPet(p.petBag, p.bag, itemId, rarity, plus);
  }

  // Pay the vendor to restore an equipped item's durability to full (GDD B8). Requires
  // being near the vendor and enough gold; refuses (no charge) at full or when broke.
  // Worn gear gives less of its bonus, so this buys the lost stats back.
  private repair(p: Entity, slot: EquipSlot): void {
    if (!this.nearestShop(p)) return;
    const eq = p.equipment[slot];
    if (!eq || eq.durability >= MAX_DURABILITY) return; // nothing to repair
    const cost = repairCost(eq.durability);
    if (cost <= 0 || p.gold < cost) return; // can't afford
    p.gold -= cost;
    eq.durability = MAX_DURABILITY;
    this.recomputeStats(p); // restore the full bonus now that it's repaired
  }

  // Whether the player is close enough to the vendor NPC to trade. (Still used by the auto-play bot,
  // which navigates to the vendor spot; the player-facing buy/sell/repair use nearestShop below.)
  private nearVendor(p: Entity): boolean {
    const v = this.ents.get(this.vendorId);
    if (!v) return false;
    const dx = p.x - v.x;
    const dz = p.z - v.z;
    return dx * dx + dz * dz <= VENDOR_INTERACT_RANGE * VENDOR_INTERACT_RANGE;
  }

  // The nearest shop NPC within interaction range of `p`, with the stock it sells — or null if none is
  // close. With one (all-in-one) shop NPC this is exactly the old single-vendor proximity; with several
  // it routes the trade to the CLOSEST shop. Deterministic: iterates shopStock (insertion order); on a
  // tie the later-inserted shop wins (<=). No Rng.
  private nearestShop(p: Entity): { npc: Entity; stock: readonly VendorStockEntry[] } | null {
    let best: { npc: Entity; stock: readonly VendorStockEntry[] } | null = null;
    let bestD = VENDOR_INTERACT_RANGE * VENDOR_INTERACT_RANGE;
    for (const [npcId, stock] of this.shopStock) {
      const npc = this.ents.get(npcId);
      if (!npc) continue;
      const dx = p.x - npc.x;
      const dz = p.z - npc.z;
      const d = dx * dx + dz * dz;
      if (d <= bestD) { bestD = d; best = { npc, stock }; }
    }
    return best;
  }

  // Whether the player is close enough to the warehouse NPC to deposit/withdraw.
  private nearWarehouse(p: Entity): boolean {
    const w = this.ents.get(this.warehouseId);
    if (!w) return false;
    const dx = p.x - w.x;
    const dz = p.z - w.z;
    return dx * dx + dz * dz <= WAREHOUSE_INTERACT_RANGE * WAREHOUSE_INTERACT_RANGE;
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
    let bonusPhyDef = 0; // K3: physical defense from gear
    let bonusMagDef = 0; // K3: magical defense from gear
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
      bonusPhyDef += scale(stats.phyDef ?? 0); // K3: same rarity/+N/durability scale as the stats above
      bonusMagDef += scale(stats.magDef ?? 0); // K3
    }
    // The active weapon mastery's passive is always on (e.g. Lança's +HP).
    const passive = this.activeMastery(p).passive;
    bonusStr += passive.str ?? 0;
    bonusWeapon += passive.weaponDamage ?? 0;
    bonusMaxHp += passive.maxHp ?? 0;
    bonusMaxMp += passive.maxMp ?? 0;
    // Sistema 2: learnable PASSIVE skills of the active mastery (Corpo de Ferro's +HP, etc.), folded
    // by invested rank — players only, and only once unlocked (its nv de destrave). Rank starts at 1
    // when unlocked, so the passive grants its base bonus for free and SP grows it. (crit is not a
    // stored stat: it's folded live in critChance instead.)
    if (p.kind === 'player') {
      for (const def of this.activeMastery(p).abilities) {
        if (def.kind !== 'passive' || !def.passiveBonus || !this.skillUnlocked(p, def)) continue;
        const r = this.skillRank(p, def);
        bonusStr += (def.passiveBonus.str ?? 0) * r;
        bonusWeapon += (def.passiveBonus.weaponDamage ?? 0) * r;
        bonusMaxHp += (def.passiveBonus.maxHp ?? 0) * r;
        bonusMaxMp += (def.passiveBonus.maxMp ?? 0) * r;
        bonusPhyDef += (def.passiveBonus.phyDef ?? 0) * r;
        bonusMagDef += (def.passiveBonus.magDef ?? 0) * r;
      }
    }
    p.str = p.baseStr + bonusStr;
    p.weaponDamage = p.baseWeaponDamage + bonusWeapon;
    // Cadência por arma (feel distinto): a maestria ativa define o ritmo do auto-ataque (Arco 1.5s … Lança
    // 2.5s). Player-only — mobs mantêm o swingTicks do próprio template (definido no spawn). O nextSwingAt em
    // voo permanece; o PRÓXIMO golpe já usa a nova cadência.
    if (p.kind === 'player') p.swingTicks = Math.round(this.activeMastery(p).swingTime * TICK_RATE);
    p.maxHp = p.baseMaxHp + bonusMaxHp; // Strength's HP is folded into baseMaxHp on spend (see spendAttr)
    p.maxMp = p.baseMaxMp + p.baseInt * MP_PER_INT + bonusMaxMp; // Intelligence adds max MP
    // K3: defense is a plain additive write (NOT routed through the Int/maxMp line). Combat does
    // not read these yet; Gabriel's mitigate() will (phyDef reduces physical; magDef adds to Int resist).
    p.phyDef = p.basePhyDef + bonusPhyDef;
    p.magDef = p.baseMagDef + bonusMagDef;
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
  // Sistema 1: uma skill só aparece na barra / casta / ranqueia quando o personagem atinge o nível de
  // destrave (abilityUnlockLevel, regra 2N−1). Derivado do nível salvo — sem campo novo no save. Puro.
  private skillUnlocked(p: Entity, def: AbilityDef): boolean {
    return p.level >= abilityUnlockLevel(def);
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
    if (def.kind === 'passive') return; // Sistema 2: passivas são sempre-ativas, nunca castáveis
    if (!this.skillUnlocked(p, def)) return; // Sistema 1: skill ainda bloqueada (destrava por nível)
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
      if (!t || !this.canAttack(p, t)) return;
      if (Math.hypot(t.x - p.x, t.z - p.z) > this.attackRange(p)) return; // anchor must be in reach
      p.facing = Math.atan2(t.x - p.x, t.z - p.z); // face the target so the cone is predictable
      this.commitCast(p, def, slot);
      for (const e of this.enemiesInCone(p)) {
        // One compute() per enemy => one crit roll per enemy, exactly as the old per-enemy
        // rollCrit. Same rng draw order, so the hash is unchanged.
        this.hitTarget(e, combat.compute({
          attacker: p, ability: def, rank: this.skillRank(p, def), damageType: this.damageTypeOf(p),
          critChance: this.critChance(p), rng: this.rng,
        }), p);
        if (e.hp > 0) this.applyCastEffects(e, def, p);
      }
      return;
    }

    if (p.targetId == null) return;
    const t = this.ents.get(p.targetId);
    if (!t || !this.canAttack(p, t)) return; // needs a living enemy target
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
    this.hitTarget(t, combat.compute({
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
      if (!this.canAttack(p, e)) continue;
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
      if (this.canAttack(p, e)) enemies.push(e);
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
    if (e && this.canAttack(p, e)) p.targetId = id;
  }

  private validateTarget(p: Entity): void {
    if (p.targetId == null) return;
    const t = this.ents.get(p.targetId);
    if (!t || !this.canAttack(p, t)) p.targetId = null;
  }

  // Out-of-combat HP/MP regen (Silkroad-style). On a 1s cadence, once the combat lull has passed,
  // restore a small % of max HP and MP. A spirit doesn't regen (respawn restores it); regen is the
  // only out-of-combat heal, so the player isn't forced to the vendor between fights. No Rng.
  private regenPlayer(p: Entity): void {
    if (p.deadUntil !== 0) return; // a downed spirit doesn't regen
    if (this.tick % REGEN_PERIOD_TICKS !== 0) return; // once per second
    if (this.tick < p.combatUntil) return; // still in / freshly out of combat — no regen yet
    if (p.hp >= p.maxHp && p.mp >= p.maxMp) return; // already topped up
    p.hp = Math.min(p.maxHp, p.hp + Math.max(1, Math.ceil(p.maxHp * REGEN_HP_FRAC)));
    p.mp = Math.min(p.maxMp, p.mp + Math.max(1, Math.ceil(p.maxMp * REGEN_MP_FRAC)));
  }

  private stepPlayer(p: Entity): void {
    if (p.deadUntil !== 0) return; // frozen while a spirit
    if (this.isIncapacitated(p) || this.isRooted(p)) return; // can't move while stunned or rooted
    const intent = this.moveIntents.get(p.id);
    if (!intent || intent.t !== 'move') return;
    // Same integration the server runs (src/sim/movement.ts); slow debuffs cut speed.
    const m = applyMove(p.x, p.z, intent.dx, intent.dz, PLAYER_SPEED * this.slowFactor(p), DT, WORLD_HALF);
    if (!m) return;
    // City wall: can't cross the rampart except through the 4 cardinal gates (slides to a gate
    // when a step would cross elsewhere). Deterministic; player-only.
    const w = slideThroughGates(p.x, p.z, m.x, m.z, CITY_WALL_HALF, GATE_HALF);
    p.x = w.x;
    p.z = w.z;
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

  // Apply a hit to the player. Emits the same 'damage' event the player's own swings use (so the
  // renderer flashes the player and pops the number), and downs the player when HP hits 0. The
  // optional `attacker` is set for PvP (a duel opponent) so the safe-zone can withhold the blow in
  // town; mob bites pass none (their bite already gates the safe-zone), and a DoT passes its source.
  private hitPlayer(p: Entity, hit: Damage, attacker?: Entity): void {
    if (hit.amount <= 0 || p.deadUntil !== 0) return; // ignore hits on an already-downed spirit
    // PvP safe-zone sanctuary: a PLAYER attacker deals NO damage while either side stands in the
    // central town, mirroring the mob rule that won't bite a player in the safe-zone.
    if (attacker?.kind === 'player' && (zoneAt(p.x, p.z).safe || zoneAt(attacker.x, attacker.z).safe)) return;
    // Gear/armor mitigation (combat.mitigate): passthrough today (no armor yet), so
    // `incoming` === hit.amount. Then the Postura Defensiva BUFF — a temporary STATUS, not
    // gear — applies here at the apply step (GDD option A), floored at 1 so a mitigated blow
    // still registers; the event shows the ACTUAL HP lost.
    const incoming = combat.mitigate({ hit, target: p });
    const taken = Math.max(1, Math.round(incoming * this.defenseFactor(p)));
    p.hp = Math.max(0, p.hp - taken);
    p.combatUntil = this.tick + REGEN_LINGER_TICKS; // taking damage holds off regen
    if (attacker?.kind === 'player') attacker.combatUntil = p.combatUntil; // and so does landing a PvP blow
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'damage',
      targetId: p.id,
      amount: taken,
      x: p.x,
      z: p.z,
      crit: hit.crit, // forwarded for the crit pop; the value was already rolled in compute()
    });
    if (p.hp <= 0) this.killPlayer(p, attacker);
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
    // Sistema 2: the learnable +crit passive (Arco's Precisão), by invested rank — players only.
    if (e.kind === 'player') {
      for (const def of this.activeMastery(e).abilities) {
        if (def.kind === 'passive' && def.passiveBonus?.crit && this.skillUnlocked(e, def)) {
          c += def.passiveBonus.crit * this.skillRank(e, def);
        }
      }
    }
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
      // Pass the source so a PvP bleed (a duel opponent's DoT) honors the safe-zone in hitPlayer
      // just like a direct hit; a mob's DoT (source is an enemy) skips that PvP-only check.
      this.hitPlayer(e, hit, this.ents.get(source));
    } else if (e.kind === 'enemy') {
      // Credit the source if it still exists; otherwise credit no one (use the
      // victim as a non-player "killer" so killEnemy grants no XP/loot) rather
      // than handing the local player free credit for a kill it didn't cause.
      const killer = this.ents.get(source) ?? e;
      this.hitEnemy(e, hit, killer);
    }
  }

  // GDD v0.5 (loot físico): drop a stack on the GROUND as a pickup-able world object at (x, z). A plain
  // inert entity (kind 'loot'): the combat/AI code keys on kind 'enemy'/'player', so 'loot' is ignored
  // like 'npc'. Tracked in lootIds for the despawn scan and folded into the hash via Entity.loot.
  private spawnGroundLoot(x: number, z: number, stack: ItemStack): void {
    const id = this.nextId++;
    this.ents.set(id, {
      id, kind: 'loot', name: ITEMS[stack.itemId]?.name ?? stack.itemId,
      x, z, facing: 0,
      hp: 1, maxHp: 1,
      targetId: null,
      str: 0, weaponDamage: 0,
      baseStr: 0, baseWeaponDamage: 0, baseMaxHp: 1, baseMaxMp: 0,
      basePhyDef: 0, baseMagDef: 0, phyDef: 0, magDef: 0,
      swingTicks: 0, nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0, combatUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      sp: 0, skillRanks: {},
      gold: 0, bag: [], storage: [], equipment: emptyEquipment(), effects: [], tier: 'normal',
      species: '',
      boss: false, summoned: false, spawnZone: -1,
      homeX: x, homeZ: z,
      returnCity: '', returnReadyAt: 0,
      targetX: x, targetZ: z, repickAt: 0,
      loot: { stack: { ...stack }, despawnAt: this.tick + LOOT_DESPAWN_TICKS },
    });
    this.lootIds.add(id);
  }

  // GDD v0.5 (loot físico): remove ground items whose despawn timer elapsed (or that vanished otherwise).
  // Scans only lootIds. Deterministic — each removal is independent, so order doesn't matter.
  private despawnGroundLoot(): void {
    if (this.lootIds.size === 0) return;
    let gone: number[] | null = null;
    for (const id of this.lootIds) {
      const e = this.ents.get(id);
      if (!e || !e.loot || this.tick >= e.loot.despawnAt) (gone ??= []).push(id);
    }
    if (gone) for (const id of gone) { this.ents.delete(id); this.lootIds.delete(id); }
  }

  // GDD v0.5 (loot físico): on a NON-duel death, each held BAG stack has a low chance to fall to the
  // ground at the death spot (FFA pickup). Equipped gear is spared — its durability loss is the cost.
  // Uses the dropRng substream so drops never perturb the main loot/position stream; hash-folded.
  private dropPhysicalLoot(p: Entity): void {
    const held = p.bag.filter((s): s is ItemStack => s != null).map((s) => ({ ...s })); // snapshot before mutating p.bag
    for (const s of held) {
      if (this.dropRng.next() >= DEATH_DROP_CHANCE) continue; // kept it
      if (!removeFromBag(p.bag, s.itemId, s.rarity, s.plus, s.qty)) continue; // safety: must still hold the stack
      this.spawnGroundLoot(p.x, p.z, s);
    }
  }

  // GDD v0.5 (loot físico) LF-S2: pick up a ground item the player is standing on. FFA — any living
  // player in range may take it. No-op if it isn't a ground-loot entity, is out of range, or the bag is
  // full (then it stays on the ground). Pure (no Rng); the bag gain + entity removal fold into the hash.
  private pickupLoot(p: Entity, lootId: number): void {
    const e = this.ents.get(lootId);
    if (!e || !e.loot) return; // not a ground-loot entity (or already gone)
    const dx = p.x - e.x, dz = p.z - e.z;
    if (dx * dx + dz * dz > LOOT_PICKUP_RANGE * LOOT_PICKUP_RANGE) return; // too far to reach it
    const s = e.loot.stack;
    if (!addToBag(p.bag, s.itemId, s.rarity, s.plus, s.qty)) return; // bag full -> leave it on the ground
    this.ents.delete(lootId);
    this.lootIds.delete(lootId);
  }

  // GDD v0.5 (loot físico): grab EVERY ground item within reach in one press — the manual "pick up by
  // yourself" (key G) for when there's no collection pet yet. Reuses pickupLoot per item (range + bag-full
  // gating). FFA. Deterministic: snapshots lootIds (insertion order) since pickupLoot mutates the set.
  private pickupNearby(p: Entity): void {
    for (const lootId of [...this.lootIds]) this.pickupLoot(p, lootId);
  }

  // Down the player: enter the "spirit" state, schedule a respawn, and announce the death. Enemies drop
  // the player as a target via their hp<=0 de-aggro. `attacker` (when a player) is the killer — for a
  // NON-duel death that means a free-PK kill, which gets a public kill-feed credit (GDD v0.5 §2).
  private killPlayer(p: Entity, attacker?: Entity): void {
    p.deadUntil = this.tick + DEATH_RESPAWN_TICKS;
    p.targetId = null;
    p.effects.length = 0; // death clears debuffs (no DoT/stun carrying into the spirit/respawn)
    // A DUEL loss (Tier 1 A2) is FRIENDLY: the opponent is credited simply by surviving (the duel
    // resolves in their favor), and there is NO hard death penalty — no durability loss. The loser
    // still spirits + respawns in town like any death. Dissolve the duel for BOTH, then emit the
    // standard death event (text = the loser's name, so the normal death/respawn UI is unchanged).
    if (this.duelOf.has(p.id)) {
      this.removeFromDuel(p.id);
      this.events.push({
        seq: this.nextEventSeq++, tick: this.tick, kind: 'death',
        targetId: p.id, amount: 0, x: p.x, z: p.z, text: p.name,
      });
      return;
    }
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
    this.dropPhysicalLoot(p); // GDD v0.5: a NON-duel death scatters some bag items on the ground (FFA pickup)
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
    // PK livre (GDD v0.5 §2): a PLAYER killer on a NON-duel death = a free-PK kill. Credit it with a
    // public kill-feed announce ("X derrotou Y"), shown to everyone like a boss defeat. The penalty is
    // the SAME as any PvE death (durability + drop above) — no extra punishment for the killer (Shar).
    if (attacker?.kind === 'player') {
      this.events.push({
        seq: this.nextEventSeq++, tick: this.tick, kind: 'pk-kill',
        targetId: p.id, amount: 0, x: p.x, z: p.z, text: `${attacker.name} derrotou ${p.name}`,
      });
    }
  }

  // Once the respawn delay elapses, revive the player at the safe point with
  // HP/MP restored. The wait is the (provisional) death penalty.
  private respawnPlayer(p: Entity): void {
    if (p.deadUntil === 0 || this.tick < p.deadUntil) return;
    p.deadUntil = 0;
    // GDD v0.5: revive at the player's REGISTERED city centre (default 'town' = the original safe
    // point). cityById falls back to 'town', and PLAYER_SPAWN if even that is somehow unknown.
    const home = cityById(p.returnCity) ?? cityById('town');
    p.x = home ? home.cx : PLAYER_SPAWN_X;
    p.z = home ? home.cz : PLAYER_SPAWN_Z;
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
      mix(e.pkActive ? 1 : 0); // PK livre (GDD v0.5): PvP-eligibility flag — gameplay state, so two hosts must agree
      mix(Math.round((e.autoPotHpPct ?? 0) * 100)); // Sistema 15 (QoL): HP auto-pot threshold — drives auto-drinking, so two hosts must agree
      mix(Math.round((e.autoPotMpPct ?? 0) * 100)); // Sistema 15 (QoL): MP auto-pot threshold (same reason)
      mix(e.nextSwingAt);
      mix(e.homeX); mix(e.homeZ); // leash anchor (aggro/chase state)
      mix(e.targetX); mix(e.targetZ); mix(e.repickAt); // wander/leash-return scheduling
      mix(e.mp); mix(e.gcdUntil); mix(e.potionReadyAt); mix(e.deadUntil); mix(e.returnReadyAt);
      mix(e.combatUntil); // out-of-combat regen gate — drives HP/MP regen, so two hosts must agree
      mix(cityIndex(e.returnCity)); // GDD v0.5: registered city (per-player state; drives Return + respawn)
      // Per-slot ability cooldowns are gameplay state too (sibling of gcdUntil).
      // Fingerprint a fixed slot range so it stays complete across masteries.
      for (let slot = 1; slot <= MAX_ABILITY_SLOTS; slot++) mix(e.abilityReadyAt[slot] ?? 0);
      // Progression (level implies maxHp/maxMp, so they need not be mixed too).
      mix(e.level); mix(e.xp); mix(e.attrPoints);
      mix(e.baseStr); mix(e.baseInt); // spent attribute points (str/int)
      // Skill progression: the SP wallet + each ability's rank (sorted keys -> stable).
      mix(e.sp);
      for (const sid of Object.keys(e.skillRanks).sort()) { mix(strHash(sid)); mix(e.skillRanks[sid]); }
      // Economy & bag. The bag is SPARSE (positional) — fold by SLOT order (index 0..n), skipping
      // holes, so the fingerprint reflects WHERE each item sits (same layout => same hash).
      mix(e.gold);
      for (const s of e.bag) {
        if (s == null) continue; // empty slot (hole) — contributes nothing
        mix(strHash(s.itemId)); mix(strHash(s.rarity)); mix(s.plus); mix(s.qty);
      }
      // K5: armazém do jogador (mesmo fold esparso da bag). Storage vazio => 0 iterações => FNV
      // intocado => hash byte-idêntico para todos os mundos que não usam o armazém.
      for (const s of e.storage) {
        if (s == null) continue;
        mix(strHash(s.itemId)); mix(strHash(s.rarity)); mix(s.plus); mix(s.qty);
      }
      // GDD v0.5 (Pets PET2): the transport pet's bag — same sparse fold as storage. Absent/empty => 0
      // iterations => byte-identical to a world that never used a pet bag.
      if (e.petBag) for (const s of e.petBag) {
        if (s == null) continue;
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
      // GDD v0.5 (loot físico): a ground item's stack + despawn tick. Only kind 'loot' sets e.loot, so this
      // branch never runs for players/enemies/NPCs — worlds without ground loot hash byte-identically.
      if (e.loot) {
        mix(strHash(e.loot.stack.itemId)); mix(strHash(e.loot.stack.rarity));
        mix(e.loot.stack.plus); mix(e.loot.stack.qty); mix(e.loot.despawnAt);
      }
      // GDD v0.5 (Pets): the companion's owner link (only kind 'pet' sets it; absent => byte-identical).
      if (e.pet) mix(e.pet.ownerId);
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
    // PvP duel state (deterministic order: duels by id with the canonical a<b pair, then pending
    // challenges by invitee id). Empty offline, so this adds nothing to the hash there.
    for (const did of [...this.duels.keys()].sort((a, b) => a - b)) {
      const duel = this.duels.get(did)!;
      mix(duel.id); mix(duel.a); mix(duel.b);
    }
    for (const iid of [...this.duelInvites.keys()].sort((a, b) => a - b)) {
      mix(iid); mix(this.duelInvites.get(iid)!);
    }
    // GDD v0.5 (Stalls): open stall LISTINGS are deterministic gameplay state (prices both hosts must agree
    // on). Fold by seller id (sorted); empty => 0 iterations => byte-identical to a stall-less world.
    for (const sid of [...this.stalls.keys()].sort((a, b) => a - b)) {
      mix(sid);
      for (const l of this.stalls.get(sid)!) { mix(strHash(l.itemId)); mix(strHash(l.rarity)); mix(l.plus); mix(l.price); }
      mix(-1); // listing-list terminator
    }
    // Global marketplace listings (deterministic gameplay state — prices both hosts must agree on). Sorted
    // by listing id; empty => 0 iterations => byte-identical to a market-less world.
    for (const lid of [...this.marketListings.keys()].sort((a, b) => a - b)) {
      const l = this.marketListings.get(lid)!;
      mix(lid); mix(strHash(l.sellerName));
      mix(strHash(l.item.itemId)); mix(strHash(l.item.rarity)); mix(l.item.plus); mix(l.item.qty); mix(l.price);
    }
    // Marketplace mailbox (proceeds + returned items), sorted by name. Empty => byte-identical.
    for (const key of [...this.mailbox.keys()].sort()) {
      const mb = this.mailbox.get(key)!;
      mix(strHash(key)); mix(mb.gold);
      for (const s of mb.items) { mix(strHash(s.itemId)); mix(strHash(s.rarity)); mix(s.plus); mix(s.qty); }
      mix(-1); // item-list terminator
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

// enhanceChance / enhanceStat now live in ./enhance (K4 — alchemy logic in its own module).

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
