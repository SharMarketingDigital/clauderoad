// The authoritative shared world — ONE instance for everyone connected. It now runs
// the FULL deterministic sim (`src/sim/`): players, MOBS, and COMBAT all live here, so
// two clients farm the exact same enemies and see the exact same fight. The server is
// the single source of truth; clients send only INTENT and render the snapshots.
//
// Reuse, never fork: this wraps `Sim` (the same code the offline client runs) with
// `spawnLocal=false`, so there's no phantom local player — only the networked clients
// it adds on join. Movement, mob AI, damage, death and respawn are identical online
// and offline because it's literally the same simulation.
import { Sim } from '../src/sim/sim';
import type { EntitySnap, NetEvent } from '../src/net/protocol';

export class ServerWorld {
  private sim: Sim;
  private lastEventSeq = 0; // highest sim event seq already forwarded to clients

  constructor(seed: number) {
    this.sim = new Sim(seed, /* spawnLocal */ false);
  }

  addPlayer(name: string): number {
    return this.sim.addPlayer(name);
  }

  removePlayer(id: number): void {
    this.sim.removePlayer(id);
  }

  // A movement INTENT: sanitize to a finite, unit-ish DIRECTION (never a position) and
  // hand it to the sim as a held move/stop command. The sim integrates at the fixed
  // speed, so a tampered client can't teleport or speed-hack.
  setIntent(id: number, dx: number, dz: number): void {
    const fx = Number.isFinite(dx) ? clamp(dx, -1, 1) : 0;
    const fz = Number.isFinite(dz) ? clamp(dz, -1, 1) : 0;
    this.sim.sendCommandFor(id, fx === 0 && fz === 0 ? { t: 'stop' } : { t: 'move', dx: fx, dz: fz });
  }

  // Combat intents. The sim VALIDATES every one (target must be a living enemy; range,
  // cooldown/GCD and MP gate the cast) — the client decides nothing, it only asks.
  setTarget(id: number, targetId: number | null): void {
    this.sim.sendCommandFor(id, { t: 'set-target', id: targetId });
  }
  cycleTarget(id: number): void {
    this.sim.sendCommandFor(id, { t: 'cycle-target' });
  }
  useAbility(id: number, slot: number): void {
    if (Number.isInteger(slot) && slot >= 1 && slot <= 9) {
      this.sim.sendCommandFor(id, { t: 'use-ability', slot });
    }
  }

  // Advance the shared world one fixed tick (players + mobs + combat).
  step(): void {
    this.sim.step();
  }

  // The shared world (players + mobs + the town NPC), plus the combat events the sim
  // produced SINCE the last snapshot (so every client draws each damage number / death
  // exactly once). Numbers are rounded to keep the message small.
  snapshot(): { entities: EntitySnap[]; events: NetEvent[] } {
    const entities: EntitySnap[] = [];
    for (const e of this.sim.entities()) {
      entities.push({
        id: e.id,
        kind: e.kind,
        name: e.name,
        x: round(e.x),
        z: round(e.z),
        facing: round(e.facing),
        hp: Math.round(e.hp),
        maxHp: Math.round(e.maxHp),
        tier: e.tier,
        boss: e.boss,
        hostile: e.hostile,
        dead: e.dead,
      });
    }
    const events: NetEvent[] = [];
    for (const ev of this.sim.recentEvents()) {
      if (ev.seq <= this.lastEventSeq) continue; // already sent (events are seq-ascending)
      this.lastEventSeq = ev.seq;
      events.push({
        seq: ev.seq,
        kind: ev.kind,
        targetId: ev.targetId,
        amount: ev.amount,
        x: round(ev.x),
        z: round(ev.z),
        text: ev.text,
      });
    }
    return { entities, events };
  }

  playerCount(): number {
    return this.sim.players().length;
  }
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000; // 3 decimals is plenty for positions/radians
}
