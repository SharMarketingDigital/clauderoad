import { describe, it, expect } from 'vitest';
import {
  Sim,
  meleeDamage,
  abilityDamage,
  rollRarity,
  rarityStat,
  enhanceChance,
  enhanceStat,
  STR_TO_DAMAGE,
  RESPAWN_TICKS,
  EVENT_TTL_TICKS,
  GCD_TICKS,
  POTION_COOLDOWN_TICKS,
  DEATH_RESPAWN_TICKS,
  xpForLevel,
  HP_PER_LEVEL,
  MP_PER_LEVEL,
  ATTR_POINTS_PER_LEVEL,
  ATTR_STR_PER_POINT,
  MP_PER_INT,
  inFrontOf,
} from '../src/sim/sim';
import { Rng } from '../src/sim/rng';
import { ENEMY_COUNT, ENEMY_TEMPLATE } from '../src/sim/content/enemies';
import { CLASSES } from '../src/sim/content/classes';
import { ABILITIES } from '../src/sim/content/abilities';
import { addToBag, BAG_SLOTS } from '../src/sim/inventory';
import { ITEMS } from '../src/sim/content/items';
import { MAX_PLUS } from '../src/sim/content/enhance';
import { RARITIES } from '../src/sim/content/rarity';
import {
  BOSS_TEMPLATE,
  BOSS_RARITIES,
  BOSS_FIRST_SPAWN_TICK,
  BOSS_RESPAWN_TICKS,
} from '../src/sim/content/bosses';
import type { Command } from '../src/world_api';
import type { ItemStack } from '../src/sim/types';

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
    // common-mob count only (the world boss is also kind 'enemy' but respawns on
    // its own timer, so it must not count toward the wolf-respawn check)
    const enemyCount = (): number =>
      sim.entities().filter((e) => e.kind === 'enemy' && !e.boss).length;
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
    // ...and the respawned common mobs are the same type (boss excluded).
    const names = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss).map((e) => e.name);
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

// Kill the nearest COMMON enemy (never the world boss) by chasing + attacking.
// Targets a specific wolf by id (not cycle-target) so grind helpers stay
// isolated from the boss regardless of its spawn timer. Returns true if it died.
function killNearestEnemy(sim: Sim): boolean {
  const playerOf = () => sim.entities().find((e) => e.kind === 'player')!;
  const gold0 = playerOf().gold;
  // Re-acquire the nearest living wolf each tick and chase it. Robust to the
  // player dying and respawning mid-grind (it just re-targets the nearest wolf
  // near the safe point). A kill is detected by gold strictly rising — every
  // kill drops gold — which works regardless of WHICH wolf died.
  for (let guard = 0; guard < 6000; guard++) {
    if (playerOf().gold > gold0) return true;
    const me = playerOf();
    const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss && e.hp > 0);
    if (wolves.length === 0) {
      sim.step();
      continue;
    }
    wolves.sort(
      (a, b) => (a.x - me.x) ** 2 + (a.z - me.z) ** 2 - ((b.x - me.x) ** 2 + (b.z - me.z) ** 2),
    );
    const w = wolves[0];
    sim.sendCommand({ t: 'set-target', id: w.id });
    sim.sendCommand({ t: 'move', dx: w.x - me.x, dz: w.z - me.z });
    sim.step();
  }
  return playerOf().gold > gold0;
}

// Run the player toward the nearest wolf until one aggros (hostile); returns
// that wolf's id, or null if none aggroed within the cap.
function approachUntilAggro(sim: Sim): number | null {
  for (let i = 0; i < 2000; i++) {
    const hostile = sim.entities().find((e) => e.kind === 'enemy' && !e.boss && e.hostile);
    if (hostile) return hostile.id;
    const p = sim.entities().find((e) => e.kind === 'player')!;
    const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss);
    if (wolves.length === 0) return null;
    wolves.sort((a, b) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
    const w = wolves[0];
    sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
    sim.step();
  }
  return null;
}

// Run the player away from the nearest enemy until everything is well clear of
// aggro range, so the next few steps are combat-free. The player (speed 6)
// outruns wolves (2.4), which then leash. Deterministic; bounded.
function fleeToSafety(sim: Sim): void {
  for (let i = 0; i < 3000; i++) {
    const p = sim.entities().find((e) => e.kind === 'player')!;
    const enemies = sim.entities().filter((e) => e.kind === 'enemy');
    if (enemies.length === 0) break;
    let nearest = enemies[0];
    let nd = Infinity;
    for (const e of enemies) {
      const d = Math.hypot(e.x - p.x, e.z - p.z);
      if (d < nd) { nd = d; nearest = e; }
    }
    if (nd > 20) break;
    sim.sendCommand({ t: 'move', dx: p.x - nearest.x, dz: p.z - nearest.z });
    sim.step();
  }
  sim.sendCommand({ t: 'stop' });
}

// Advance one tick while keeping the player out of harm's way: stride away from
// the nearest enemy if it's getting close, else hold still. Lets time-based
// tests (cooldowns) run without stray wolf damage skewing HP.
function safeStep(sim: Sim): void {
  const p = sim.entities().find((e) => e.kind === 'player')!;
  const enemies = sim.entities().filter((e) => e.kind === 'enemy');
  let nearest = enemies[0];
  let nd = Infinity;
  for (const e of enemies) {
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d < nd) { nd = d; nearest = e; }
  }
  if (nearest && nd < 14) sim.sendCommand({ t: 'move', dx: p.x - nearest.x, dz: p.z - nearest.z });
  else sim.sendCommand({ t: 'stop' });
  sim.step();
}

// Top the player up to full HP in safety: flee clear, drink a potion, wait the
// cooldown, repeat. Combat during item grinds leaves the player hurt; this
// resets to a known full-HP baseline (needs a few potions in the bag).
function restoreToFull(sim: Sim): void {
  const p = (): EntityViewHp => sim.entities().find((e) => e.kind === 'player')!;
  for (let i = 0; i < 20; i++) {
    fleeToSafety(sim);
    if (p().hp >= p().maxHp) return; // full AND just fled clear
    sim.sendCommand({ t: 'use-item', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    sim.step();
    for (let j = 0; j <= POTION_COOLDOWN_TICKS; j++) safeStep(sim); // wait, taking no damage
  }
}

type EntityViewHp = { hp: number; maxHp: number };

// Cast the action-bar ability once at a wolf so MP drops strictly below max (so an
// MP top-up/restore becomes observable), then drop the target. The post-level-up
// kill is below the next level threshold, so no ding refills MP.
function drainSomeMp(sim: Sim): void {
  const playerOf = () => sim.entities().find((e) => e.kind === 'player')!;
  for (let i = 0; i < 1500 && playerOf().mp >= playerOf().maxMp; i++) {
    const p = playerOf();
    const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss && e.hp > 0);
    if (wolves.length === 0) break;
    wolves.sort((a, b) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
    const w = wolves[0];
    sim.sendCommand({ t: 'set-target', id: w.id });
    const d = Math.hypot(w.x - p.x, w.z - p.z);
    sim.sendCommand(d > 2.0 ? { t: 'move', dx: w.x - p.x, dz: w.z - p.z } : { t: 'stop' });
    sim.sendCommand({ t: 'use-ability', slot: 1 });
    sim.step();
  }
  sim.sendCommand({ t: 'set-target', id: null });
  sim.step();
}

describe('enemy AI (aggro / chase / leash)', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;

  it('a wolf in range aggros, chases, and bites the player for its melee damage', () => {
    const sim = new Sim(7);
    const pid = sim.localPlayerId();
    const wolfBite = meleeDamage(ENEMY_TEMPLATE.str, ENEMY_TEMPLATE.weaponDamage);
    const hp0 = player(sim).hp; // starts at full
    expect(hp0).toBe(player(sim).maxHp);
    expect(approachUntilAggro(sim)).not.toBeNull();
    sim.sendCommand({ t: 'stop' }); // stand still; the aggroed wolf closes in and bites
    let bit = false;
    let guard = 0;
    while (!bit && guard++ < 1000) {
      sim.step();
      bit = sim
        .recentEvents()
        .some((ev) => ev.kind === 'damage' && ev.targetId === pid && ev.amount === wolfBite);
    }
    expect(bit).toBe(true); // a wolf bite (exactly its melee damage) landed on us
    expect(player(sim).hp).toBeLessThan(hp0); // ...and our HP dropped
  });

  it('leashes: the chasing wolf gives up once the player flees beyond its leash range', () => {
    const sim = new Sim(7);
    const w0 = approachUntilAggro(sim);
    expect(w0).not.toBeNull();
    expect(sim.entities().find((e) => e.id === w0)!.hostile).toBe(true);
    fleeToSafety(sim); // outrun it into the open field
    for (let i = 0; i < 200; i++) sim.step(); // let it leash + amble home
    const w = sim.entities().find((e) => e.id === w0);
    expect(w && w.hostile).toBe(false); // de-aggroed (leashed)
  });

  it('the world boss hits much harder than a common wolf', () => {
    const wolfBite = meleeDamage(ENEMY_TEMPLATE.str, ENEMY_TEMPLATE.weaponDamage);
    const bossBite = meleeDamage(BOSS_TEMPLATE.str, BOSS_TEMPLATE.weaponDamage);
    expect(bossBite).toBeGreaterThan(wolfBite);
    expect(bossBite).toBeGreaterThanOrEqual(wolfBite * 3); // "bate mais forte" — provisional
  });

  it('the rooted boss bites the player in melee for its (heavier) damage', () => {
    const sim = new Sim(7);
    const pid = sim.localPlayerId();
    const bossBite = meleeDamage(BOSS_TEMPLATE.str, BOSS_TEMPLATE.weaponDamage);
    // wait out the boss timer, staying alive (kite wolves) so the boss can aggro us
    let g = 0;
    while (!sim.entities().some((e) => e.boss) && g++ < 6000) safeStep(sim);
    expect(sim.entities().some((e) => e.boss)).toBe(true);
    // walk into the boss's melee and hold; a boss-sized bite must land on the player
    let bit = false;
    let g2 = 0;
    while (!bit && g2++ < 3000) {
      const p = player(sim);
      const b = sim.entities().find((e) => e.boss);
      if (!b) break;
      const d = Math.hypot(b.x - p.x, b.z - p.z);
      sim.sendCommand(d > 1.5 ? { t: 'move', dx: b.x - p.x, dz: b.z - p.z } : { t: 'stop' });
      sim.step();
      bit = sim
        .recentEvents()
        .some((ev) => ev.kind === 'damage' && ev.targetId === pid && ev.amount === bossBite);
    }
    expect(bit).toBe(true); // the rooted boss bit the player for its heavy melee damage
  });

  it('enemy AI is deterministic (same seed => identical hash after a chase)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      expect(approachUntilAggro(sim)).not.toBeNull(); // ensure the aggro/chase path actually ran
      for (let i = 0; i < 120; i++) sim.step();
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

// Walk the player into the nearest wolves WITHOUT attacking and let them bring
// the player down to 0 HP (death). Deterministic; bounded.
function driveIntoWolvesUntilDead(sim: Sim): void {
  const playerOf = () => sim.entities().find((e) => e.kind === 'player')!;
  let g = 0;
  while (playerOf().hp > 0 && g++ < 5000) {
    const p = playerOf();
    const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss);
    if (wolves.length) {
      wolves.sort(
        (a, b) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2),
      );
      const w = wolves[0];
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      sim.sendCommand(d > 1.5 ? { t: 'move', dx: w.x - p.x, dz: w.z - p.z } : { t: 'stop' });
    }
    sim.step();
  }
}

describe('player death & respawn', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;

  it('HP 0 -> spirit -> respawn at the safe point with HP/MP restored', () => {
    const sim = new Sim(7);
    const pid = sim.localPlayerId();

    // spend some MP first, so "MP restored" is observable (not vacuous): cast at a
    // wolf until MP drops. The first kill is below the level-up XP, so no ding
    // refills MP; then drop the target so we stop fighting.
    let casted = false;
    for (let i = 0; i < 1500 && !casted; i++) {
      const p = player(sim);
      const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss && e.hp > 0);
      if (wolves.length === 0) break;
      wolves.sort((a, b) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
      const w = wolves[0];
      sim.sendCommand({ t: 'set-target', id: w.id });
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      sim.sendCommand(d > 2.0 ? { t: 'move', dx: w.x - p.x, dz: w.z - p.z } : { t: 'stop' });
      sim.sendCommand({ t: 'use-ability', slot: 1 });
      sim.step();
      casted = player(sim).mp < player(sim).maxMp;
    }
    expect(casted).toBe(true);
    sim.sendCommand({ t: 'set-target', id: null });
    sim.step();
    expect(player(sim).mp).toBeLessThan(player(sim).maxMp); // MP strictly below max going into death

    driveIntoWolvesUntilDead(sim);

    // down: HP floored at 0, flagged a spirit, and a death announcement fired
    expect(player(sim).hp).toBe(0);
    expect(player(sim).dead).toBe(true);
    expect(sim.recentEvents().some((e) => e.kind === 'death' && e.targetId === pid)).toBe(true);

    // a spirit can't act: a move command is ignored (stays frozen at the death spot)
    const x0 = player(sim).x;
    const z0 = player(sim).z;
    sim.sendCommand({ t: 'move', dx: 1, dz: 0 });
    sim.step();
    expect(player(sim).x).toBe(x0);
    expect(player(sim).z).toBe(z0);

    // wait out the respawn delay -> revive at the safe point with HP/MP restored
    let g = 0;
    while (player(sim).dead && g++ < 1000) sim.step();
    const p = player(sim);
    expect(p.dead).toBe(false);
    expect(p.hp).toBe(p.maxHp); // HP restored
    expect(p.mp).toBe(p.maxMp); // MP restored
    expect(Math.hypot(p.x, p.z)).toBeLessThan(0.001); // back at the safe point (0,0)
    expect(sim.recentEvents().some((e) => e.kind === 'respawn' && e.targetId === pid)).toBe(true);
  });

  it('respects the respawn delay (still a spirit one tick before, alive on it)', () => {
    const sim = new Sim(7);
    driveIntoWolvesUntilDead(sim);
    const deathTick = sim.tick;
    sim.sendCommand({ t: 'stop' });
    while (sim.tick < deathTick + DEATH_RESPAWN_TICKS - 1) sim.step();
    expect(player(sim).dead).toBe(true); // still down one tick before the deadline
    sim.step();
    expect(player(sim).dead).toBe(false); // revived exactly on schedule
  });

  it('the spirit state is part of the deterministic fingerprint (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      driveIntoWolvesUntilDead(sim); // hash WHILE a spirit, so the nonzero deadUntil is fingerprinted
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

describe('attribute points', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;

  it('spending a Força point raises Strength and melee damage; consumes one point', () => {
    const sim = new Sim(7);
    while (player(sim).attrPoints < 1) killNearestEnemy(sim); // level up to earn points
    fleeToSafety(sim); // de-aggro so the spend step takes no stray wolf damage
    const before = player(sim);
    const dmgBefore = meleeDamage(before.str, before.weaponDamage);
    const ptsBefore = before.attrPoints;
    const strBefore = before.str;
    const intBefore = before.int;
    const maxMpBefore = before.maxMp;
    const hpBefore = before.hp;
    sim.sendCommand({ t: 'spend-attr', attr: 'str' });
    sim.step();
    const after = player(sim);
    expect(after.attrPoints).toBe(ptsBefore - 1); // one point spent
    expect(after.str).toBe(strBefore + ATTR_STR_PER_POINT); // Strength rose
    expect(meleeDamage(after.str, after.weaponDamage)).toBe(dmgBefore + 1); // a clean, exact +1 damage
    expect(after.int).toBe(intBefore); // didn't leak into Intelligence...
    expect(after.maxMp).toBe(maxMpBefore); // ...or MP
    expect(after.hp).toBe(hpBefore); // and did NOT wrongly heal/change HP
  });

  it('spending an Inteligência point raises Intelligence, max MP, and tops up current MP', () => {
    const sim = new Sim(7);
    while (player(sim).attrPoints < 1) killNearestEnemy(sim);
    drainSomeMp(sim); // cast so MP is strictly below max -> the top-up is observable
    fleeToSafety(sim); // de-aggro so the spend step is clean
    const before = player(sim);
    const maxMpBefore = before.maxMp;
    const mpBefore = before.mp;
    const intBefore = before.int;
    const ptsBefore = before.attrPoints;
    const strBefore = before.str;
    const hpBefore = before.hp;
    expect(mpBefore).toBeLessThan(maxMpBefore); // MP was actually drained
    sim.sendCommand({ t: 'spend-attr', attr: 'int' });
    sim.step();
    const after = player(sim);
    expect(after.attrPoints).toBe(ptsBefore - 1);
    expect(after.int).toBe(intBefore + 1);
    expect(after.maxMp).toBe(maxMpBefore + MP_PER_INT); // Intelligence adds max MP...
    expect(after.mp).toBe(Math.min(after.maxMp, mpBefore + MP_PER_INT)); // ...and tops up current MP
    expect(after.str).toBe(strBefore); // int point left Strength alone
    expect(after.hp).toBe(hpBefore); // and did NOT wrongly heal/change HP
  });

  it('cannot spend a point when none are available', () => {
    const sim = new Sim(7);
    expect(player(sim).attrPoints).toBe(0); // fresh: level 1, no points yet
    const strBefore = player(sim).str;
    sim.sendCommand({ t: 'spend-attr', attr: 'str' });
    sim.step();
    expect(player(sim).attrPoints).toBe(0); // nothing spent
    expect(player(sim).str).toBe(strBefore); // and no stat change
  });

  it('spending attribute points is part of the deterministic fingerprint', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      while (player(sim).attrPoints < 3) killNearestEnemy(sim);
      sim.sendCommand({ t: 'spend-attr', attr: 'str' });
      sim.step();
      sim.sendCommand({ t: 'spend-attr', attr: 'int' });
      sim.step();
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

describe('progression (XP & levels)', () => {
  it('the XP curve is gentle early and ramps up', () => {
    // pin the exact shape (25·L·(L+1)) at several points, not just L1/L2, so a
    // differently-shaped curve that happens to match early is still caught
    expect(xpForLevel(1)).toBe(50);
    expect(xpForLevel(2)).toBe(150);
    expect(xpForLevel(3)).toBe(300);
    expect(xpForLevel(4)).toBe(500);
    expect(xpForLevel(3)).toBeGreaterThan(xpForLevel(2)); // ramps with level
    // gentle start: level 2 costs no more than ~3 kills of a basic mob
    expect(xpForLevel(1)).toBeLessThanOrEqual(3 * ENEMY_TEMPLATE.xp);
  });

  it('killing mobs grants XP, crosses the threshold, and boosts max HP/MP + attr points', () => {
    const sim = new Sim(7);
    const player = () => sim.entities().find((e) => e.kind === 'player')!;
    expect(player().level).toBe(1);
    const hp0 = player().maxHp;
    const mp0 = player().maxMp;

    // exactly enough kills to cross the level-1 threshold (50 XP / 25 = 2 wolves)
    const kills = Math.ceil(xpForLevel(1) / ENEMY_TEMPLATE.xp);
    for (let i = 0; i < kills; i++) expect(killNearestEnemy(sim)).toBe(true);

    const pp = player();
    expect(pp.level).toBe(2);
    expect(pp.maxHp).toBe(hp0 + HP_PER_LEVEL);
    expect(pp.maxMp).toBe(mp0 + MP_PER_LEVEL);
    expect(pp.attrPoints).toBe(ATTR_POINTS_PER_LEVEL);
    expect(pp.hp).toBe(pp.maxHp); // full restore on ding...
    expect(pp.mp).toBe(pp.maxMp); // ...for MP too
    expect(pp.xp).toBe(0); // landed exactly on the threshold
    expect(pp.xpToNext).toBe(xpForLevel(2)); // bar now tracks the next level
    // and a level-up event was emitted for the visual feedback
    expect(sim.recentEvents().some((e) => e.kind === 'levelup' && e.amount === 2)).toBe(true);

    // one more kill: XP accumulates again toward level 3 (the HUD bar refills)
    expect(killNearestEnemy(sim)).toBe(true);
    const after = player();
    expect(after.level).toBe(2);
    expect(after.xp).toBe(ENEMY_TEMPLATE.xp); // 25 progress into level 2
    expect(after.xpToNext).toBe(xpForLevel(2)); // still 150 to reach level 3
  });

  it('the level-up path is deterministic (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      const kills = Math.ceil(xpForLevel(1) / ENEMY_TEMPLATE.xp); // crosses level 1->2
      for (let i = 0; i < kills; i++) killNearestEnemy(sim);
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

describe('loot & inventory', () => {
  it('addToBag stacks by item+rarity+plus, fills slots, and rejects new stacks when full', () => {
    const bag: ItemStack[] = [];
    // fill every slot with a distinct stack
    for (let i = 0; i < BAG_SLOTS; i++) expect(addToBag(bag, `item_${i}`, 'normal', 0, 1)).toBe(true);
    expect(bag.length).toBe(BAG_SLOTS);
    // full: a NEW item type has no slot
    expect(addToBag(bag, 'overflow', 'normal', 0, 1)).toBe(false);
    expect(bag.length).toBe(BAG_SLOTS);
    // ...but more of an EXISTING stack still fits (stacks in place, no new slot)
    expect(addToBag(bag, 'item_0', 'normal', 0, 4)).toBe(true);
    expect(bag.find((s) => s.itemId === 'item_0' && s.rarity === 'normal')!.qty).toBe(5);

    // same item but a different rarity OR a different "+N" = a SEPARATE stack
    const bag2: ItemStack[] = [];
    expect(addToBag(bag2, 'sword', 'normal', 0, 1)).toBe(true);
    expect(addToBag(bag2, 'sword', 'sun', 0, 1)).toBe(true); // different rarity
    expect(addToBag(bag2, 'sword', 'normal', 3, 1)).toBe(true); // different "+N"
    expect(bag2.length).toBe(3);
  });

  it('a kill always drops gold, items come from the drop table with resolved names, reproducibly', () => {
    const lootAfter = (seed: number, kills: number): { gold: number; inv: ReturnType<Sim['inventory']> } => {
      const sim = new Sim(seed);
      for (let i = 0; i < kills; i++) killNearestEnemy(sim);
      const gold = sim.entities().find((e) => e.kind === 'player')!.gold;
      return { gold, inv: sim.inventory() };
    };

    // one kill -> always some gold, within the template's range
    const one = lootAfter(7, 1);
    expect(one.gold).toBeGreaterThanOrEqual(ENEMY_TEMPLATE.goldMin);
    expect(one.gold).toBeLessThanOrEqual(ENEMY_TEMPLATE.goldMax);
    expect(one.inv.capacity).toBe(BAG_SLOTS); // the view reports the slot count

    // over a dozen kills: at least one item, every stack a VALID drop-table item
    // with its display name resolved from ITEMS (exactly what the HUD renders)
    const many = lootAfter(7, 12);
    expect(many.inv.stacks.length).toBeGreaterThan(0);
    const dropIds = ENEMY_TEMPLATE.drops.map((d) => d.itemId);
    for (const s of many.inv.stacks) {
      expect(dropIds).toContain(s.itemId);
      expect(s.qty).toBeGreaterThan(0);
      expect(s.name).toBe(ITEMS[s.itemId].name);
      expect(['normal', 'sos', 'som', 'sun']).toContain(s.rarity); // a valid rarity
      expect(s.rarityName.length).toBeGreaterThan(0);
      expect(s.plus).toBe(0); // loot drops un-enhanced
    }

    // reproducible: same seed + same kills => identical gold AND bag contents
    expect(lootAfter(7, 12)).toEqual(many);
  });

  it('loot is part of the deterministic fingerprint (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      for (let i = 0; i < 4; i++) killNearestEnemy(sim); // earns gold + items
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

// Kill mobs until `itemId` lands in the bag (deterministic for a fixed seed;
// `cap` is just a safety net). Returns whether it was obtained.
function killUntilBagHas(sim: Sim, itemId: string, cap: number): boolean {
  for (let i = 0; i < cap; i++) {
    if (sim.inventory().stacks.some((s) => s.itemId === itemId)) return true;
    killNearestEnemy(sim);
  }
  return sim.inventory().stacks.some((s) => s.itemId === itemId);
}

describe('equipment', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const weaponItem = (sim: Sim) => sim.inventory().equipment.find((e) => e.slot === 'weapon')!.itemId;

  it('equipping the Espada Velha raises attack damage; unequipping lowers it and returns it', () => {
    const sim = new Sim(7);
    const dmg = () => meleeDamage(player(sim).str, player(sim).weaponDamage); // per-swing damage
    // Grind for the sword (5% per kill; fixed seed -> deterministic, lands fast).
    expect(killUntilBagHas(sim, 'old_sword', 400)).toBe(true);
    const sword = sim.inventory().stacks.find((s) => s.itemId === 'old_sword')!;
    const before = dmg();

    // Equip that exact (item, rarity, +N): into the weapon slot, out of the bag, damage up.
    sim.sendCommand({ t: 'equip', itemId: 'old_sword', rarity: sword.rarity, plus: sword.plus });
    sim.step();
    expect(weaponItem(sim)).toBe('old_sword');
    expect(sim.inventory().stacks.some((s) => s.itemId === 'old_sword')).toBe(false);
    expect(dmg()).toBeGreaterThan(before);

    // Unequip: back to the bag, damage drops to exactly the pre-equip value.
    sim.sendCommand({ t: 'unequip', slot: 'weapon' });
    sim.step();
    expect(weaponItem(sim)).toBeNull();
    expect(sim.inventory().stacks.some((s) => s.itemId === 'old_sword')).toBe(true);
    expect(dmg()).toBe(before);
  });

  it('equipping armor raises max HP by the rarity-scaled bonus; unequipping returns it', () => {
    const sim = new Sim(7);
    expect(killUntilBagHas(sim, 'wolf_leather', 400)).toBe(true);
    const leather = sim.inventory().stacks.find((s) => s.itemId === 'wolf_leather')!;
    const baseBonus = ITEMS.wolf_leather.stats?.maxHp ?? 0;
    expect(baseBonus).toBeGreaterThan(0);
    const expectedBonus = rarityStat(baseBonus, leather.rarity); // scaled by its rarity
    const maxBefore = player(sim).maxHp;

    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: leather.rarity, plus: leather.plus });
    sim.step();
    expect(sim.inventory().equipment.find((e) => e.slot === 'armor')!.itemId).toBe('wolf_leather');
    expect(player(sim).maxHp).toBe(maxBefore + expectedBonus);
    expect(player(sim).hp).toBeLessThanOrEqual(player(sim).maxHp);

    sim.sendCommand({ t: 'unequip', slot: 'armor' });
    sim.step();
    expect(player(sim).maxHp).toBe(maxBefore);
    expect(player(sim).hp).toBeLessThanOrEqual(player(sim).maxHp); // clamp invariant holds
    expect(sim.inventory().stacks.some((s) => s.itemId === 'wolf_leather')).toBe(true);
  });

  it('equip/unequip no-op safely: non-equippable, not held, and empty slot', () => {
    const sim = new Sim(7);
    // a non-equippable item (no slot) is ignored
    sim.sendCommand({ t: 'equip', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    sim.step();
    expect(weaponItem(sim)).toBeNull();
    // an equippable item the player does NOT hold is ignored (no phantom equip)
    sim.sendCommand({ t: 'equip', itemId: 'old_sword', rarity: 'normal', plus: 0 });
    sim.step();
    expect(weaponItem(sim)).toBeNull();
    expect(sim.inventory().stacks.some((s) => s.itemId === 'old_sword')).toBe(false);
    // unequipping an empty slot does nothing
    sim.sendCommand({ t: 'unequip', slot: 'weapon' });
    sim.step();
    expect(weaponItem(sim)).toBeNull();
  });

  it('equipping is part of the deterministic fingerprint (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      if (killUntilBagHas(sim, 'old_sword', 400)) {
        const s = sim.inventory().stacks.find((x) => x.itemId === 'old_sword')!;
        sim.sendCommand({ t: 'equip', itemId: 'old_sword', rarity: s.rarity, plus: s.plus });
        sim.step();
      }
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

// Kill mobs until `itemId` lands in the bag at a specific rarity (deterministic
// for a fixed seed; `cap` is a safety net). Used when a test needs a KNOWN stat
// bonus (e.g. a Normal leather's small, predictable +maxHp).
function killUntilBagHasRarity(sim: Sim, itemId: string, rarity: string, cap: number): boolean {
  const has = (): boolean =>
    sim.inventory().stacks.some((s) => s.itemId === itemId && s.rarity === rarity);
  for (let i = 0; i < cap && !has(); i++) killNearestEnemy(sim);
  return has();
}

describe('consumables', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const potionQty = (sim: Sim): number =>
    sim
      .inventory()
      .stacks.filter((s) => s.itemId === 'health_potion')
      .reduce((n, s) => n + s.qty, 0);

  // The player can't take damage yet, so to get HP below max we equip a Normal
  // wolf_leather: equipping lifts maxHp but never tops current HP up, opening a
  // small, KNOWN gap (Normal's +maxHp < the potion's heal) to heal into. Also
  // grinds a Health Potion and stops the player fighting, so no stray kill/level
  // refills HP mid-test.
  function setupHealGap(sim: Sim): void {
    expect(killUntilBagHas(sim, 'health_potion', 800)).toBe(true);
    expect(killUntilBagHasRarity(sim, 'wolf_leather', 'normal', 800)).toBe(true);
    fleeToSafety(sim); // de-aggro so HP stays stable through the test's steps
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: 'normal', plus: 0 });
    sim.step();
  }

  it('using a Health Potion heals HP (clamped to the max) and consumes one from the stack', () => {
    const sim = new Sim(7);
    expect(killUntilBagHas(sim, 'health_potion', 800)).toBe(true);
    for (let i = 0; i < 800 && potionQty(sim) < 7; i++) killNearestEnemy(sim);
    expect(killUntilBagHasRarity(sim, 'wolf_leather', 'normal', 800)).toBe(true);
    restoreToFull(sim); // full HP, safe
    // equip the Normal leather: +20 maxHp but HP isn't topped up -> gap EXACTLY 20,
    // which is below the 50 heal, so the heal MUST clamp at the max.
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: 'normal', plus: 0 });
    safeStep(sim);
    const heal = ITEMS.health_potion.consumable!.healHp!;
    const hpBefore = player(sim).hp;
    const maxHp = player(sim).maxHp;
    const qtyBefore = potionQty(sim);
    expect(hpBefore).toBeLessThan(maxHp); // the leather opened a gap to heal into
    expect(hpBefore + heal).toBeGreaterThan(maxHp); // ...and the heal WOULD overflow -> clamp binds

    sim.sendCommand({ t: 'use-item', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    safeStep(sim);

    expect(player(sim).hp).toBe(maxHp); // healed up to — and clamped at — the max
    expect(potionQty(sim)).toBe(qtyBefore - 1); // exactly one potion spent
  });

  it('refuses at full HP — no potion consumed and no cooldown armed', () => {
    const sim = new Sim(7);
    expect(killUntilBagHas(sim, 'health_potion', 800)).toBe(true);
    // grind a buffer of potions (to refill after combat) and a leather for the gap
    for (let i = 0; i < 800 && potionQty(sim) < 7; i++) killNearestEnemy(sim);
    expect(killUntilBagHasRarity(sim, 'wolf_leather', 'normal', 800)).toBe(true);
    restoreToFull(sim); // flee + drink to full; player ends safe and topped up
    expect(player(sim).hp).toBe(player(sim).maxHp);
    const qtyFull = potionQty(sim);
    expect(qtyFull).toBeGreaterThanOrEqual(1);

    // (1) at full HP the potion does nothing AND is not consumed
    sim.sendCommand({ t: 'use-item', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    safeStep(sim);
    expect(potionQty(sim)).toBe(qtyFull);
    expect(player(sim).hp).toBe(player(sim).maxHp);

    // (2) the no-op armed NO cooldown: open a gap and a drink works on the very
    // next tick (a wrongly-armed cooldown would block this and consume nothing).
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: 'normal', plus: 0 });
    safeStep(sim);
    expect(player(sim).hp).toBeLessThan(player(sim).maxHp);
    sim.sendCommand({ t: 'use-item', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    safeStep(sim);
    expect(potionQty(sim)).toBe(qtyFull - 1); // healed immediately -> no lingering cooldown
  });

  it('respects the shared potion cooldown before another can be used', () => {
    const sim = new Sim(7);
    // two real uses are needed, so make sure at least two potions are in the bag
    for (let i = 0; i < 800 && potionQty(sim) < 2; i++) killNearestEnemy(sim);
    expect(potionQty(sim)).toBeGreaterThanOrEqual(2);
    setupHealGap(sim); // flees to safety + equips Normal leather (opens an HP gap)
    expect(player(sim).hp).toBeLessThan(player(sim).maxHp);

    // First drink. Record the tick it applied so we can pin the cooldown's EXACT
    // length (it ends at drinkTick + POTION_COOLDOWN_TICKS). safeStep keeps wolves
    // off us so HP only moves from drinks, never from a stray bite.
    const qty0 = potionQty(sim);
    sim.sendCommand({ t: 'use-item', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    safeStep(sim);
    const drinkTick = sim.tick;
    expect(potionQty(sim)).toBe(qty0 - 1);

    // Re-open the gap (unequip + re-equip the leather — equipping never tops HP
    // up) so every later refusal can ONLY be the cooldown, not a full-HP no-op.
    sim.sendCommand({ t: 'unequip', slot: 'armor' });
    safeStep(sim);
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: 'normal', plus: 0 });
    safeStep(sim);
    expect(player(sim).hp).toBeLessThan(player(sim).maxHp);

    // Step to ONE TICK before the cooldown elapses; a use there is STILL refused
    // (pins the lower edge — same both-sides rigor as the RESPAWN/EVENT_TTL tests).
    while (sim.tick < drinkTick + POTION_COOLDOWN_TICKS - 2) safeStep(sim);
    const qtyEdge = potionQty(sim);
    const hpEdge = player(sim).hp;
    sim.sendCommand({ t: 'use-item', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    safeStep(sim); // applied at drinkTick + POTION_COOLDOWN_TICKS - 1: one tick short
    expect(sim.tick).toBe(drinkTick + POTION_COOLDOWN_TICKS - 1);
    expect(potionQty(sim)).toBe(qtyEdge); // blocked: nothing consumed
    expect(player(sim).hp).toBe(hpEdge);

    // Exactly at the boundary it works again (HP up, one more potion spent).
    sim.sendCommand({ t: 'use-item', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    safeStep(sim); // applied at drinkTick + POTION_COOLDOWN_TICKS: cooldown elapsed
    expect(sim.tick).toBe(drinkTick + POTION_COOLDOWN_TICKS);
    expect(player(sim).hp).toBeGreaterThan(hpEdge);
    expect(potionQty(sim)).toBe(qtyEdge - 1);
  });

  it('drinking a potion is part of the deterministic fingerprint (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      // assert the path is actually exercised — no silent skip if a drop ever fails
      expect(killUntilBagHas(sim, 'health_potion', 800)).toBe(true);
      expect(killUntilBagHasRarity(sim, 'wolf_leather', 'normal', 800)).toBe(true);
      sim.sendCommand({ t: 'set-target', id: null });
      sim.sendCommand({ t: 'stop' });
      sim.step();
      sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: 'normal', plus: 0 });
      sim.step();
      sim.sendCommand({ t: 'use-item', itemId: 'health_potion', rarity: 'normal', plus: 0 });
      sim.step();
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

describe('item rarity (lucky drops)', () => {
  it('rares are much rarer than commons, and the roll is deterministic', () => {
    const tally = (seed: number, n: number): Record<string, number> => {
      const rng = new Rng(seed);
      const counts: Record<string, number> = { normal: 0, sos: 0, som: 0, sun: 0 };
      for (let i = 0; i < n; i++) counts[rollRarity(rng)]++;
      return counts;
    };
    const N = 5000;
    const a = tally(7, N);
    // most drops are Normal, and each tier is rarer than the previous
    expect(a.normal).toBeGreaterThan(N / 2);
    expect(a.normal).toBeGreaterThan(a.sos);
    expect(a.sos).toBeGreaterThan(a.som);
    expect(a.som).toBeGreaterThan(a.sun);
    // deterministic: same seed => identical tallies; different seed => different
    expect(tally(7, N)).toEqual(a);
    expect(tally(123, N)).not.toEqual(a);
  });

  it('higher rarity scales an equipment bonus up (normal = base), with half-up rounding', () => {
    expect(rarityStat(10, 'normal')).toBe(10);
    expect(rarityStat(10, 'sos')).toBeGreaterThan(rarityStat(10, 'normal'));
    expect(rarityStat(10, 'som')).toBeGreaterThan(rarityStat(10, 'sos'));
    expect(rarityStat(10, 'sun')).toBeGreaterThan(rarityStat(10, 'som'));
    // fractional multiplier (SOS = 1.5) on odd values rounds half-up
    expect(rarityStat(5, 'sos')).toBe(8); // round(7.5)
    expect(rarityStat(15, 'sos')).toBe(23); // round(22.5)
  });

  it('rollRarity partitions [0,1): boundaries map correctly and the rarest tier absorbs the tail', () => {
    const at = (v: number) => rollRarity({ next: () => v } as unknown as Rng);
    expect(at(0)).toBe('normal');
    expect(at(0.5)).toBe('normal');
    expect(at(0.95)).toBe('sos'); // 0.90..0.98
    expect(at(0.99)).toBe('som'); // 0.98..0.998
    expect(at(0.999)).toBe('sun'); // >= 0.998
    expect(at(0.9999999)).toBe('sun'); // near 1.0 still lands on the rarest tier
  });

  it('equipping a RARER copy grants strictly more than a Normal one (rarer = stronger, end-to-end)', () => {
    const sim = new Sim(7);
    const player = () => sim.entities().find((e) => e.kind === 'player')!;
    const rareLeather = () =>
      sim.inventory().stacks.find((s) => s.itemId === 'wolf_leather' && s.rarity !== 'normal');
    // Farm until a NON-Normal Couro de Lobo drops (deterministic; cap is a safety net).
    let guard = 0;
    while (!rareLeather() && guard++ < 600) killNearestEnemy(sim);
    const stack = rareLeather();
    expect(stack).toBeDefined();

    const baseBonus = ITEMS.wolf_leather.stats?.maxHp ?? 0; // what a Normal copy gives
    const maxBefore = player().maxHp;
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: stack!.rarity, plus: stack!.plus });
    sim.step();
    // the effective max-HP gain exceeds the base bonus -> rarity scaling is wired
    // through equip -> recomputeStats (not self-referential to rarityStat).
    expect(player().maxHp - maxBefore).toBeGreaterThan(baseBonus);
  });
});

describe('alchemy ("+N")', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const count = (sim: Sim, id: string): number =>
    sim.inventory().stacks.filter((s) => s.itemId === id).reduce((n, s) => n + s.qty, 0);
  const weaponPlus = (sim: Sim): number =>
    sim.inventory().equipment.find((e) => e.slot === 'weapon')!.plus;
  const weaponDamage = (sim: Sim): number => meleeDamage(player(sim).str, player(sim).weaponDamage);

  // Equip a freshly-looted (un-enhanced) sword, then stop fighting so refining
  // happens in isolation (no auto-attack kills dropping more materials mid-test).
  const equipSwordAndRest = (sim: Sim): void => {
    expect(killUntilBagHas(sim, 'old_sword', 400)).toBe(true);
    const s = sim.inventory().stacks.find((x) => x.itemId === 'old_sword')!;
    sim.sendCommand({ t: 'equip', itemId: 'old_sword', rarity: s.rarity, plus: s.plus });
    sim.sendCommand({ t: 'set-target', id: null });
    sim.sendCommand({ t: 'stop' });
    sim.step();
  };
  const farm = (sim: Sim, id: string, n: number, cap: number): boolean => {
    let g = 0;
    while (count(sim, id) < n && g++ < cap) killNearestEnemy(sim);
    return count(sim, id) >= n;
  };

  it('enhanceChance falls as "+" rises, a Lucky Powder helps, and the cap has 0 chance', () => {
    expect(enhanceChance(0, false)).toBeGreaterThan(enhanceChance(5, false));
    expect(enhanceChance(5, false)).toBeGreaterThan(enhanceChance(9, false));
    expect(enhanceChance(5, true)).toBeGreaterThan(enhanceChance(5, false)); // lucky helps
    expect(enhanceChance(MAX_PLUS, true)).toBe(0); // no attempts past the cap
    // a "+N" item's bonus grows with the level (and +0 = base)
    expect(enhanceStat(10, 5)).toBeGreaterThan(enhanceStat(10, 0));
    expect(enhanceStat(10, 0)).toBe(10);
  });

  it('refining consumes an Elixir (and a Lucky Powder when used)', () => {
    const sim = new Sim(7);
    equipSwordAndRest(sim);
    expect(farm(sim, 'elixir_weapon', 1, 600)).toBe(true);
    expect(farm(sim, 'lucky_powder', 1, 600)).toBe(true);
    sim.sendCommand({ t: 'set-target', id: null });
    sim.sendCommand({ t: 'stop' });
    sim.step();
    const elixir0 = count(sim, 'elixir_weapon');
    const powder0 = count(sim, 'lucky_powder');

    sim.sendCommand({ t: 'enhance', slot: 'weapon', useLuckyPowder: true });
    sim.step();

    expect(count(sim, 'elixir_weapon')).toBe(elixir0 - 1); // elixir spent on the attempt
    expect(count(sim, 'lucky_powder')).toBe(powder0 - 1); // powder spent (it was used)
  });

  it('refining succeeds (+1, stat rises) or fails (-1), staying within [0, MAX_PLUS]', () => {
    const sim = new Sim(7);
    equipSwordAndRest(sim);
    const baseDmg = weaponDamage(sim); // damage at +0
    const ELIXIRS = 20;
    expect(farm(sim, 'elixir_weapon', ELIXIRS, 1500)).toBe(true);
    sim.sendCommand({ t: 'set-target', id: null });
    sim.sendCommand({ t: 'stop' });
    sim.step();

    let sawSuccess = false;
    let sawFail = false;
    for (let i = 0; i < ELIXIRS; i++) {
      const before = weaponPlus(sim);
      sim.sendCommand({ t: 'enhance', slot: 'weapon', useLuckyPowder: false });
      sim.step();
      const after = weaponPlus(sim);
      expect(after).toBeGreaterThanOrEqual(0); // never breaks below +0
      expect(after).toBeLessThanOrEqual(MAX_PLUS); // never exceeds the cap
      // whenever the weapon is enhanced, the EFFECTIVE damage reflects it (the
      // "+N" really flows through equip -> recomputeStats into combat).
      if (after > 0) expect(weaponDamage(sim)).toBeGreaterThan(baseDmg);
      if (after === before + 1) sawSuccess = true;
      else if (after === before - 1) sawFail = true;
      else if (before === 0 && after === 0) sawFail = true; // failed at +0 (floored)
      else if (before === after && before === MAX_PLUS) continue; // refused at cap (no-op)
      else throw new Error(`unexpected "+" change ${before} -> ${after}`);
    }
    expect(sawSuccess).toBe(true); // success raised the "+"
    expect(sawFail).toBe(true); // failure dropped it (or held at +0)
  });

  it('an enhanced "+N" survives unequip and re-equip (carried on the bag stack)', () => {
    const sim = new Sim(7);
    equipSwordAndRest(sim);
    const sword = sim.inventory().equipment.find((e) => e.slot === 'weapon')!;
    expect(farm(sim, 'elixir_weapon', 12, 1000)).toBe(true);
    sim.sendCommand({ t: 'set-target', id: null });
    sim.sendCommand({ t: 'stop' });
    sim.step();

    // refine until the weapon reaches at least +1
    let guard = 0;
    while (weaponPlus(sim) < 1 && count(sim, 'elixir_weapon') > 0 && guard++ < 12) {
      sim.sendCommand({ t: 'enhance', slot: 'weapon', useLuckyPowder: false });
      sim.step();
    }
    const enhanced = weaponPlus(sim);
    expect(enhanced).toBeGreaterThanOrEqual(1);
    const enhancedDmg = weaponDamage(sim);

    // unequip -> a stack at the enhanced "+N" appears, distinct from any +0
    sim.sendCommand({ t: 'unequip', slot: 'weapon' });
    sim.step();
    const back = sim.inventory().stacks.find((s) => s.itemId === 'old_sword' && s.plus === enhanced);
    expect(back).toBeDefined();

    // re-equip THAT stack -> the "+N" and its damage are preserved
    sim.sendCommand({ t: 'equip', itemId: 'old_sword', rarity: sword.rarity!, plus: enhanced });
    sim.step();
    expect(weaponPlus(sim)).toBe(enhanced);
    expect(weaponDamage(sim)).toBe(enhancedDmg);
  });

  it('the enhance command stream is deterministic (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      equipSwordAndRest(sim);
      farm(sim, 'elixir_weapon', 10, 1000);
      sim.sendCommand({ t: 'set-target', id: null });
      sim.sendCommand({ t: 'stop' });
      for (let i = 0; i < 10; i++) {
        sim.sendCommand({ t: 'enhance', slot: 'weapon', useLuckyPowder: false });
        sim.step();
      }
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

describe('world boss', () => {
  const findBoss = (sim: Sim) => sim.entities().find((e) => e.boss);
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const minionCount = (sim: Sim): number =>
    sim.entities().filter((e) => e.name === BOSS_TEMPLATE.minionName).length;

  // Beat the live boss to death (targets the boss by id; auto-attack + ability).
  const killBoss = (sim: Sim): void => {
    const id = findBoss(sim)!.id;
    let guard = 0;
    // the boss bites hard enough to down the player, so re-acquire it each tick
    // (a respawn clears our target) and allow a big budget for the death cycles.
    while (sim.entities().some((e) => e.id === id) && guard++ < 16000) {
      const b = sim.entities().find((e) => e.id === id);
      const p = player(sim);
      sim.sendCommand({ t: 'set-target', id });
      if (b) sim.sendCommand({ t: 'move', dx: b.x - p.x, dz: b.z - p.z });
      sim.sendCommand({ t: 'use-ability', slot: 1 });
      sim.step();
    }
  };

  it('spawns at its scheduled tick, with boss HP and an announcement', () => {
    const sim = new Sim(7);
    // not yet, one tick before the schedule
    for (let i = 0; i < BOSS_FIRST_SPAWN_TICK - 1; i++) sim.step();
    expect(findBoss(sim)).toBeUndefined();

    sim.step(); // reaches BOSS_FIRST_SPAWN_TICK
    const boss = findBoss(sim);
    expect(boss).toBeDefined();
    expect(boss!.name).toBe(BOSS_TEMPLATE.name);
    expect(boss!.maxHp).toBe(BOSS_TEMPLATE.hp);
    expect(boss!.maxHp).toBeGreaterThanOrEqual(ENEMY_TEMPLATE.hp * 15); // far tankier than a common mob
    // an announcement event carrying the boss name was emitted
    expect(
      sim.recentEvents().some((e) => e.kind === 'boss-spawn' && e.text === BOSS_TEMPLATE.name),
    ).toBe(true);
  });

  it('is tanky (many landed hits), announces defeat, drops rich loot, and respawns on schedule', () => {
    const sim = new Sim(7);
    while (!findBoss(sim)) sim.step(); // advance to the boss spawn (player idle -> 0 gold)
    const bossId = findBoss(sim)!.id;
    expect(player(sim).gold).toBe(0);

    // target the boss and beat it down, counting the hits that actually LAND on it
    const alive = (): boolean => sim.entities().some((e) => e.id === bossId);
    let guard = 0;
    let lastSeq = 0;
    let landedHits = 0;
    while (alive() && guard++ < 16000) {
      const b = sim.entities().find((e) => e.id === bossId);
      const p = player(sim);
      sim.sendCommand({ t: 'set-target', id: bossId }); // re-acquire after any death/respawn
      if (b) sim.sendCommand({ t: 'move', dx: b.x - p.x, dz: b.z - p.z });
      sim.sendCommand({ t: 'use-ability', slot: 1 });
      sim.step();
      for (const ev of sim.recentEvents()) {
        if (ev.seq <= lastSeq) continue;
        lastSeq = ev.seq;
        if (ev.kind === 'damage' && ev.targetId === bossId) landedHits++;
      }
    }
    expect(alive()).toBe(false); // died within budget
    expect(landedHits).toBeGreaterThan(20); // genuinely tanky — a common wolf takes ~3 hits
    expect(sim.recentEvents().some((e) => e.kind === 'boss-defeat')).toBe(true);

    // rich loot: gold gained dwarfs a common mob's max
    const goldGained = player(sim).gold; // started at 0
    expect(goldGained).toBeGreaterThanOrEqual(BOSS_TEMPLATE.goldMin);
    expect(goldGained).toBeGreaterThan(ENEMY_TEMPLATE.goldMax);

    // gone now; a new boss appears EXACTLY after the respawn delay (both sides pinned)
    const deathTick = sim.tick;
    expect(findBoss(sim)).toBeUndefined();
    sim.sendCommand({ t: 'stop' });
    while (sim.tick < deathTick + BOSS_RESPAWN_TICKS - 1) sim.step();
    expect(findBoss(sim)).toBeUndefined(); // still gone one tick before the deadline
    sim.step();
    expect(findBoss(sim)).toBeDefined(); // respawned exactly on schedule
  });

  it('has a more generous loot table than a common mob (gold + rarities)', () => {
    // bigger gold floor than the common mob's ceiling
    expect(BOSS_TEMPLATE.goldMin).toBeGreaterThan(ENEMY_TEMPLATE.goldMax);
    // drops gear far more often (e.g. the sword)
    const dropChance = (drops: typeof BOSS_TEMPLATE.drops, id: string): number =>
      drops.find((d) => d.itemId === id)?.chance ?? 0;
    expect(dropChance(BOSS_TEMPLATE.drops, 'old_sword')).toBeGreaterThan(
      dropChance(ENEMY_TEMPLATE.drops, 'old_sword'),
    );
    // and the rarity table is far heavier on rares, lighter on Normal
    const weight = (rs: typeof RARITIES, id: string): number => rs.find((r) => r.id === id)!.dropWeight;
    expect(weight(BOSS_RARITIES, 'sun')).toBeGreaterThan(weight(RARITIES, 'sun'));
    expect(weight(BOSS_RARITIES, 'som')).toBeGreaterThan(weight(RARITIES, 'som'));
    expect(weight(BOSS_RARITIES, 'normal')).toBeLessThan(weight(RARITIES, 'normal'));

    // statistical: rolling the boss table yields FAR more non-Normal results
    const nonNormal = (rarities: typeof RARITIES, n: number): number => {
      const rng = new Rng(7);
      let c = 0;
      for (let i = 0; i < n; i++) if (rollRarity(rng, rarities) !== 'normal') c++;
      return c;
    };
    const N = 4000;
    expect(nonNormal(BOSS_RARITIES, N)).toBeGreaterThan(nonNormal(RARITIES, N));
  });

  it('can be selected with Tab (cycle-target), like any enemy', () => {
    const sim = new Sim(7);
    while (!findBoss(sim)) sim.step();
    const bossId = findBoss(sim)!.id; // boss is at (0,30), in front of the origin-facing player
    let landed = false;
    for (let i = 0; i < 30 && !landed; i++) {
      sim.sendCommand({ t: 'cycle-target' });
      sim.step();
      if (sim.localTargetId() === bossId) landed = true;
    }
    expect(landed).toBe(true); // Tab cycling reaches the boss
  });

  it('the boss spawn -> kill -> respawn path is deterministic (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      while (!sim.entities().some((e) => e.boss)) sim.step();
      const bossId = sim.entities().find((e) => e.boss)!.id;
      let guard = 0;
      while (sim.entities().some((e) => e.id === bossId) && guard++ < 16000) {
        const b = sim.entities().find((e) => e.id === bossId);
        const p = sim.entities().find((e) => e.kind === 'player')!;
        sim.sendCommand({ t: 'set-target', id: bossId }); // re-acquire after any death/respawn
        if (b) sim.sendCommand({ t: 'move', dx: b.x - p.x, dz: b.z - p.z });
        sim.sendCommand({ t: 'use-ability', slot: 1 });
        sim.step();
      }
      const deathTick = sim.tick;
      while (sim.tick < deathTick + BOSS_RESPAWN_TICKS) sim.step(); // through the respawn
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });

  it('summons one wave per threshold, each in its 75/50/25 band, with no repeats', () => {
    const sim = new Sim(7);
    while (!findBoss(sim)) sim.step();
    const bossId = findBoss(sim)!.id;
    expect(minionCount(sim)).toBe(0); // nothing summoned before any damage

    const alive = (): boolean => sim.entities().some((e) => e.id === bossId);
    let lastSeq = 0;
    const summonFracs: number[] = []; // boss HP fraction captured at each summon
    let guard = 0;
    while (alive() && guard++ < 16000) {
      const b = sim.entities().find((e) => e.id === bossId);
      const p = player(sim);
      sim.sendCommand({ t: 'set-target', id: bossId }); // re-acquire after any death/respawn
      if (b) sim.sendCommand({ t: 'move', dx: b.x - p.x, dz: b.z - p.z });
      sim.sendCommand({ t: 'use-ability', slot: 1 });
      sim.step();
      for (const ev of sim.recentEvents()) {
        if (ev.seq <= lastSeq) continue;
        lastSeq = ev.seq;
        if (ev.kind === 'boss-summon') {
          const cur = sim.entities().find((e) => e.id === bossId);
          summonFracs.push(cur ? cur.hp / cur.maxHp : 0);
        }
      }
    }
    // exactly one wave per threshold — no repeats in a band
    expect(summonFracs.length).toBe(BOSS_TEMPLATE.summonThresholds.length);
    // ...and each wave fired in its own descending band (75 / 50 / 25%)
    expect(summonFracs[0]).toBeLessThanOrEqual(0.75);
    expect(summonFracs[0]).toBeGreaterThan(0.5);
    expect(summonFracs[1]).toBeLessThanOrEqual(0.5);
    expect(summonFracs[1]).toBeGreaterThan(0.25);
    expect(summonFracs[2]).toBeLessThanOrEqual(0.25);
    expect(summonFracs[2]).toBeGreaterThan(0);
    // the minions are out there (none were killed — the player only hit the boss)
    expect(minionCount(sim)).toBe(
      BOSS_TEMPLATE.summonThresholds.length * BOSS_TEMPLATE.minionCount,
    );
  });

  it('resets its summon thresholds on respawn (a FULL fresh wave set next fight)', () => {
    const sim = new Sim(7);
    while (!findBoss(sim)) sim.step();
    killBoss(sim); // fight 1 fires all its waves
    // wait for the boss to come back
    sim.sendCommand({ t: 'stop' });
    while (!findBoss(sim)) sim.step();

    // fight 2: killing the FRESH boss must fire the WHOLE set again (full reset,
    // not a partial one) — a stuck/partly-reset counter would summon fewer.
    const id2 = findBoss(sim)!.id;
    let lastSeq = sim.recentEvents().reduce((m, e) => Math.max(m, e.seq), 0);
    let summons = 0;
    let guard = 0;
    while (sim.entities().some((e) => e.id === id2) && guard++ < 16000) {
      const b = sim.entities().find((e) => e.id === id2);
      const p = player(sim);
      sim.sendCommand({ t: 'set-target', id: id2 }); // re-acquire after any death/respawn
      if (b) sim.sendCommand({ t: 'move', dx: b.x - p.x, dz: b.z - p.z });
      sim.sendCommand({ t: 'use-ability', slot: 1 });
      sim.step();
      for (const ev of sim.recentEvents()) {
        if (ev.seq <= lastSeq) continue;
        lastSeq = ev.seq;
        if (ev.kind === 'boss-summon') summons++;
      }
    }
    expect(summons).toBe(BOSS_TEMPLATE.summonThresholds.length);
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
