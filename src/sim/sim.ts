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
import type { Entity } from './types';
import type {
  IWorld, EntityView, Command, SimEvent, AbilityView, InventoryView, EquipSlot, Rarity,
} from '../world_api';
import { CLASSES } from './content/classes';
import { ENEMY_TEMPLATE, ENEMY_COUNT } from './content/enemies';
import { ABILITIES, type AbilityDef } from './content/abilities';
import { ITEMS, POTION_COOLDOWN_SECS } from './content/items';
import { RARITIES, type RarityDef } from './content/rarity';
import {
  BOSS_TEMPLATE, BOSS_SPAWN_X, BOSS_SPAWN_Z, BOSS_FIRST_SPAWN_TICK, BOSS_RESPAWN_TICKS,
  MINION_SPAWN_RADIUS,
} from './content/bosses';
import {
  MAX_PLUS, ENHANCE_SUCCESS, LUCKY_POWDER_BONUS, ENHANCE_CHANCE_CAP, ENHANCE_STAT_PER_PLUS,
} from './content/enhance';
import { BAG_SLOTS, addToBag, removeFromBag } from './inventory';

const EQUIP_SLOTS: EquipSlot[] = ['weapon', 'armor'];

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE; // seconds per tick
export const WORLD_HALF = 60; // world spans -WORLD_HALF..WORLD_HALF on X and Z

const PLAYER_SPEED = 6; // units/sec
const ENEMY_SPEED = 2.4; // units/sec
const MELEE_RANGE = 2.5; // units; provisional melee reach (player + enemy radius + a little)
const CONTACT_DIST = 1.0; // within this the bodies overlap; don't require facing to swing
export const RESPAWN_TICKS = 15 * TICK_RATE; // ~15s after death a same-type enemy respawns
// ~5s as a spirit before respawn — the early-WoW "cheap death + corpse run" model.
// PROVISIONAL: the GDD B8 penalty (gear-durability loss, a real graveyard revive) is
// deliberately deferred; today the wait is the only cost (see respawnPlayer).
export const DEATH_RESPAWN_TICKS = 5 * TICK_RATE;
const PLAYER_SPAWN_X = 0; // the "graveyard"/safe point a downed player wakes up at
const PLAYER_SPAWN_Z = 0;
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

export class Sim implements IWorld {
  tick = 0;

  private rng: Rng;
  private ents = new Map<number, Entity>();
  private nextId = 1;
  private localId: number;
  // Continuous movement intent (held until changed).
  private moveIntent: Command = { t: 'stop' };
  // One-shot actions (target selection, later: ability casts) queued by the
  // host and drained at the start of the next tick — so ALL state mutation
  // still happens inside step(), keeping the sim deterministic.
  private pending: Command[] = [];
  // Ticks at which a dead enemy should respawn (FIFO; processed each tick).
  private respawnQueue: number[] = [];
  // World boss: the live boss entity id (null when none) and the tick at which
  // the next boss should spawn (Infinity while one is alive). Tick-driven only.
  private bossId: number | null = null;
  private bossSpawnAt = BOSS_FIRST_SPAWN_TICK;
  // How many HP-threshold minion summons the current boss has already fired
  // (reset when a new boss spawns). Indexes BOSS_TEMPLATE.summonThresholds.
  private bossSummonsFired = 0;
  // Recent presentation events (damage numbers, hit flashes). Bounded by age
  // (EVENT_TTL_TICKS) so it never grows unbounded; `seq` is monotonic forever.
  private events: SimEvent[] = [];
  private nextEventSeq = 1;

  constructor(seed: number) {
    this.rng = new Rng(seed);
    this.localId = this.spawnPlayer('Hero');
    for (let i = 0; i < ENEMY_COUNT; i++) this.spawnEnemy();
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
      gold: 0, bag: [], equipment: { weapon: null, armor: null },
      boss: false, summoned: false,
      homeX: 0, homeZ: 0,
      targetX: 0, targetZ: 0, repickAt: 0,
    });
    return id;
  }

  private spawnEnemy(): void {
    const id = this.nextId++;
    const x = this.rng.range(-WORLD_HALF, WORLD_HALF);
    const z = this.rng.range(-WORLD_HALF, WORLD_HALF);
    this.ents.set(id, {
      id, kind: 'enemy', name: ENEMY_TEMPLATE.name,
      x, z, facing: 0,
      hp: ENEMY_TEMPLATE.hp, maxHp: ENEMY_TEMPLATE.hp,
      targetId: null,
      str: ENEMY_TEMPLATE.str, weaponDamage: ENEMY_TEMPLATE.weaponDamage,
      baseStr: 0, baseWeaponDamage: 0, baseMaxHp: ENEMY_TEMPLATE.hp, baseMaxMp: 0,
      swingTicks: Math.round(ENEMY_TEMPLATE.swingTime * TICK_RATE), nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      gold: 0, bag: [], equipment: { weapon: null, armor: null },
      boss: false, summoned: false,
      homeX: x, homeZ: z,
      targetX: x, targetZ: z, repickAt: 0,
    });
  }

  // Spawn the world boss at its fixed point. No Rng (fixed position), so it
  // doesn't perturb the loot stream. Announces via a 'boss-spawn' event.
  private spawnBoss(): void {
    const id = this.nextId++;
    const t = BOSS_TEMPLATE;
    this.ents.set(id, {
      id, kind: 'enemy', name: t.name,
      x: BOSS_SPAWN_X, z: BOSS_SPAWN_Z, facing: 0,
      hp: t.hp, maxHp: t.hp,
      targetId: null,
      str: t.str, weaponDamage: t.weaponDamage,
      baseStr: t.str, baseWeaponDamage: t.weaponDamage, baseMaxHp: t.hp, baseMaxMp: 0,
      swingTicks: Math.round(t.swingTime * TICK_RATE), nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      gold: 0, bag: [], equipment: { weapon: null, armor: null },
      boss: true, summoned: false,
      homeX: BOSS_SPAWN_X, homeZ: BOSS_SPAWN_Z,
      targetX: BOSS_SPAWN_X, targetZ: BOSS_SPAWN_Z, repickAt: 0,
    });
    this.bossId = id;
    this.bossSpawnAt = Infinity; // don't schedule another while this one lives
    this.bossSummonsFired = 0; // fresh boss -> can summon all its waves again
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'boss-spawn',
      targetId: id,
      amount: 0,
      x: BOSS_SPAWN_X,
      z: BOSS_SPAWN_Z,
      text: t.name,
    });
  }

  // Fire a minion-summon wave for each HP threshold the boss has NEWLY crossed.
  // Thresholds are descending and fire once each (bossSummonsFired advances), so
  // one big hit crossing several fires several. HP only drops, so no un-firing.
  private checkBossSummons(boss: Entity): void {
    const thresholds = BOSS_TEMPLATE.summonThresholds;
    while (
      this.bossSummonsFired < thresholds.length &&
      boss.hp <= boss.maxHp * thresholds[this.bossSummonsFired]
    ) {
      this.summonMinions(boss);
      this.bossSummonsFired++;
    }
  }

  // Spawn a ring of minions around the boss and announce the call.
  private summonMinions(boss: Entity): void {
    const n = BOSS_TEMPLATE.minionCount;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2;
      this.spawnMinion(
        clamp(boss.x + Math.cos(a) * MINION_SPAWN_RADIUS, -WORLD_HALF, WORLD_HALF),
        clamp(boss.z + Math.sin(a) * MINION_SPAWN_RADIUS, -WORLD_HALF, WORLD_HALF),
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
      text: BOSS_TEMPLATE.name,
    });
  }

  // A boss minion: a common-mob-like enemy (selectable/attackable) but ephemeral
  // (summoned:true) so killing it doesn't feed the common respawn queue.
  private spawnMinion(x: number, z: number): void {
    const id = this.nextId++;
    this.ents.set(id, {
      id, kind: 'enemy', name: BOSS_TEMPLATE.minionName,
      x, z, facing: 0,
      hp: BOSS_TEMPLATE.minionHp, maxHp: BOSS_TEMPLATE.minionHp,
      targetId: null,
      str: ENEMY_TEMPLATE.str, weaponDamage: ENEMY_TEMPLATE.weaponDamage,
      baseStr: 0, baseWeaponDamage: 0, baseMaxHp: BOSS_TEMPLATE.minionHp, baseMaxMp: 0,
      swingTicks: Math.round(ENEMY_TEMPLATE.swingTime * TICK_RATE), nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {}, potionReadyAt: 0, deadUntil: 0,
      level: 1, xp: 0, attrPoints: 0, baseInt: 0,
      gold: 0, bag: [], equipment: { weapon: null, armor: null },
      boss: false, summoned: true,
      homeX: x, homeZ: z,
      targetX: x, targetZ: z, repickAt: 0,
    });
  }

  // ---------- IWorld ----------
  localPlayerId(): number | null {
    return this.localId;
  }

  localTargetId(): number | null {
    const p = this.ents.get(this.localId);
    return p ? p.targetId : null;
  }

  recentEvents(): ReadonlyArray<SimEvent> {
    // Hand out a snapshot, never the live array — mirrors entities() and keeps
    // render/ui structurally unable to mutate sim state. (Bounded, so cheap.)
    return this.events.slice();
  }

  abilities(): ReadonlyArray<AbilityView> {
    const p = this.ents.get(this.localId);
    return ABILITIES.map((def) => {
      const cdLeft = p ? Math.max(0, (p.abilityReadyAt[def.slot] ?? 0) - this.tick) : 0;
      const gcdLeft = p ? Math.max(0, p.gcdUntil - this.tick) : 0;
      const ready = !!p && cdLeft === 0 && gcdLeft === 0 && p.mp >= def.mpCost;
      return {
        slot: def.slot,
        name: def.name,
        icon: def.icon,
        mpCost: def.mpCost,
        ready,
        cooldownRemaining: cdLeft * DT, // ticks -> seconds
        cooldownTotal: def.cooldownSecs,
      };
    });
  }

  inventory(): InventoryView {
    const p = this.ents.get(this.localId);
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
      };
    });
    return { capacity: BAG_SLOTS, stacks, equipment };
  }

  sendCommand(cmd: Command): void {
    // Movement is a held intent (latest wins); everything else is a one-shot
    // action queued for the next tick.
    if (cmd.t === 'move' || cmd.t === 'stop') this.moveIntent = cmd;
    else this.pending.push(cmd);
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
        str: e.str, weaponDamage: e.weaponDamage,
        int: e.baseInt,
        weaponPlus: e.equipment.weapon?.plus ?? 0,
        boss: e.boss,
        hostile: e.kind === 'enemy' && e.targetId != null,
        dead: e.kind === 'player' && e.deadUntil !== 0,
      });
    }
    return out;
  }

  // ---------- simulation ----------
  step(): void {
    this.tick++;
    const player = this.ents.get(this.localId);
    // Drain one-shot actions first, then movement, then enemies.
    if (player) {
      for (const cmd of this.pending) this.applyAction(player, cmd);
    }
    this.pending.length = 0;
    if (player) this.stepPlayer(player);
    for (const e of this.ents.values()) {
      if (e.kind === 'enemy') this.stepEnemy(e, player);
    }
    // Combat runs on the post-movement positions, then deaths repopulate.
    if (player) this.autoAttack(player);
    if (player) this.respawnPlayer(player); // revive a downed player once its timer elapses
    this.processRespawns();
    this.updateBoss();
    this.pruneEvents();
    // A target that died or no longer exists clears the selection.
    if (player) this.validateTarget(player);
  }

  // ---------- combat (melee auto-attack) ----------
  // When the player has a living target that is in range and in front, land a
  // swing every `swingTicks`. The timer is preserved while out of range, so a
  // ready swing fires the moment the target comes back into reach.
  private autoAttack(p: Entity): void {
    if (p.deadUntil !== 0) return; // no swinging while downed
    if (p.targetId == null || p.swingTicks <= 0) return;
    const t = this.ents.get(p.targetId);
    if (!t || t.kind !== 'enemy' || t.hp <= 0) return; // validateTarget clears it
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > MELEE_RANGE) return; // out of range: hold the swing
    // Require facing the target only while approaching. At contact the bodies
    // overlap, the direction vector collapses to ~0, and the player constantly
    // overshoots — requiring "in front" there would skip swings on the enemy
    // we're standing on. (The frontal rule still applies on the approach.)
    if (dist > CONTACT_DIST && !inFrontOf(dx, dz, p.facing)) return;
    if (this.tick < p.nextSwingAt) return; // swing still on cooldown
    p.nextSwingAt = this.tick + p.swingTicks;
    this.hitEnemy(t, meleeDamage(p.str, p.weaponDamage), p);
  }

  // Apply a hit to an enemy: subtract HP, surface the floating damage number,
  // fire the boss's minion summons when its HP crosses a threshold, and kill it
  // at 0. Centralized so every damage source goes through the same path.
  private hitEnemy(t: Entity, dmg: number, killer: Entity): void {
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
    if (dead.boss) {
      // The boss reschedules on its OWN timer (not the common-mob queue) and
      // announces its defeat.
      this.bossId = null;
      this.bossSpawnAt = this.tick + BOSS_RESPAWN_TICKS;
      this.events.push({
        seq: this.nextEventSeq++,
        tick: this.tick,
        kind: 'boss-defeat',
        targetId: dead.id,
        amount: 0,
        x: dead.x,
        z: dead.z,
        text: BOSS_TEMPLATE.name,
      });
    } else if (!dead.summoned) {
      // Common enemies respawn after a delay; summoned minions are ephemeral.
      this.respawnQueue.push(this.tick + RESPAWN_TICKS);
    }
    if (killer.kind === 'player') {
      this.gainXp(killer, dead.boss ? BOSS_TEMPLATE.xp : ENEMY_TEMPLATE.xp);
      this.rollLoot(killer, dead.boss);
    }
  }

  // Roll a kill's loot into the killer's bag. ALL randomness goes through the
  // sim Rng (never Math.random) so the same seed + commands drop the same loot.
  // The boss uses its own (bigger gold, generous drops, far better rarities) table.
  private rollLoot(p: Entity, boss: boolean): void {
    const t = boss ? BOSS_TEMPLATE : ENEMY_TEMPLATE;
    const rarities = boss ? BOSS_TEMPLATE.rarities : RARITIES;
    p.gold += this.rng.int(t.goldMin, t.goldMax + 1); // always a little gold
    for (const drop of t.drops) {
      // First decide if the item drops at all, then roll HOW rare it is.
      // Only equippable gear has a meaningful rarity; materials/consumables drop
      // as plain Normal. Everything drops un-enhanced (+0).
      if (this.rng.next() < drop.chance) {
        const equippable = ITEMS[drop.itemId]?.slot != null;
        const rarity = equippable ? rollRarity(this.rng, rarities) : 'normal';
        addToBag(p.bag, drop.itemId, rarity, 0, 1);
      }
    }
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
    const remaining: number[] = [];
    for (const at of this.respawnQueue) {
      if (this.tick >= at) this.spawnEnemy();
      else remaining.push(at);
    }
    this.respawnQueue = remaining;
  }

  // Spawn the world boss once its scheduled tick arrives (and none is alive).
  private updateBoss(): void {
    if (this.bossId === null && this.tick >= this.bossSpawnAt) this.spawnBoss();
  }

  // ---------- target selection (tab-target) ----------
  private applyAction(p: Entity, cmd: Command): void {
    if (p.deadUntil !== 0) return; // a downed spirit can't act until it respawns
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
      case 'use-item':
        this.useItem(p, cmd.itemId, cmd.rarity, cmd.plus);
        break;
      case 'spend-attr':
        this.spendAttr(p, cmd.attr);
        break;
      // 'move'/'stop' never reach here — they are stored as moveIntent.
      default:
        break;
    }
  }

  // ---------- equipment ----------
  // Equip an item the player holds in the bag. Swaps out whatever occupies the
  // target slot (back to the bag) and folds the new gear's stats into combat.
  private equip(p: Entity, itemId: string, rarity: Rarity, plus: number): void {
    const def = ITEMS[itemId];
    if (!def || !def.slot) return; // unknown or not equippable
    if (!removeFromBag(p.bag, itemId, rarity, plus, 1)) return; // must hold that exact stack
    const prev = p.equipment[def.slot];
    p.equipment[def.slot] = { itemId, rarity, plus };
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
      // base -> rarity-scaled -> "+N"-scaled. Higher rarity AND higher "+" both
      // grow the bonus.
      const scale = (v: number): number => enhanceStat(rarityStat(v, eq.rarity), eq.plus);
      bonusStr += scale(stats.str ?? 0);
      bonusWeapon += scale(stats.weaponDamage ?? 0);
      bonusMaxHp += scale(stats.maxHp ?? 0);
      bonusMaxMp += scale(stats.maxMp ?? 0);
    }
    p.str = p.baseStr + bonusStr;
    p.weaponDamage = p.baseWeaponDamage + bonusWeapon;
    p.maxHp = p.baseMaxHp + bonusMaxHp;
    p.maxMp = p.baseMaxMp + p.baseInt * MP_PER_INT + bonusMaxMp; // Intelligence adds max MP
    if (p.hp > p.maxHp) p.hp = p.maxHp;
    if (p.mp > p.maxMp) p.mp = p.maxMp;
  }

  // Cast an action-bar ability on the current target. Gated by the global
  // cooldown, the ability's own cooldown, MP, and melee range — all checked
  // deterministically here. A successful cast deals the (bigger) hit and emits
  // the same damage event the auto-attack does, so the number/flash show too.
  private useAbility(p: Entity, slot: number): void {
    const def = ABILITIES.find((a) => a.slot === slot);
    if (!def) return;
    if (this.tick < p.gcdUntil) return; // global cooldown
    if (this.tick < (p.abilityReadyAt[slot] ?? 0)) return; // own cooldown
    if (p.mp < def.mpCost) return; // not enough MP
    if (p.targetId == null) return;
    const t = this.ents.get(p.targetId);
    if (!t || t.kind !== 'enemy' || t.hp <= 0) return; // needs a living enemy target
    // Actions are drained before movement, so this range/facing gate sees
    // start-of-tick positions (auto-attack checks post-move). One-tick edge on
    // the exact range boundary; deterministic either way.
    const dx = t.x - p.x;
    const dz = t.z - p.z;
    const dist = Math.hypot(dx, dz);
    if (dist > MELEE_RANGE) return; // melee ability: target must be in reach
    if (dist > CONTACT_DIST && !inFrontOf(dx, dz, p.facing)) return;
    // Commit: spend MP, start the global + own cooldowns, deal the bigger hit.
    p.mp -= def.mpCost;
    p.gcdUntil = this.tick + GCD_TICKS;
    p.abilityReadyAt[slot] = this.tick + Math.round(def.cooldownSecs * TICK_RATE);
    this.hitEnemy(t, abilityDamage(def, p.str, p.weaponDamage), p);
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
    if (this.moveIntent.t !== 'move') return;
    const len = Math.hypot(this.moveIntent.dx, this.moveIntent.dz);
    if (len < 1e-4) return;
    const nx = this.moveIntent.dx / len;
    const nz = this.moveIntent.dz / len;
    p.x = clamp(p.x + nx * PLAYER_SPEED * DT, -WORLD_HALF, WORLD_HALF);
    p.z = clamp(p.z + nz * PLAYER_SPEED * DT, -WORLD_HALF, WORLD_HALF);
    p.facing = Math.atan2(nx, nz);
  }

  // Enemy AI. An idle enemy pulls aggro when a living player comes within its
  // aggro radius; once aggroed it chases and bites in melee every swingTicks,
  // and leashes (drops aggro, heals to full, ambles back) if led past its leash
  // radius from where the chase began. The world boss never chases — it holds
  // its ground and only bites what steps into melee. Deterministic: movement is
  // arithmetic; only the idle wander destination draws from the sim Rng.
  private stepEnemy(e: Entity, player: Entity | undefined): void {
    const tmpl = e.boss ? BOSS_TEMPLATE : ENEMY_TEMPLATE;

    // --- decide aggro / leash ---
    if (e.targetId == null) {
      // idle: pull aggro if a living player is within range
      if (player && player.hp > 0) {
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
      if (dist <= MELEE_RANGE && e.swingTicks > 0 && this.tick >= e.nextSwingAt) {
        e.nextSwingAt = this.tick + e.swingTicks;
        this.hitPlayer(target, meleeDamage(e.str, e.weaponDamage));
      }
      if (!e.boss && dist > CONTACT_DIST) {
        // the boss is rooted, so it bites in melee but never chases
        const len = dist < 1e-4 ? 1 : dist;
        e.x = clamp(e.x + (dx / len) * ENEMY_SPEED * DT, -WORLD_HALF, WORLD_HALF);
        e.z = clamp(e.z + (dz / len) * ENEMY_SPEED * DT, -WORLD_HALF, WORLD_HALF);
        e.facing = Math.atan2(dx / len, dz / len);
      }
      return;
    }

    // Idle: the boss holds its ground; common enemies wander.
    if (e.boss) return;
    if (this.tick >= e.repickAt) {
      e.targetX = this.rng.range(-WORLD_HALF, WORLD_HALF);
      e.targetZ = this.rng.range(-WORLD_HALF, WORLD_HALF);
      e.repickAt = this.tick + this.rng.int(40, 120); // re-pick every 2..6s
    }
    const dx = e.targetX - e.x;
    const dz = e.targetZ - e.z;
    const len = Math.hypot(dx, dz);
    if (len < 0.1) return;
    e.x += (dx / len) * ENEMY_SPEED * DT;
    e.z += (dz / len) * ENEMY_SPEED * DT;
    e.facing = Math.atan2(dx / len, dz / len);
  }

  // Apply a melee hit to the player. Emits the same 'damage' event the player's
  // own swings use (so the renderer flashes the player and pops the number), and
  // downs the player when HP hits 0.
  private hitPlayer(p: Entity, dmg: number): void {
    if (dmg <= 0 || p.deadUntil !== 0) return; // ignore hits on an already-downed spirit
    p.hp = Math.max(0, p.hp - dmg);
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'damage',
      targetId: p.id,
      amount: dmg,
      x: p.x,
      z: p.z,
    });
    if (p.hp <= 0) this.killPlayer(p);
  }

  // Down the player: enter the "spirit" state, schedule a respawn, and announce
  // the death. Enemies drop the player as a target via their hp<=0 de-aggro.
  private killPlayer(p: Entity): void {
    p.deadUntil = this.tick + DEATH_RESPAWN_TICKS;
    p.targetId = null;
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
    this.moveIntent = { t: 'stop' }; // don't drift from a pre-death movement intent
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
      for (const def of ABILITIES) mix(e.abilityReadyAt[def.slot] ?? 0);
      // Progression (level implies maxHp/maxMp, so they need not be mixed too).
      mix(e.level); mix(e.xp); mix(e.attrPoints);
      mix(e.baseStr); mix(e.baseInt); // spent attribute points (str/int)
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
      }
    }
    // Pending respawns are deterministic state too (FIFO order is stable).
    for (const at of this.respawnQueue) mix(at);
    // Boss schedule (Infinity while alive -> sentinel) + summon progress.
    mix(this.bossId ?? -1);
    mix(Number.isFinite(this.bossSpawnAt) ? this.bossSpawnAt : -1);
    mix(this.bossSummonsFired);
    // The monotonic event counter fingerprints "how much combat has happened".
    mix(this.nextEventSeq);
    mix(this.tick);
    return h.toString(16);
  }
}

// Provisional melee hit. Grounded loosely in WoW Classic, where a swing deals
// weapon damage plus a contribution from attack power, and Strength feeds AP
// (~1 AP per STR for warriors). Simplified here to weapon + floor(STR * k).
// No RNG, so it's deterministic; tune the curve later (see GDD §B1).
export const STR_TO_DAMAGE = 0.5;
export function meleeDamage(str: number, weaponDamage: number): number {
  return weaponDamage + Math.floor(str * STR_TO_DAMAGE);
}

// An ability's hit: the base melee swing scaled up, so it always out-damages
// the auto-attack. Pure & deterministic (no RNG); tune the multiplier later.
export function abilityDamage(def: AbilityDef, str: number, weaponDamage: number): number {
  return Math.round(meleeDamage(str, weaponDamage) * def.damageMultiplier);
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

// Stable 32-bit hash of a string, for folding item ids into the world hash().
function strHash(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (Math.imul(h, 31) + s.charCodeAt(i)) | 0;
  return h;
}
