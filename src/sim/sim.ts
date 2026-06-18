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
import type { IWorld, EntityView, Command } from '../world_api';
import { CLASSES } from './content/classes';
import { ENEMY_TEMPLATE, ENEMY_COUNT } from './content/enemies';

export const TICK_RATE = 20;
export const DT = 1 / TICK_RATE; // seconds per tick
export const WORLD_HALF = 60; // world spans -WORLD_HALF..WORLD_HALF on X and Z

const PLAYER_SPEED = 6; // units/sec
const ENEMY_SPEED = 2.4; // units/sec

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
    // A target that died or no longer exists clears the selection.
    if (player) this.validateTarget(player);
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
      // 'move'/'stop' never reach here — they are stored as moveIntent.
      default:
        break;
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
    const fx = Math.sin(p.facing);
    const fz = Math.cos(p.facing);
    const inFront = enemies.filter((e) => {
      const dx = e.x - p.x;
      const dz = e.z - p.z;
      const len = Math.hypot(dx, dz) || 1;
      return (dx / len) * fx + (dz / len) * fz > 0;
    });
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
    }
    mix(this.tick);
    return h.toString(16);
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function dist2(a: { x: number; z: number }, b: { x: number; z: number }): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
