import { describe, it, expect } from 'vitest';
import {
  Sim,
  meleeDamage,
  abilityDamage,
  STR_TO_DAMAGE,
  RESPAWN_TICKS,
  EVENT_TTL_TICKS,
  GCD_TICKS,
  xpForLevel,
  HP_PER_LEVEL,
  MP_PER_LEVEL,
  ATTR_POINTS_PER_LEVEL,
  inFrontOf,
} from '../src/sim/sim';
import { ENEMY_COUNT, ENEMY_TEMPLATE } from '../src/sim/content/enemies';
import { CLASSES } from '../src/sim/content/classes';
import { ABILITIES } from '../src/sim/content/abilities';
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

describe('combat events (damage feedback)', () => {
  it('a swing emits a damage event the render can read, at the target position', () => {
    const sim = new Sim(7);
    expect(sim.recentEvents().length).toBe(0); // nothing has happened yet

    sim.sendCommand({ t: 'cycle-target' });
    sim.step();
    const tid = sim.localTargetId()!;

    // chase until the first swing lands and produces an event
    let guard = 0;
    while (sim.recentEvents().length === 0 && guard++ < 2000) chaseTarget(sim, tid);
    expect(guard).toBeLessThan(2000);

    const ev = sim.recentEvents()[0];
    expect(ev.kind).toBe('damage');
    expect(ev.targetId).toBe(tid);
    const cls = CLASSES[0];
    expect(ev.amount).toBe(meleeDamage(cls.baseStr, cls.weaponDamage));
    expect(ev.tick).toBe(sim.tick); // emitted on the current tick
    expect(ev.seq).toBeGreaterThan(0); // monotonic id for de-dup

    // position was captured from the (still-living) target on the hit tick
    const target = sim.entities().find((e) => e.id === tid)!;
    expect(ev.x).toBe(target.x);
    expect(ev.z).toBe(target.z);
  });

  it('a damage event survives exactly until its retention window expires', () => {
    const sim = new Sim(7);
    sim.sendCommand({ t: 'cycle-target' });
    sim.step();
    const tid = sim.localTargetId()!;

    let guard = 0;
    while (sim.recentEvents().length === 0 && guard++ < 2000) chaseTarget(sim, tid);
    expect(guard).toBeLessThan(2000); // reached melee and landed a hit
    const evTick = sim.recentEvents()[0].tick;

    // stop fighting so no further events are produced
    sim.sendCommand({ t: 'set-target', id: null });
    sim.sendCommand({ t: 'stop' });

    // Pin BOTH sides of the boundary: kept through evTick+TTL-1, dropped at +TTL.
    const hasEvent = (): boolean => sim.recentEvents().some((e) => e.tick === evTick);
    while (sim.tick < evTick + EVENT_TTL_TICKS - 1) sim.step();
    expect(hasEvent()).toBe(true); // still retained one tick before the cutoff
    sim.step(); // reaches evTick + EVENT_TTL_TICKS
    expect(hasEvent()).toBe(false); // pruned exactly at the window edge
  });
});

// Walk `sim`'s player into melee range of `tid` (within `range`), or give up
// after the guard. Returns the tick count used.
function chaseIntoRange(sim: Sim, tid: number, range: number): number {
  const dist = (): number => {
    const t = sim.entities().find((e) => e.id === tid);
    const p = sim.entities().find((e) => e.kind === 'player')!;
    return t ? Math.hypot(t.x - p.x, t.z - p.z) : Infinity;
  };
  let guard = 0;
  while (dist() > range && guard++ < 2000) chaseTarget(sim, tid);
  return guard;
}

describe('abilities (Golpe Forte, slot 1)', () => {
  const STRONG = ABILITIES.find((a) => a.slot === 1)!;
  const cls = CLASSES[0];
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;

  it('hits harder than an auto-attack', () => {
    expect(abilityDamage(STRONG, cls.baseStr, cls.weaponDamage)).toBeGreaterThan(
      meleeDamage(cls.baseStr, cls.weaponDamage),
    );
  });

  it('spends MP, lands the bigger hit, and puts the slot on cooldown', () => {
    const sim = new Sim(7);
    sim.sendCommand({ t: 'cycle-target' });
    sim.step();
    const tid = sim.localTargetId()!;
    expect(chaseIntoRange(sim, tid, 2.0)).toBeLessThan(2000);

    const mp0 = player(sim).mp;
    expect(sim.abilities()[0].ready).toBe(true); // castable before use

    sim.sendCommand({ t: 'use-ability', slot: 1 });
    sim.step();

    // MP dropped by exactly the cost (auto-attack never touches MP)
    expect(player(sim).mp).toBe(mp0 - STRONG.mpCost);
    // the ability hit landed: a damage event for its (bigger) amount was emitted.
    // Checking the event value — not the HP delta — is robust to overkill and to
    // a same-tick auto-attack (auto only ever deals meleeDamage, never this).
    const hit = abilityDamage(STRONG, cls.baseStr, cls.weaponDamage);
    expect(hit).toBeGreaterThan(meleeDamage(cls.baseStr, cls.weaponDamage));
    expect(sim.recentEvents().some((e) => e.amount === hit)).toBe(true);
    // slot is now on cooldown
    expect(sim.abilities()[0].ready).toBe(false);
    expect(sim.abilities()[0].cooldownRemaining).toBeGreaterThan(0);
  });

  it('re-use is blocked during the cooldown (spam prevention), then frees up when it elapses', () => {
    // NOTE: with a single ability whose own cooldown (6s) exceeds the 1.5s GCD,
    // re-use is gated by BOTH at once and the own cooldown dominates — so this
    // test cannot isolate the GCD from the own cooldown. The GCD's distinct
    // (cross-ability) role needs a second action-bar slot to test directly;
    // for now we verify the user-visible effect: you can't spam the button.
    const sim = new Sim(7);
    sim.sendCommand({ t: 'cycle-target' });
    sim.step();
    const tid = sim.localTargetId()!;
    expect(chaseIntoRange(sim, tid, 2.0)).toBeLessThan(2000);

    const mp0 = player(sim).mp;
    const before = sim.tick;
    sim.sendCommand({ t: 'use-ability', slot: 1 });
    sim.step();
    const useTick = before + 1;
    expect(player(sim).mp).toBe(mp0 - STRONG.mpCost);

    // immediate re-press is rejected (within the 1.5s GCD window): no extra MP
    sim.sendCommand({ t: 'use-ability', slot: 1 });
    sim.step();
    expect(player(sim).mp).toBe(mp0 - STRONG.mpCost);
    expect(GCD_TICKS).toBeGreaterThan(0); // sanity: a global cooldown is configured

    // still on its own (longer) cooldown even after the 1.5s GCD would elapse
    while (sim.tick < useTick + GCD_TICKS) sim.step();
    expect(sim.abilities()[0].ready).toBe(false);

    // ...and becomes ready again exactly when the own cooldown fully elapses
    const cdTicks = Math.round(STRONG.cooldownSecs * 20);
    while (sim.tick < useTick + cdTicks) sim.step();
    expect(sim.abilities()[0].ready).toBe(true);
  });

  it('a cast command stream is deterministic (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      sim.sendCommand({ t: 'cycle-target' });
      sim.step();
      const tid = sim.localTargetId();
      // press the ability every tick (the sim no-ops it when not castable) while
      // chasing the target, then idle — exercises useAbility under determinism.
      for (let i = 0; i < 400; i++) {
        sim.sendCommand({ t: 'use-ability', slot: 1 });
        chaseTarget(sim, tid);
      }
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });

  it('pressing the ability with no target spends nothing and emits no hit', () => {
    const sim = new Sim(7);
    const mp0 = player(sim).mp;
    expect(sim.localTargetId()).toBeNull();

    sim.sendCommand({ t: 'use-ability', slot: 1 });
    sim.step();

    expect(player(sim).mp).toBe(mp0); // no MP spent
    expect(sim.recentEvents().length).toBe(0); // no damage dealt
    expect(sim.abilities()[0].ready).toBe(true); // not on cooldown
  });

  it('pressing the ability out of melee range spends nothing', () => {
    const sim = new Sim(7);
    sim.sendCommand({ t: 'cycle-target' });
    sim.step();
    const tid = sim.localTargetId()!;
    const p = player(sim);
    const t = sim.entities().find((e) => e.id === tid)!;
    expect(Math.hypot(t.x - p.x, t.z - p.z)).toBeGreaterThan(2.5); // target is far (> MELEE_RANGE)

    const mp0 = p.mp;
    sim.sendCommand({ t: 'use-ability', slot: 1 });
    sim.step();
    expect(player(sim).mp).toBe(mp0); // blocked: out of range, no MP spent
  });
});

// Select the nearest enemy and beat it to death by chasing + auto-attacking.
// Returns true if the target actually died within the tick budget.
function killNearestEnemy(sim: Sim): boolean {
  sim.sendCommand({ t: 'cycle-target' });
  sim.step();
  const tid = sim.localTargetId();
  if (tid == null) return false;
  let guard = 0;
  while (sim.entities().some((e) => e.id === tid) && guard++ < 3000) chaseTarget(sim, tid);
  return guard < 3000;
}

describe('progression (XP & levels)', () => {
  it('the XP curve is gentle early and ramps up', () => {
    expect(xpForLevel(1)).toBe(50);
    expect(xpForLevel(2)).toBe(150);
    expect(xpForLevel(3)).toBeGreaterThan(xpForLevel(2)); // ramps with level
    // gentle start: level 2 costs no more than ~3 kills of a basic mob
    expect(xpForLevel(1)).toBeLessThanOrEqual(3 * ENEMY_TEMPLATE.xp);
  });

  it('killing mobs grants XP, crosses the threshold, and boosts max HP/MP + attr points', () => {
    const sim = new Sim(7);
    const p = (): { level: number; xp: number; maxHp: number; maxMp: number; hp: number; attrPoints: number } =>
      sim.entities().find((e) => e.kind === 'player')!;
    expect(p().level).toBe(1);
    const hp0 = p().maxHp;
    const mp0 = p().maxMp;

    // exactly enough kills to cross the level-1 threshold (50 XP / 25 = 2 wolves)
    const kills = Math.ceil(xpForLevel(1) / ENEMY_TEMPLATE.xp);
    for (let i = 0; i < kills; i++) expect(killNearestEnemy(sim)).toBe(true);

    const pp = p();
    expect(pp.level).toBe(2);
    expect(pp.maxHp).toBe(hp0 + HP_PER_LEVEL);
    expect(pp.maxMp).toBe(mp0 + MP_PER_LEVEL);
    expect(pp.attrPoints).toBe(ATTR_POINTS_PER_LEVEL);
    expect(pp.hp).toBe(pp.maxHp); // full restore on ding
    // and a level-up event was emitted for the visual feedback
    expect(sim.recentEvents().some((e) => e.kind === 'levelup' && e.amount === 2)).toBe(true);
  });
});

// Guard the load-bearing sim invariants that tsc alone won't catch: no
// non-deterministic clocks/RNG and no presentation-layer imports leaking into
// the deterministic core. Scans the source (comments stripped to avoid the
// invariant docs themselves tripping it).
describe('sim invariants (static guard)', () => {
  // Vite/Vitest inlines these raw sources at transform time — no node:fs needed.
  const sources = import.meta.glob('../src/sim/**/*.ts', {
    query: '?raw',
    import: 'default',
    eager: true,
  }) as Record<string, string>;

  const stripComments = (src: string): string =>
    src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

  it('src/sim has no Math.random/Date.now/performance.now and no render/ui/game/net/three imports', () => {
    const files = Object.keys(sources);
    expect(files.length).toBeGreaterThan(0);
    const forbidden = [/\bMath\.random\b/, /\bDate\.now\b/, /\bperformance\.now\b/];
    const forbiddenImport = /from\s+['"](three|\.\.\/(?:render|ui|game|net))/;
    for (const f of files) {
      const code = stripComments(sources[f]);
      for (const pat of forbidden) {
        expect(pat.test(code), `${f} must not use ${pat.source}`).toBe(false);
      }
      expect(forbiddenImport.test(code), `${f} must not import render/ui/game/net/three`).toBe(false);
    }
  });
});
