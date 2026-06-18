import { describe, it, expect } from 'vitest';
import { Sim, meleeDamage, STR_TO_DAMAGE, RESPAWN_TICKS, inFrontOf } from '../src/sim/sim';
import { ENEMY_COUNT, ENEMY_TEMPLATE } from '../src/sim/content/enemies';
import { CLASSES } from '../src/sim/content/classes';
import type { Command } from '../src/world_api';

// Run a FIXED, scripted command sequence against a fresh Sim and return the
// world fingerprint. This is how we prove the core invariant: determinism.
function run(seed: number): string {
  const sim = new Sim(seed);
  const script: Command[] = [
    { t: 'move', dx: 1, dz: 0 },
    { t: 'move', dx: 0, dz: 1 },
    { t: 'stop' },
    { t: 'move', dx: -1, dz: -1 },
  ];
  for (let i = 0; i < 600; i++) {
    sim.sendCommand(script[Math.floor(i / 150) % script.length]);
    sim.step();
  }
  return sim.hash();
}

describe('determinism', () => {
  it('same seed + same inputs => identical world', () => {
    expect(run(1337)).toBe(run(1337));
  });

  it('different seed => different world', () => {
    expect(run(1337)).not.toBe(run(9999));
  });

  // Targeting commands mutate sim state (player.targetId) and feed the hash,
  // so the determinism guarantee must cover them too.
  it('same seed + same targeting commands => identical world', () => {
    const runT = (seed: number): string => {
      const sim = new Sim(seed);
      const script: Command[] = [
        { t: 'cycle-target' },
        { t: 'move', dx: 1, dz: 0 },
        { t: 'cycle-target' },
        { t: 'stop' },
      ];
      for (let i = 0; i < 600; i++) {
        sim.sendCommand(script[Math.floor(i / 150) % script.length]);
        sim.step();
      }
      return sim.hash();
    };
    expect(runT(1337)).toBe(runT(1337));
  });
});

// Squared distance from the world origin (where the player spawns).
const d2 = (e: { x: number; z: number }): number => e.x * e.x + e.z * e.z;

describe('tab-target', () => {
  it('Tab selects the nearest enemy in front', () => {
    const sim = new Sim(7);
    const before = sim.entities();
    const player = before.find((e) => e.kind === 'player')!;
    // Player spawns at the origin facing +Z, so "in front" simply means z > 0.
    expect(player.x).toBe(0);
    expect(player.z).toBe(0);
    expect(player.facing).toBe(0);

    sim.sendCommand({ t: 'cycle-target' });
    sim.step();

    const target = before.find((e) => e.id === sim.localTargetId());
    expect(target).toBeDefined();
    expect(target!.kind).toBe('enemy');
    expect(target!.z).toBeGreaterThan(0); // the pick is in front

    // No other in-front enemy is strictly closer. This oracle is plain geometry
    // (z>0 + distance-from-origin), NOT the sim's selection formula, so a
    // regression in the front/nearest logic would actually fail this test.
    const inFront = before.filter((e) => e.kind === 'enemy' && e.z > 0);
    expect(inFront.length).toBeGreaterThan(0);
    for (const e of inFront) expect(d2(e)).toBeGreaterThanOrEqual(d2(target!));
  });

  it('repeated Tab cycles to a different enemy', () => {
    const before = new Sim(7).entities();
    const inFront = before.filter((e) => e.kind === 'enemy' && e.z > 0);

    // One Tab vs two Tabs in the SAME tick (identical positions): the second
    // press must advance past the first pick.
    const one = new Sim(7);
    one.sendCommand({ t: 'cycle-target' });
    one.step();
    const first = one.localTargetId();

    const two = new Sim(7);
    two.sendCommand({ t: 'cycle-target' });
    two.sendCommand({ t: 'cycle-target' });
    two.step();
    const second = two.localTargetId();

    expect(before.find((e) => e.id === first)!.kind).toBe('enemy');
    expect(before.find((e) => e.id === second)!.kind).toBe('enemy');
    if (inFront.length >= 2) expect(second).not.toBe(first);
  });

  it('clicking selects an enemy, ignores self, and null clears', () => {
    const sim = new Sim(3);
    const enemy = sim.entities().find((e) => e.kind === 'enemy')!;
    const playerId = sim.localPlayerId()!;

    sim.sendCommand({ t: 'set-target', id: enemy.id });
    sim.step();
    expect(sim.localTargetId()).toBe(enemy.id);

    // selecting the player (not an enemy) is ignored — target unchanged
    sim.sendCommand({ t: 'set-target', id: playerId });
    sim.step();
    expect(sim.localTargetId()).toBe(enemy.id);

    // an unknown id is ignored too
    sim.sendCommand({ t: 'set-target', id: 999999 });
    sim.step();
    expect(sim.localTargetId()).toBe(enemy.id);

    // null clears the selection
    sim.sendCommand({ t: 'set-target', id: null });
    sim.step();
    expect(sim.localTargetId()).toBeNull();
  });
});

// Drive `sim`'s player one tick toward its current target (id `tid`). Mirrors
// what a human (or the HUD-driven input) does: walk into melee range.
function chaseTarget(sim: Sim, tid: number | null): void {
  const t = sim.entities().find((e) => e.id === tid);
  const p = sim.entities().find((e) => e.kind === 'player')!;
  sim.sendCommand(t ? { t: 'move', dx: t.x - p.x, dz: t.z - p.z } : { t: 'stop' });
  sim.step();
}

describe('combat', () => {
  it('melee damage = weapon + floor(str * STR_TO_DAMAGE)', () => {
    expect(meleeDamage(20, 6)).toBe(6 + Math.floor(20 * STR_TO_DAMAGE)); // warrior defaults
    expect(meleeDamage(0, 0)).toBe(0);
    expect(meleeDamage(7, 3)).toBe(3 + Math.floor(7 * STR_TO_DAMAGE));
    // damage rises with both inputs
    expect(meleeDamage(40, 6)).toBeGreaterThan(meleeDamage(20, 6));
    expect(meleeDamage(20, 12)).toBeGreaterThan(meleeDamage(20, 6));
  });

  it('inFrontOf: only the forward half-plane counts as "in front"', () => {
    // facing 0 => forward is +Z
    expect(inFrontOf(0, 1, 0)).toBe(true); // ahead
    expect(inFrontOf(0, -1, 0)).toBe(false); // behind
    expect(inFrontOf(1, 0, 0)).toBe(false); // 90° to the side is not "in front"
    // facing +X (Math.PI/2) => forward is +X
    expect(inFrontOf(1, 0, Math.PI / 2)).toBe(true);
    expect(inFrontOf(-1, 0, Math.PI / 2)).toBe(false);
  });

  it('damage lands once per swing (timer-gated), and the HP the HUD reads drops by meleeDamage', () => {
    const sim = new Sim(7);
    sim.sendCommand({ t: 'cycle-target' });
    sim.step();
    const tid = sim.localTargetId()!;
    const hp = (): number | undefined => sim.entities().find((e) => e.id === tid)?.hp;
    const full = hp()!;
    expect(full).toBeGreaterThan(0);

    // close in until the first swing lands
    let guard = 0;
    while (hp() === full && guard++ < 2000) chaseTarget(sim, tid);
    expect(guard).toBeLessThan(2000);

    // exactly one swing's worth of damage (proves discrete swings, not per-tick)
    const cls = CLASSES[0];
    const swing = meleeDamage(cls.baseStr, cls.weaponDamage);
    const afterFirst = hp()!;
    expect(afterFirst).toBe(full - swing);

    // the swing timer must gate the next hit: HP stays flat well within one
    // swing window (~40 ticks). A per-tick or one-shot model would fail this.
    for (let i = 0; i < 30; i++) {
      chaseTarget(sim, tid);
      expect(hp()).toBe(afterFirst);
    }
  });

  it('attacks until the target dies, clears the selection, then a same-type enemy respawns ~15s later', () => {
    const sim = new Sim(7);
    const enemyCount = (): number => sim.entities().filter((e) => e.kind === 'enemy').length;
    expect(enemyCount()).toBe(ENEMY_COUNT);

    sim.sendCommand({ t: 'cycle-target' });
    sim.step();
    const tid = sim.localTargetId();
    expect(tid).not.toBeNull();

    const alive = (): boolean => sim.entities().some((e) => e.id === tid);
    let ticks = 0;
    while (alive() && ticks < 2000) {
      chaseTarget(sim, tid);
      ticks++;
    }
    expect(ticks).toBeLessThan(2000); // it actually died (didn't time out)
    expect(sim.localTargetId()).toBeNull(); // dead target clears the selection
    expect(enemyCount()).toBe(ENEMY_COUNT - 1);

    // Pin the ~15s delay: still one short right up to the respawn tick, then back.
    const deathTick = sim.tick;
    sim.sendCommand({ t: 'stop' });
    while (sim.tick < deathTick + RESPAWN_TICKS - 1) sim.step();
    expect(enemyCount()).toBe(ENEMY_COUNT - 1); // not yet
    sim.step(); // reaches deathTick + RESPAWN_TICKS
    expect(enemyCount()).toBe(ENEMY_COUNT); // respawned
    // ...and it is the same type (only one template today).
    const names = sim.entities().filter((e) => e.kind === 'enemy').map((e) => e.name);
    expect(names.every((n) => n === ENEMY_TEMPLATE.name)).toBe(true);
  });

  it('the kill + rng-respawn path is deterministic (same seed => identical hash)', () => {
    const runKill = (seed: number): string => {
      const sim = new Sim(seed);
      sim.sendCommand({ t: 'cycle-target' });
      sim.step();
      const tid = sim.localTargetId();
      for (let i = 0; i < 800; i++) chaseTarget(sim, tid); // chase + kill
      for (let i = 0; i <= RESPAWN_TICKS; i++) sim.step(); // idle through the respawn
      return sim.hash();
    };
    expect(runKill(7)).toBe(runKill(7));
    expect(runKill(7)).not.toBe(runKill(123));
  });
});
