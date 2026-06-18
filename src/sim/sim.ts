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
import type { IWorld, EntityView, Command, SimEvent, AbilityView, InventoryView } from '../world_api';
import { CLASSES } from './content/classes';
import { ENEMY_TEMPLATE, ENEMY_COUNT } from './content/enemies';
import { ABILITIES, type AbilityDef } from './content/abilities';
import { ITEMS } from './content/items';
import { BAG_SLOTS, addToBag } from './inventory';

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE; // seconds per tick
export const WORLD_HALF = 60; // world spans -WORLD_HALF..WORLD_HALF on X and Z

const PLAYER_SPEED = 6; // units/sec
const ENEMY_SPEED = 2.4; // units/sec
const MELEE_RANGE = 2.5; // units; provisional melee reach (player + enemy radius + a little)
const CONTACT_DIST = 1.0; // within this the bodies overlap; don't require facing to swing
export const RESPAWN_TICKS = 15 * TICK_RATE; // ~15s after death a same-type enemy respawns
export const EVENT_TTL_TICKS = TICK_RATE; // keep presentation events ~1s for the renderer
export const GCD_TICKS = Math.round(1.5 * TICK_RATE); // 1.5s global cooldown between abilities

// Progression (provisional — GDD §B4b: GENTLE, rewarding pacing; NOT Silkroad's
// brutal grind). Per level-up: +HP/+MP max and +5 attribute points.
export const HP_PER_LEVEL = 20;
export const MP_PER_LEVEL = 15;
export const ATTR_POINTS_PER_LEVEL = 5;
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
      swingTicks: Math.round(cls.swingTime * TICK_RATE), nextSwingAt: 0,
      mp: cls.baseMp, maxMp: cls.baseMp, gcdUntil: 0, abilityReadyAt: {},
      level: 1, xp: 0, attrPoints: 0,
      gold: 0, bag: [],
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
      str: 0, weaponDamage: 0, swingTicks: 0, nextSwingAt: 0,
      mp: 0, maxMp: 0, gcdUntil: 0, abilityReadyAt: {},
      level: 1, xp: 0, attrPoints: 0,
      gold: 0, bag: [],
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
      ? p.bag.map((s) => ({ itemId: s.itemId, name: ITEMS[s.itemId]?.name ?? s.itemId, qty: s.qty }))
      : [];
    return { capacity: BAG_SLOTS, stacks };
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
      if (e.kind === 'enemy') this.stepEnemy(e);
    }
    // Combat runs on the post-movement positions, then deaths repopulate.
    if (player) this.autoAttack(player);
    this.processRespawns();
    this.pruneEvents();
    // A target that died or no longer exists clears the selection.
    if (player) this.validateTarget(player);
  }

  // ---------- combat (melee auto-attack) ----------
  // When the player has a living target that is in range and in front, land a
  // swing every `swingTicks`. The timer is preserved while out of range, so a
  // ready swing fires the moment the target comes back into reach.
  private autoAttack(p: Entity): void {
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
    const dmg = meleeDamage(p.str, p.weaponDamage);
    t.hp -= dmg;
    // Emit a presentation event at the target's current position (captured now
    // so the floating number still shows even if this swing kills it).
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'damage',
      targetId: t.id,
      amount: dmg,
      x: t.x,
      z: t.z,
    });
    if (t.hp <= 0) {
      t.hp = 0;
      this.killEnemy(t, p);
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
    // Respawn a same-type enemy after a delay. (One template today; pass the
    // template id / xp reward per-entity once there are several.)
    this.respawnQueue.push(this.tick + RESPAWN_TICKS);
    if (killer.kind === 'player') {
      this.gainXp(killer, ENEMY_TEMPLATE.xp);
      this.rollLoot(killer);
    }
  }

  // Roll a kill's loot into the killer's bag. ALL randomness goes through the
  // sim Rng (never Math.random) so the same seed + commands drop the same loot.
  // (Single enemy template today; read the reward from the dead entity's
  // template once there are several.)
  private rollLoot(p: Entity): void {
    const t = ENEMY_TEMPLATE;
    p.gold += this.rng.int(t.goldMin, t.goldMax + 1); // always a little gold
    for (const drop of t.drops) {
      if (this.rng.next() < drop.chance) addToBag(p.bag, drop.itemId, 1);
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
    p.maxHp += HP_PER_LEVEL;
    p.maxMp += MP_PER_LEVEL;
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

  // ---------- target selection (tab-target) ----------
  private applyAction(p: Entity, cmd: Command): void {
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
      // 'move'/'stop' never reach here — they are stored as moveIntent.
      default:
        break;
    }
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
    const dmg = abilityDamage(def, p.str, p.weaponDamage);
    t.hp -= dmg;
    this.events.push({
      seq: this.nextEventSeq++,
      tick: this.tick,
      kind: 'damage',
      targetId: t.id,
      amount: dmg,
      x: t.x,
      z: t.z,
    });
    if (t.hp <= 0) {
      t.hp = 0;
      this.killEnemy(t, p);
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
    if (this.moveIntent.t !== 'move') return;
    const len = Math.hypot(this.moveIntent.dx, this.moveIntent.dz);
    if (len < 1e-4) return;
    const nx = this.moveIntent.dx / len;
    const nz = this.moveIntent.dz / len;
    p.x = clamp(p.x + nx * PLAYER_SPEED * DT, -WORLD_HALF, WORLD_HALF);
    p.z = clamp(p.z + nz * PLAYER_SPEED * DT, -WORLD_HALF, WORLD_HALF);
    p.facing = Math.atan2(nx, nz);
  }

  private stepEnemy(e: Entity): void {
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
      mix(e.mp); mix(e.gcdUntil);
      // Per-slot ability cooldowns are gameplay state too (sibling of gcdUntil).
      for (const def of ABILITIES) mix(e.abilityReadyAt[def.slot] ?? 0);
      // Progression (level implies maxHp/maxMp, so they need not be mixed too).
      mix(e.level); mix(e.xp); mix(e.attrPoints);
      // Economy & bag (stacks are in deterministic insertion order).
      mix(e.gold);
      for (const s of e.bag) { mix(strHash(s.itemId)); mix(s.qty); }
    }
    // Pending respawns are deterministic state too (FIFO order is stable).
    for (const at of this.respawnQueue) mix(at);
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
