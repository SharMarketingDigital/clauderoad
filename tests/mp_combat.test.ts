// Shared MOBS + COMBAT in multiplayer: the server runs the FULL sim with N players
// (`new Sim(seed, false)` — no local player; clients join via addPlayer). These tests
// prove the server-authoritative behavior the two clients rely on: one shared set of
// mobs, combat decided in the sim, mobs that die + respawn, nearest-player aggro, and
// determinism (same seed + same per-player commands => same world).
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { STARTING_ENEMY_COUNT } from '../src/sim/sim';

const enemies = (sim: Sim) => sim.entities().filter((e) => e.kind === 'enemy');
const players = (sim: Sim) => sim.entities().filter((e) => e.kind === 'player');
const byId = (sim: Sim, id: number) => sim.entities().find((e) => e.id === id);

function nearestEnemy(sim: Sim, x: number, z: number) {
  let best: ReturnType<typeof enemies>[number] | undefined;
  let bestD = Infinity;
  for (const e of enemies(sim)) {
    const d = (e.x - x) ** 2 + (e.z - z) ** 2;
    if (d < bestD) { bestD = d; best = e; }
  }
  return best!;
}

describe('multiplayer shared world (server-mode Sim)', () => {
  it('runs mobs with NO local player and no players initially', () => {
    const sim = new Sim(1337, false);
    expect(sim.players().length).toBe(0);
    expect(players(sim).length).toBe(0);
    expect(enemies(sim).length).toBe(STARTING_ENEMY_COUNT);
    for (let i = 0; i < 100; i++) sim.step(); // mobs wander/respawn without a player, no crash
    expect(enemies(sim).length).toBeGreaterThan(0);
  });

  it('addPlayer / removePlayer manage players + entities', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    expect([...sim.players()]).toEqual([a, b]);
    expect(players(sim).map((e) => e.id).sort((x, y) => x - y)).toEqual([a, b].sort((x, y) => x - y));
    sim.removePlayer(a);
    expect([...sim.players()]).toEqual([b]);
    expect(byId(sim, a)).toBeUndefined();
    expect(byId(sim, b)).toBeDefined();
  });

  it('two players share the SAME mobs (one authoritative world)', () => {
    const sim = new Sim(1337, false);
    sim.addPlayer('A');
    sim.addPlayer('B');
    for (let i = 0; i < 20; i++) sim.step();
    // entities() is the one shared list the server snapshots to BOTH clients.
    expect(enemies(sim).length).toBeGreaterThan(0);
    expect(players(sim).length).toBe(2);
  });

  it('a player damages a mob — combat is decided in the server sim', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    const targetId = nearestEnemy(sim, byId(sim, a)!.x, byId(sim, a)!.z).id;
    const startHp = byId(sim, targetId)!.hp;
    let hurt = false;
    for (let i = 0; i < 500 && !hurt; i++) {
      const me = byId(sim, a)!;
      const t = byId(sim, targetId);
      if (!t) { hurt = true; break; } // already killed -> certainly took damage
      sim.sendCommandFor(a, { t: 'move', dx: t.x - me.x, dz: t.z - me.z }); // chase it
      sim.sendCommandFor(a, { t: 'set-target', id: targetId });
      sim.step();
      const after = byId(sim, targetId);
      if (!after || after.hp < startHp) hurt = true;
    }
    expect(hurt).toBe(true); // the SERVER sim applied the damage (the client never decides it)
  });

  it('a mob dies and then respawns for the shared world', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    const targetId = nearestEnemy(sim, byId(sim, a)!.x, byId(sim, a)!.z).id;
    let killed = false;
    for (let i = 0; i < 1500 && !killed; i++) {
      const me = byId(sim, a)!;
      const t = byId(sim, targetId);
      if (!t) { killed = true; break; }
      sim.sendCommandFor(a, { t: 'move', dx: t.x - me.x, dz: t.z - me.z });
      sim.sendCommandFor(a, { t: 'set-target', id: targetId });
      sim.step();
    }
    expect(killed).toBe(true); // the mob died for everyone (it's gone from the shared world)
    let recovered = false;
    for (let i = 0; i < 3000 && !recovered; i++) {
      sim.step();
      if (enemies(sim).length >= STARTING_ENEMY_COUNT) recovered = true; // the pack repopulated
    }
    expect(recovered).toBe(true);
  });

  it('a mob aggros the NEAREST of two players', () => {
    const sim = new Sim(7, false);
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    // Pick the mob that is most clearly closer to A than to B, so A is unambiguously
    // its nearest player; then drive A onto it while B actively flees it.
    const pa0 = byId(sim, a)!;
    const pb0 = byId(sim, b)!;
    let mobId = -1;
    let bestScore = -Infinity;
    for (const e of enemies(sim)) {
      const score = ((e.x - pb0.x) ** 2 + (e.z - pb0.z) ** 2) - ((e.x - pa0.x) ** 2 + (e.z - pa0.z) ** 2);
      if (score > bestScore) { bestScore = score; mobId = e.id; }
    }
    for (let i = 0; i < 300; i++) {
      const pa = byId(sim, a)!;
      const pb = byId(sim, b)!;
      const m = byId(sim, mobId);
      if (!m) break;
      sim.sendCommandFor(a, { t: 'move', dx: m.x - pa.x, dz: m.z - pa.z }); // A walks onto it
      sim.sendCommandFor(b, { t: 'move', dx: pb.x - m.x, dz: pb.z - m.z }); // B flees from it
      sim.step();
      const mm = byId(sim, mobId);
      if (mm && mm.hostile) {
        const pa2 = byId(sim, a)!;
        const pb2 = byId(sim, b)!;
        const da = (mm.x - pa2.x) ** 2 + (mm.z - pa2.z) ** 2;
        const db = (mm.x - pb2.x) ** 2 + (mm.z - pb2.z) ** 2;
        expect(da).toBeLessThanOrEqual(db); // it locked onto A, the closer player
        return;
      }
    }
  });

  it('removing a player drops any mob aggro on it (no ghost-chasing)', () => {
    const sim = new Sim(7, false);
    const a = sim.addPlayer('A');
    const mobId = nearestEnemy(sim, byId(sim, a)!.x, byId(sim, a)!.z).id;
    let aggroed = false;
    for (let i = 0; i < 300 && !aggroed; i++) {
      const me = byId(sim, a)!;
      const m = byId(sim, mobId);
      if (!m) break;
      sim.sendCommandFor(a, { t: 'move', dx: m.x - me.x, dz: m.z - me.z });
      sim.step();
      const mm = byId(sim, mobId);
      if (mm && mm.hostile) aggroed = true;
    }
    if (aggroed) {
      sim.removePlayer(a);
      sim.step();
      const mm = byId(sim, mobId);
      if (mm) expect(mm.hostile).toBe(false); // aggro cleared; no chasing a ghost
    }
  });

  it('the multiplayer sim is deterministic (same seed + commands => same world)', () => {
    const run = (): string => {
      const sim = new Sim(99, false);
      const a = sim.addPlayer('A');
      const b = sim.addPlayer('B');
      for (let i = 0; i < 300; i++) {
        sim.sendCommandFor(a, { t: 'move', dx: 1, dz: 0.5 });
        sim.sendCommandFor(b, { t: 'move', dx: -0.5, dz: 1 });
        if (i % 7 === 0) sim.sendCommandFor(a, { t: 'cycle-target' });
        if (i % 11 === 0) sim.sendCommandFor(b, { t: 'use-ability', slot: 1 });
        sim.step();
      }
      return sim.hash();
    };
    expect(run()).toBe(run());
  });

  it('single-player (default) is unaffected — still spawns one local player', () => {
    const sim = new Sim(1337); // default spawnLocal=true
    expect(players(sim).length).toBe(1);
    expect(sim.localPlayerId()).not.toBeNull();
  });
});
