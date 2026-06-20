// The authoritative shared world — ONE instance for everyone connected. It holds the
// players and steps their movement using the SAME integration the offline client runs
// (src/sim/movement.ts) with the SAME constants (src/sim/sim.ts), so a player walks
// identically online and offline. This first slice is presence + movement only: no
// combat, mobs, loot, or inventory yet (those wire the full Sim in later).
import { applyMove } from '../src/sim/movement';
import { PLAYER_SPEED, WORLD_HALF, DT } from '../src/sim/sim';
import type { PlayerSnap } from '../src/net/protocol';

interface ServerPlayer {
  id: number;
  name: string;
  x: number;
  z: number;
  facing: number;
  // latest movement INTENT from the client (a direction; the server owns the position)
  dx: number;
  dz: number;
}

const GOLDEN_ANGLE = 2.399963229728653; // spread spawns so players don't stack on join
const SPAWN_RADIUS = 4;

export class ServerWorld {
  private players = new Map<number, ServerPlayer>();
  private nextId = 1;

  // Spawn a player and return its id. Placed on a small ring (by join order) so two
  // players don't land on the exact same spot.
  addPlayer(name: string): number {
    const id = this.nextId++;
    const a = id * GOLDEN_ANGLE;
    this.players.set(id, {
      id,
      name,
      x: Math.cos(a) * SPAWN_RADIUS,
      z: Math.sin(a) * SPAWN_RADIUS,
      facing: 0,
      dx: 0,
      dz: 0,
    });
    return id;
  }

  removePlayer(id: number): void {
    this.players.delete(id);
  }

  // Store a client's movement intent. We sanitize to a finite, unit-ish direction —
  // the server NEVER trusts a client position, only the direction it wants to go, and
  // moves it at the fixed speed. So a tampered client can't teleport or speed-hack.
  setIntent(id: number, dx: number, dz: number): void {
    const p = this.players.get(id);
    if (!p) return;
    p.dx = Number.isFinite(dx) ? clamp(dx, -1, 1) : 0;
    p.dz = Number.isFinite(dz) ? clamp(dz, -1, 1) : 0;
  }

  // Advance every player one fixed tick.
  step(): void {
    for (const p of this.players.values()) {
      const m = applyMove(p.x, p.z, p.dx, p.dz, PLAYER_SPEED, DT, WORLD_HALF);
      if (m) {
        p.x = m.x;
        p.z = m.z;
        p.facing = m.facing;
      }
    }
  }

  // A snapshot of every player's public state (rounded to keep messages small).
  snapshot(): PlayerSnap[] {
    const out: PlayerSnap[] = [];
    for (const p of this.players.values()) {
      out.push({ id: p.id, name: p.name, x: round(p.x), z: round(p.z), facing: round(p.facing) });
    }
    return out;
  }

  playerCount(): number {
    return this.players.size;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000; // 3 decimals is plenty for positions/radians
}
