import { describe, it, expect } from 'vitest';
import {
  Sim,
  meleeDamage,
  abilityDamage,
  rollRarity,
  rarityStat,
  STR_TO_DAMAGE,
  WORLD_HALF,
  CITY_WALL_HALF,
  GATE_HALF,
  ENEMY_SPEED,
  MELEE_RANGE,
  CRIT_MULT,
  DT,
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
  STR_TO_HP,
  BOT_HEAL_FRAC,
  BOT_MATERIAL_RESERVE,
  inFrontOf,
  STARTING_ENEMY_COUNT,
} from '../src/sim/sim';
import { Rng } from '../src/sim/rng';
import { ENEMY_TEMPLATE, ENEMY_TIERS, ENEMY_SPECIES, ROGUE_TEMPLATE, levelHpMult } from '../src/sim/content/enemies';
import { CLASSES } from '../src/sim/content/classes';
import { ABILITIES, MASTERIES } from '../src/sim/content/abilities';
import { addToBag, BAG_SLOTS, STORAGE_SLOTS } from '../src/sim/inventory';
import { WAREHOUSE_SPAWN_X, WAREHOUSE_SPAWN_Z, WAREHOUSE_ENTITY_ID } from '../src/sim/storage';
import { ITEMS } from '../src/sim/content/items';
import { MAX_PLUS, RISK_FLOOR } from '../src/sim/content/enhance';
import { enhanceChance, enhanceStat } from '../src/sim/enhance';
import { SKILL_SP_COST, SKILL_MAX_RANK } from '../src/sim/content/skill_ranks';
import {
  MAX_DURABILITY, DEATH_DURABILITY_LOSS, DURABILITY_WORN_AT, durabilityFactor, repairCost,
} from '../src/sim/content/durability';
import { RARITIES } from '../src/sim/content/rarity';
import {
  BOSS_TEMPLATE,
  WARLORD_TEMPLATE,
  BOSS_DEFS,
  BOSS_RARITIES,
  BOSS_FIRST_SPAWN_TICK,
  BOSS_RESPAWN_TICKS,
} from '../src/sim/content/bosses';
import {
  VENDOR_SPAWN_X,
  VENDOR_SPAWN_Z,
  VENDOR_INTERACT_RANGE,
  VENDOR_STOCK,
} from '../src/sim/content/vendor';
import type { Command, Rarity } from '../src/world_api';
import type { ItemStack, Entity } from '../src/sim/types';
import { spellDamage, spellAbilityDamage, INT_TO_DAMAGE, mitigate, MAGIC_DEF_PER_INT, ARMOR_K } from '../src/sim/combat';
import type { Damage } from '../src/sim/combat';

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

// The local player's NAME (character-creation screen, GDD v0.4 §1.3). The name is an
// optional 3rd constructor arg; the default 'Hero' keeps every other test bit-identical.
describe('local player name', () => {
  it('defaults to "Hero" when no name is given (backward-compatible)', () => {
    const player = new Sim(7).entities().find((e) => e.kind === 'player')!;
    expect(player.name).toBe('Hero');
  });

  it('the optional constructor name sets the local player name', () => {
    const player = new Sim(7, true, 'Gabriel').entities().find((e) => e.kind === 'player')!;
    expect(player.name).toBe('Gabriel');
  });

  it('the chosen name is cosmetic: it never perturbs the world fingerprint', () => {
    const runNamed = (seed: number, name?: string): string => {
      const sim = name === undefined ? new Sim(seed) : new Sim(seed, true, name);
      const script: Command[] = [
        { t: 'move', dx: 1, dz: 0 },
        { t: 'stop' },
        { t: 'move', dx: -1, dz: 1 },
      ];
      for (let i = 0; i < 300; i++) {
        sim.sendCommand(script[Math.floor(i / 100) % script.length]);
        sim.step();
      }
      return sim.hash();
    };
    // Same seed + same commands => identical world, REGARDLESS of the player's name:
    // the name feeds no Rng substream and stays out of hash(). A future regression that
    // leaked the name into world state (or into the fingerprint) would break this.
    const base = runNamed(1337);
    expect(runNamed(1337, 'Gabriel')).toBe(base);
    expect(runNamed(1337, 'Hero')).toBe(base);
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
    expect(enemyCount()).toBe(STARTING_ENEMY_COUNT);

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
    expect(enemyCount()).toBe(STARTING_ENEMY_COUNT - 1);

    // Pin the ~15s delay: still one short right up to the respawn tick, then back.
    const deathTick = sim.tick;
    sim.sendCommand({ t: 'stop' });
    while (sim.tick < deathTick + RESPAWN_TICKS - 1) sim.step();
    expect(enemyCount()).toBe(STARTING_ENEMY_COUNT - 1); // not yet
    sim.step(); // reaches deathTick + RESPAWN_TICKS
    expect(enemyCount()).toBe(STARTING_ENEMY_COUNT); // respawned
    // ...and every respawned common mob is one of the known species (its name is
    // that species' base name, optionally with a Champion/Elite tier suffix).
    const names = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss).map((e) => e.name);
    expect(names.every((n) => ENEMY_SPECIES.some((s) => n.startsWith(s.name)))).toBe(true);
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
function killNearestEnemy(sim: Sim, species?: string): boolean {
  const playerOf = () => sim.entities().find((e) => e.kind === 'player')!;
  const gold0 = playerOf().gold;
  // Re-acquire the nearest living wolf each tick and chase it. Robust to the
  // player dying and respawning mid-grind (it just re-targets the nearest wolf
  // near the safe point). A kill is detected by gold strictly rising — every
  // kill drops gold — which works regardless of WHICH wolf died.
  for (let guard = 0; guard < 6000; guard++) {
    if (playerOf().gold > gold0) return true;
    const me = playerOf();
    // Optionally restrict to one species (progression tests pass 'skeleton_minion' to assert
    // exact wolf XP/SP); unfiltered it kills the nearest of ANY species, so farming
    // loops don't deplete one species (respawns roll a fresh species each time).
    const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss && e.hp > 0 && (!species || e.species === species));
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
    const hostile = sim.entities().find((e) => e.kind === 'enemy' && !e.boss && e.hostile && e.species === 'skeleton_minion');
    if (hostile) return hostile.id;
    const p = sim.entities().find((e) => e.kind === 'player')!;
    const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss && e.species === 'skeleton_minion');
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

// Approach the nearest wolf and land ONE ability cast on it, dropping the target
// the SAME tick so the follow-up auto-attack doesn't finish it off — the wolf
// survives carrying the ability's status effects. `slot` selects the ability:
// 1 = Golpe Forte (bleed + slow), 3 = Atordoamento (stun). Casting on the FIRST
// in-melee tick (d <= MELEE_RANGE) guarantees no prior auto-attack landed, so
// this is robust to player-speed / damage retuning. Returns the wolf id.
function castWolf(sim: Sim, slot: number): number | null {
  for (let i = 0; i < 2000; i++) {
    const p = sim.entities().find((e) => e.kind === 'player')!;
    const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss && e.hp > 0 && e.species === 'skeleton_minion');
    if (wolves.length === 0) return null;
    wolves.sort((a, b) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
    const w = wolves[0];
    const d = Math.hypot(w.x - p.x, w.z - p.z);
    if (d > MELEE_RANGE) {
      // approach WITHOUT a target so no auto-attack lands en route (would pre-damage the wolf)
      sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      sim.step();
    } else {
      // in melee: set target + cast + drop the target the SAME tick, so ONLY the cast hits
      sim.sendCommand({ t: 'set-target', id: w.id });
      sim.sendCommand({ t: 'use-ability', slot });
      sim.sendCommand({ t: 'set-target', id: null });
      sim.sendCommand({ t: 'stop' });
      sim.step();
      const cw = sim.entities().find((e) => e.id === w.id);
      if (cw && cw.statuses.length > 0) return w.id;
    }
  }
  return null;
}

describe('status effects', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const wolfById = (sim: Sim, id: number) => sim.entities().find((e) => e.id === id);
  // Sword-kit effect durations (data-as-code, 20Hz): Atordoamento stun 1.0s;
  // Golpe Forte slow 3.0s and dot 2.0s @0.5s.
  const STUN_TICKS = 20;
  const DOT_MAG = 2;
  const DOT_PERIOD = 10;

  it('stun: a wolf is frozen for exactly the stun duration, then resumes acting', () => {
    const sim = new Sim(7);
    const wid = castWolf(sim, 3); // Atordoamento
    expect(wid).not.toBeNull();
    const castTick = sim.tick; // the stun landed on this tick
    const w0 = wolfById(sim, wid!)!;
    expect(w0.statuses).toContain('stun');
    const x0 = w0.x;
    const z0 = w0.z;

    // frozen: no movement while stunned
    for (let i = 0; i < 10; i++) sim.step();
    const wMid = wolfById(sim, wid!)!;
    expect(wMid.statuses).toContain('stun');
    expect(wMid.x).toBe(x0);
    expect(wMid.z).toBe(z0);

    // pin the duration on both edges: still stunned at cast+19, gone at cast+20
    while (sim.tick < castTick + STUN_TICKS - 1) sim.step();
    expect(wolfById(sim, wid!)!.statuses).toContain('stun');
    sim.step(); // -> cast + STUN_TICKS
    expect(wolfById(sim, wid!)!.statuses).not.toContain('stun');

    // resumes: with the player fleeing nearby, the freed wolf acts again (chases -> moves)
    const r0 = wolfById(sim, wid!)!;
    const rx = r0.x;
    const rz = r0.z;
    for (let i = 0; i < 20; i++) {
      const p = player(sim);
      sim.sendCommand({ t: 'move', dx: WORLD_HALF - p.x, dz: WORLD_HALF - p.z });
      sim.step();
    }
    const r1 = wolfById(sim, wid!)!;
    expect(Math.hypot(r1.x - rx, r1.z - rz)).toBeGreaterThan(0); // it moved -> resumed acting
  });

  it('dot: a bleed drains HP by its magnitude on each period tick, then stops at expiry', () => {
    const sim = new Sim(7);
    const wid = castWolf(sim, 1); // Golpe Forte (bleed)
    expect(wid).not.toBeNull();
    const castTick = sim.tick;
    expect(wolfById(sim, wid!)!.statuses).toContain('dot');
    const hp0 = wolfById(sim, wid!)!.hp;

    // HP flat until just before the first period tick (player idle, no target ->
    // the wolf takes no hit but its own bleed; that fires only on period ticks)
    while (sim.tick < castTick + DOT_PERIOD - 1) sim.step();
    expect(wolfById(sim, wid!)!.hp).toBe(hp0);
    sim.step(); // first period tick (cast + period)
    expect(wolfById(sim, wid!)!.hp).toBe(hp0 - DOT_MAG);
    // second period tick removes exactly another magnitude
    while (sim.tick < castTick + 2 * DOT_PERIOD) sim.step();
    expect(wolfById(sim, wid!)!.hp).toBe(hp0 - 2 * DOT_MAG);
    // exactly 3 ticks total (+10/+20/+30 over the 40-tick window), then flat after expiry
    while (sim.tick < castTick + 45) sim.step();
    const hpAfter = wolfById(sim, wid!)!.hp;
    expect(hpAfter).toBe(hp0 - 3 * DOT_MAG);
    for (let i = 0; i < 20; i++) sim.step();
    expect(wolfById(sim, wid!)!.hp).toBe(hpAfter); // bleed ended -> HP no longer falling from it
  });

  it('slow: a slowed wolf chases at ~half speed (not full, and it does move)', () => {
    const sim = new Sim(7);
    const wid = castWolf(sim, 1); // Golpe Forte (slow)
    expect(wid).not.toBeNull();
    expect(wolfById(sim, wid!)!.statuses).toContain('slow');

    // open a real gap so the wolf must chase the whole window (player outruns it)
    for (let i = 0; i < 12; i++) {
      const p = player(sim);
      sim.sendCommand({ t: 'move', dx: WORLD_HALF - p.x, dz: WORLD_HALF - p.z });
      sim.step();
    }
    sim.sendCommand({ t: 'stop' });
    sim.step();
    const before = wolfById(sim, wid!)!;
    expect(before.statuses).toContain('slow');
    const bx = before.x;
    const bz = before.z;
    const p = player(sim);
    expect(Math.hypot(p.x - bx, p.z - bz)).toBeGreaterThan(2); // gap > CONTACT_DIST for the window
    const K = 8;
    for (let i = 0; i < K; i++) sim.step();
    const after = wolfById(sim, wid!)!;
    const moved = Math.hypot(after.x - bx, after.z - bz);
    const fullSpeedDist = ENEMY_SPEED * DT * K; // distance an UN-slowed wolf would cover
    // slow factor is 0.5 -> pin BOTH sides around ~0.5x (not just "less than full")
    expect(moved).toBeGreaterThan(fullSpeedDist * 0.4);
    expect(moved).toBeLessThan(fullSpeedDist * 0.65);
  });

  it('the status lifecycle (apply -> expire -> cleanup) is deterministic (same seed => same hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      const wid = castWolf(sim, 1); // Golpe Forte (bleed + slow)
      expect(wid).not.toBeNull();
      for (let i = 0; i < 80; i++) sim.step(); // past all effects (slow 60t) -> cleanup fingerprinted
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

// The full Sword kit on a multi-slot bar: Golpe Forte (slot 1, covered by the
// status tests above), Postura Defensiva (slot 2, a self-buff), Atordoamento
// (slot 3, the stun — its freeze is covered by the status 'stun' test).
describe('sword kit (multi-slot abilities)', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;

  it('the action bar exposes all three sword slots, in order', () => {
    const bar = new Sim(7).abilities();
    expect(bar.map((a) => a.slot)).toEqual([1, 2, 3]);
    expect(bar.map((a) => a.name)).toEqual(['Golpe Forte', 'Postura Defensiva', 'Atordoamento']);
  });

  it('Postura Defensiva: a self-buff (no target) lasting its full duration, then expiring', () => {
    const sim = new Sim(7);
    // Flee to an empty corner first so stray wolves can't end the buff early by
    // killing us — the buff timer itself is independent of movement.
    const fleeStep = () => {
      const p = player(sim);
      sim.sendCommand({ t: 'move', dx: WORLD_HALF - p.x, dz: WORLD_HALF - p.z });
      sim.step();
    };
    for (let i = 0; i < 60; i++) fleeStep();

    const p0 = player(sim);
    sim.sendCommand({ t: 'move', dx: WORLD_HALF - p0.x, dz: WORLD_HALF - p0.z });
    sim.sendCommand({ t: 'use-ability', slot: 2 }); // a buff: castable with no enemy target
    sim.step();
    const castTick = sim.tick;
    expect(player(sim).statuses).toContain('defense');

    // pin the 6s (120t) duration on both edges
    while (sim.tick < castTick + 120 - 1) fleeStep();
    expect(player(sim).statuses).toContain('defense');
    fleeStep(); // -> cast + 120
    expect(player(sim).statuses).not.toContain('defense');
  });

  it('Postura Defensiva halves incoming damage (a braced player loses fewer HP)', () => {
    // Same seed + identical movement => identical wolf bites; the ONLY difference
    // between the two runs is the mitigation buff, so any HP gap IS the buff.
    const run = (brace: boolean) => {
      const sim = new Sim(7);
      approachUntilAggro(sim); // walk in until a wolf aggros (deterministic, no target set)
      if (brace) sim.sendCommand({ t: 'use-ability', slot: 2 });
      sim.sendCommand({ t: 'stop' });
      for (let i = 0; i < 100; i++) sim.step(); // stand and take bites, inside the 6s buff
      return player(sim);
    };
    const guarded = run(true);
    const exposed = run(false);
    expect(exposed.hp).toBeLessThan(exposed.maxHp); // the wolf actually landed hits (test is meaningful)
    expect(guarded.hp).toBeGreaterThan(exposed.hp); // bracing mitigated the damage taken
  });
});

// Buy the Lança de Ferro from the vendor (it isn't a drop) and equip it, switching
// the character to the Spear mastery. Farms the gold first; all deterministic.
function equipSpear(sim: Sim): void {
  const playerOf = () => sim.entities().find((e) => e.kind === 'player')!;
  const price = VENDOR_STOCK.find((s) => s.itemId === 'iron_spear')!.price;
  let guard = 0;
  while (playerOf().gold < price && guard++ < 400) killNearestEnemy(sim);
  for (let i = 0; i < 800 && !sim.shop().inRange; i++) {
    const p = playerOf();
    sim.sendCommand({ t: 'move', dx: VENDOR_SPAWN_X - p.x, dz: VENDOR_SPAWN_Z - p.z });
    sim.step();
  }
  sim.sendCommand({ t: 'set-target', id: null });
  sim.sendCommand({ t: 'buy', itemId: 'iron_spear' });
  sim.sendCommand({ t: 'stop' });
  sim.step();
  const spear = sim.inventory().stacks.find((s) => s.itemId === 'iron_spear');
  if (spear) {
    sim.sendCommand({ t: 'equip', itemId: 'iron_spear', rarity: spear.rarity, plus: spear.plus });
    sim.step();
  }
  restoreToFull(sim); // farming can leave the player hurt (tougher humanoid respawns); reset to a clean full-HP baseline
}

// The Lança mastery: equipping a spear swaps the whole kit (area + crit), grants
// a +HP passive, and unlocks the Estocada/Varredura/Investida/Fúria abilities.
describe('spear mastery (Lança)', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const findBoss = (sim: Sim) => sim.entities().find((e) => e.boss);
  const nearestWolf = (sim: Sim) => {
    const p = player(sim);
    const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss && e.hp > 0 && e.species === 'skeleton_minion');
    wolves.sort((a, b) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
    return wolves[0];
  };

  it('equipping a spear swaps the action bar to the Lança kit; unequipping restores the sword', () => {
    const sim = new Sim(7);
    expect(sim.abilities().map((a) => a.name)).toEqual(['Golpe Forte', 'Postura Defensiva', 'Atordoamento']);
    equipSpear(sim);
    expect(sim.inventory().equipment.find((e) => e.slot === 'weapon')!.itemId).toBe('iron_spear');
    expect(sim.abilities().map((a) => a.name)).toEqual(['Estocada', 'Varredura', 'Investida', 'Fúria']);
    sim.sendCommand({ t: 'unequip', slot: 'weapon' });
    sim.step();
    expect(sim.abilities().map((a) => a.name)).toEqual(['Golpe Forte', 'Postura Defensiva', 'Atordoamento']);
  });

  it('the Lança passive raises max HP while the spear is equipped', () => {
    const sim = new Sim(7);
    equipSpear(sim);
    const withSpear = player(sim).maxHp;
    sim.sendCommand({ t: 'unequip', slot: 'weapon' });
    sim.step();
    const without = player(sim).maxHp;
    expect(withSpear - without).toBe(MASTERIES.spear.passive.maxHp); // exactly the passive (+HP)
  });

  it('Investida charges the player to the target, closing a real gap', () => {
    const sim = new Sim(7);
    equipSpear(sim);
    sim.sendCommand({ t: 'set-target', id: null });
    sim.sendCommand({ t: 'stop' });
    sim.step();
    // approach a wolf (no target -> no premature auto-attack) into the charge window
    let target: { id: number; x: number; z: number } | undefined;
    let d0 = 0;
    for (let i = 0; i < 800; i++) {
      const p = player(sim);
      const w = nearestWolf(sim);
      if (!w) { sim.step(); continue; }
      const d = Math.hypot(w.x - p.x, w.z - p.z);
      if (d > 4 && d <= 11) { target = { id: w.id, x: w.x, z: w.z }; d0 = d; break; }
      sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      sim.step();
    }
    expect(target).toBeDefined();

    sim.sendCommand({ t: 'set-target', id: target!.id });
    sim.sendCommand({ t: 'use-ability', slot: 3 }); // Investida (gap-closer)
    sim.sendCommand({ t: 'stop' }); // the dash does the moving, not a manual step
    sim.step();
    const p = player(sim);
    const dAfter = Math.hypot(target!.x - p.x, target!.z - p.z); // distance to the wolf's pre-cast spot
    expect(dAfter).toBeLessThan(d0 - 2); // closed a real gap
    expect(dAfter).toBeLessThanOrEqual(3.5); // landed within ~reach (spear range 3.0 + slack)
  });

  it('Varredura sweeps every enemy in front — one cast hits 2+ at once', () => {
    const sim = new Sim(7);
    equipSpear(sim);
    const range = MASTERIES.spear.attackRange!;
    // The rings spawn mobs in PACKS (MOBS_PER_SPOT), so clusters exist. Walk into the
    // nearest pack of ANY species and let it converge — aggroed melee mobs stack on the
    // player at reach — then sweep when 2+ sit in the cone (range + front half-plane, the
    // same gate enemiesInCone uses). One Varredura cast then damages 2+ distinct enemies.
    let hits = 0;
    for (let i = 0; i < 6000 && hits < 2; i++) {
      const p = player(sim);
      const live = sim.entities()
        .filter((e) => e.kind === 'enemy' && !e.boss && e.hp > 0)
        .sort((a, b) => ((a.x - p.x) ** 2 + (a.z - p.z) ** 2) - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
      const target = live[0]; // the nearest living mob orients (and is hit by) the cone
      if (!target) { sim.step(); continue; }
      if (Math.hypot(target.x - p.x, target.z - p.z) > range) {
        sim.sendCommand({ t: 'set-target', id: null }); // no auto-attack en route
        sim.sendCommand({ t: 'move', dx: target.x - p.x, dz: target.z - p.z });
        sim.step();
        continue;
      }
      // In reach: count how many enemies are already inside the frontal cone (facing the
      // target). Fewer than 2 → hold position a tick and let the rest of the pack close in.
      const facing = Math.atan2(target.x - p.x, target.z - p.z);
      const inCone = live.filter((e) => {
        const dx = e.x - p.x, dz = e.z - p.z, d = Math.hypot(dx, dz);
        return d <= range && (d <= 1.0 || inFrontOf(dx, dz, facing));
      });
      if (inCone.length < 2) {
        sim.sendCommand({ t: 'set-target', id: target.id });
        sim.sendCommand({ t: 'stop' });
        sim.step();
        continue;
      }
      // 2+ in the cone: anchor + sweep, then count distinct enemies hit this tick.
      const before = sim.recentEvents();
      const lastSeq = before.length ? Math.max(...before.map((e) => e.seq)) : 0;
      sim.sendCommand({ t: 'set-target', id: target.id }); // cone anchors on (and faces) this target
      sim.sendCommand({ t: 'use-ability', slot: 2 }); // Varredura (cone)
      sim.sendCommand({ t: 'stop' });
      sim.step();
      const dmg = sim.recentEvents().filter((e) => e.seq > lastSeq && e.kind === 'damage');
      hits = new Set(dmg.map((e) => e.targetId)).size; // distinct enemies damaged this tick
    }
    expect(hits).toBeGreaterThanOrEqual(2); // a cone, not a single-target strike
  });

  it('Fúria makes hits critical (the next strike deals CRIT_MULT× its normal damage)', () => {
    // Same seed + identical approach => identical base hit; the ONLY difference is
    // the crit buff, so the damage ratio is exactly CRIT_MULT. Measure the first
    // auto-attack (not GCD-gated, so Fúria can't desync the swing timing).
    const measureFirstHit = (withFury: boolean): number => {
      const sim = new Sim(7);
      equipSpear(sim);
      sim.sendCommand({ t: 'set-target', id: null });
      sim.sendCommand({ t: 'stop' });
      sim.step();
      // approach a wolf without a target (no premature auto-attack) into spear reach
      let wid = -1;
      for (let i = 0; i < 800; i++) {
        const p = player(sim);
        const w = nearestWolf(sim);
        if (!w) { sim.step(); continue; }
        if (Math.hypot(w.x - p.x, w.z - p.z) <= 2.4) { wid = w.id; break; }
        sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        sim.step();
      }
      expect(wid).not.toBe(-1);
      if (withFury) {
        sim.sendCommand({ t: 'use-ability', slot: 4 }); // Fúria: +100% crit for 5s
        sim.step();
      }
      // target it and let the FIRST auto-attack land; capture exactly that hit
      let dmg = -1;
      for (let i = 0; i < 120 && dmg < 0; i++) {
        const w = sim.entities().find((e) => e.id === wid);
        if (!w) break; // can't die before its first hit — nothing else damages it
        const p = player(sim);
        const before = sim.recentEvents();
        const lastSeq = before.length ? Math.max(...before.map((e) => e.seq)) : 0;
        sim.sendCommand({ t: 'set-target', id: wid });
        sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z }); // stay in reach + facing
        sim.step();
        const hit = sim
          .recentEvents()
          .find((e) => e.seq > lastSeq && e.kind === 'damage' && e.targetId === wid);
        if (hit) dmg = hit.amount;
      }
      return dmg;
    };
    const normal = measureFirstHit(false);
    const crit = measureFirstHit(true);
    expect(normal).toBeGreaterThan(0);
    expect(crit).toBe(normal * CRIT_MULT);
  });

  it('a critical hit is flagged on the damage event (so the UI can pop a distinct crit number)', () => {
    // Fúria gives +100% crit, so the first auto-attack after it is guaranteed to crit; the
    // presentation event must carry crit:true. A plain spear swing (no crit buff) must not.
    const firstHitCrit = (withFury: boolean): boolean | undefined => {
      const sim = new Sim(7);
      equipSpear(sim);
      sim.sendCommand({ t: 'set-target', id: null });
      sim.sendCommand({ t: 'stop' });
      sim.step();
      let wid = -1;
      for (let i = 0; i < 800; i++) {
        const p = player(sim);
        const w = nearestWolf(sim);
        if (!w) { sim.step(); continue; }
        if (Math.hypot(w.x - p.x, w.z - p.z) <= 2.4) { wid = w.id; break; }
        sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        sim.step();
      }
      expect(wid).not.toBe(-1);
      if (withFury) { sim.sendCommand({ t: 'use-ability', slot: 4 }); sim.step(); }
      for (let i = 0; i < 120; i++) {
        const w = sim.entities().find((e) => e.id === wid);
        if (!w) break;
        const p = player(sim);
        const before = sim.recentEvents();
        const lastSeq = before.length ? Math.max(...before.map((e) => e.seq)) : 0;
        sim.sendCommand({ t: 'set-target', id: wid });
        sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        sim.step();
        const hit = sim.recentEvents().find((e) => e.seq > lastSeq && e.kind === 'damage' && e.targetId === wid);
        if (hit) return hit.crit;
      }
      return undefined;
    };
    expect(firstHitCrit(true)).toBe(true); // Fúria => the event is flagged crit
    expect(firstHitCrit(false)).toBeFalsy(); // a normal swing carries no crit flag
  });

  it('Estocada knocks a target down (proven on the high-HP boss, which survives the hit)', () => {
    const sim = new Sim(7);
    equipSpear(sim);
    while (!findBoss(sim)) sim.step(); // wait for the world boss — tanky enough to survive Estocada
    const bossId = findBoss(sim)!.id;
    let knocked = false;
    for (let i = 0; i < 800 && !knocked; i++) {
      const b = sim.entities().find((e) => e.id === bossId);
      if (!b) break;
      const p = player(sim);
      sim.sendCommand({ t: 'set-target', id: bossId });
      sim.sendCommand({ t: 'move', dx: b.x - p.x, dz: b.z - p.z });
      sim.sendCommand({ t: 'use-ability', slot: 1 }); // Estocada
      sim.step();
      const bb = sim.entities().find((e) => e.id === bossId);
      if (bb && bb.statuses.includes('knockdown')) knocked = true;
    }
    expect(knocked).toBe(true);
  });

  it('an equipped-spear run is deterministic (same seed => identical world)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      equipSpear(sim);
      for (let i = 0; i < 200; i++) {
        sim.sendCommand({ t: 'use-ability', slot: 4 }); // Fúria (crit rolls touch the Rng)
        sim.sendCommand({ t: 'use-ability', slot: 1 }); // Estocada
        const p = player(sim);
        const w = nearestWolf(sim);
        if (w) {
          sim.sendCommand({ t: 'set-target', id: w.id });
          sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        }
        sim.step();
      }
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

// Buy the Arco Curto from the vendor and equip it, switching to the Bow mastery.
function equipBow(sim: Sim): void {
  const playerOf = () => sim.entities().find((e) => e.kind === 'player')!;
  const price = VENDOR_STOCK.find((s) => s.itemId === 'short_bow')!.price;
  let guard = 0;
  while (playerOf().gold < price && guard++ < 400) killNearestEnemy(sim);
  for (let i = 0; i < 800 && !sim.shop().inRange; i++) {
    const p = playerOf();
    sim.sendCommand({ t: 'move', dx: VENDOR_SPAWN_X - p.x, dz: VENDOR_SPAWN_Z - p.z });
    sim.step();
  }
  sim.sendCommand({ t: 'set-target', id: null });
  sim.sendCommand({ t: 'buy', itemId: 'short_bow' });
  sim.sendCommand({ t: 'stop' });
  sim.step();
  const bow = sim.inventory().stacks.find((s) => s.itemId === 'short_bow');
  if (bow) {
    sim.sendCommand({ t: 'equip', itemId: 'short_bow', rarity: bow.rarity, plus: bow.plus });
    sim.step();
  }
  restoreToFull(sim); // farming can leave the player hurt (tougher humanoid respawns); reset to a clean full-HP baseline
}

// The Arco mastery: a ranged auto-attack ("auto-shot") that fires from afar, a
// precision crit passive, and a kiting kit (Tiro Carregado / Múltiplo / Lento).
describe('bow mastery (Arco)', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const nearestWolf = (sim: Sim) => {
    const p = player(sim);
    const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss && e.hp > 0 && e.species === 'skeleton_minion');
    wolves.sort((a, b) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
    return wolves[0];
  };

  it('equipping a bow swaps the action bar to the Arco kit', () => {
    const sim = new Sim(7);
    equipBow(sim);
    expect(sim.inventory().equipment.find((e) => e.slot === 'weapon')!.itemId).toBe('short_bow');
    expect(sim.abilities().map((a) => a.name)).toEqual(['Tiro Carregado', 'Tiro Múltiplo', 'Tiro Lento']);
  });

  it('the auto-shot is ranged: it strikes from well beyond melee range', () => {
    const sim = new Sim(7);
    equipBow(sim);
    sim.sendCommand({ t: 'set-target', id: null });
    sim.sendCommand({ t: 'stop' });
    sim.step();
    // approach a wolf into bow range but stay clear of melee
    let wid = -1;
    for (let i = 0; i < 800; i++) {
      const p = player(sim);
      const w = nearestWolf(sim);
      if (!w) { sim.step(); continue; }
      if (Math.hypot(w.x - p.x, w.z - p.z) <= 10) { wid = w.id; break; }
      sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      sim.step();
    }
    expect(wid).not.toBe(-1);
    // target it and stand: the auto-shot should land while still out of melee
    let hitDist = -1;
    for (let i = 0; i < 120 && hitDist < 0; i++) {
      const w = sim.entities().find((e) => e.id === wid);
      if (!w) break;
      const before = sim.recentEvents();
      const lastSeq = before.length ? Math.max(...before.map((e) => e.seq)) : 0;
      sim.sendCommand({ t: 'set-target', id: wid });
      sim.sendCommand({ t: 'stop' });
      sim.step();
      const hit = sim.recentEvents().find((e) => e.seq > lastSeq && e.kind === 'damage' && e.targetId === wid);
      if (hit) {
        const p = player(sim);
        const ww = sim.entities().find((e) => e.id === wid);
        hitDist = ww ? Math.hypot(ww.x - p.x, ww.z - p.z) : 99;
      }
    }
    expect(hitDist).toBeGreaterThan(MELEE_RANGE); // a shot, not a melee swing
  });

  it('Tiro Lento applies a slow to its target', () => {
    const sim = new Sim(7);
    equipBow(sim);
    // castWolf casts slot 3 (Tiro Lento here) and returns a wolf that survived
    // carrying a status — it retries past any precision-crit that would kill it.
    const wid = castWolf(sim, 3);
    expect(wid).not.toBeNull();
    expect(sim.entities().find((e) => e.id === wid)!.statuses).toContain('slow');
  });

  it('Tiro Múltiplo is a volley — one cast hits 2+ enemies at range', () => {
    const sim = new Sim(7);
    equipBow(sim);
    const range = MASTERIES.bow.attackRange!;
    // Anchor the volley on the nearest mob of ANY species (each ring is now one species, so
    // fresh same-species packs sit a ring out from the farmed starter ring). With the long
    // bow range a pack easily puts 2+ in the firing arc; the volley then hits them all.
    let hits = 0;
    for (let i = 0; i < 4000 && hits < 2; i++) {
      const p = player(sim);
      const w = sim.entities()
        .filter((e) => e.kind === 'enemy' && !e.boss && e.hp > 0)
        .sort((a, b) => ((a.x - p.x) ** 2 + (a.z - p.z) ** 2) - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2))[0];
      if (!w) { sim.step(); continue; }
      const facing = Math.atan2(w.x - p.x, w.z - p.z);
      const inArc = sim.entities().filter((e) => {
        if (e.kind !== 'enemy' || e.boss || e.hp <= 0) return false;
        const dx = e.x - p.x;
        const dz = e.z - p.z;
        const d = Math.hypot(dx, dz);
        return d <= range && (d <= 1.0 || inFrontOf(dx, dz, facing));
      });
      if (inArc.length >= 2) {
        const before = sim.recentEvents();
        const lastSeq = before.length ? Math.max(...before.map((e) => e.seq)) : 0;
        sim.sendCommand({ t: 'set-target', id: w.id });
        sim.sendCommand({ t: 'use-ability', slot: 2 }); // Tiro Múltiplo (volley)
        sim.sendCommand({ t: 'stop' });
        sim.step();
        const dmg = sim.recentEvents().filter((e) => e.seq > lastSeq && e.kind === 'damage');
        hits = new Set(dmg.map((e) => e.targetId)).size;
      } else {
        sim.sendCommand({ t: 'set-target', id: null });
        sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        sim.step();
      }
    }
    expect(hits).toBeGreaterThanOrEqual(2);
  });

  it('the precision passive lands occasional critical auto-shots (mix of base + 2x hits)', () => {
    const sim = new Sim(7);
    equipBow(sim);
    const amounts = new Set<number>();
    let lastSeq = 0;
    // farm with auto-shots only (no abilities); record the damage the player deals
    for (let i = 0; i < 4000 && amounts.size < 2; i++) {
      const p = player(sim);
      const w = nearestWolf(sim);
      if (w) {
        sim.sendCommand({ t: 'set-target', id: w.id });
        sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      }
      sim.step();
      const pid = player(sim).id;
      for (const ev of sim.recentEvents()) {
        if (ev.seq <= lastSeq) continue;
        lastSeq = ev.seq;
        if (ev.kind === 'damage' && ev.targetId !== pid) amounts.add(ev.amount);
      }
    }
    const pp = player(sim);
    const base = meleeDamage(pp.str, pp.weaponDamage);
    expect(amounts.has(base)).toBe(true); // ordinary shots
    expect(amounts.has(base * CRIT_MULT)).toBe(true); // and precision crits
  });

  it('an equipped-bow run is deterministic (same seed => identical world)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      equipBow(sim);
      for (let i = 0; i < 200; i++) {
        const p = player(sim);
        const w = nearestWolf(sim);
        if (w) {
          sim.sendCommand({ t: 'set-target', id: w.id });
          sim.sendCommand({ t: 'use-ability', slot: 1 }); // Tiro Carregado (crit rolls touch the Rng)
          sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        }
        sim.step();
      }
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

// Champion & Elite tiers: the starting pack is baseline, but reinforcements roll
// occasional tougher tiers (more HP/damage/reward, drawn bigger).
describe('enemy tiers (champion & elite)', () => {
  // These tier tests assert HP/damage scaled off the grey wolf, so they look at the
  // wolf species specifically (the world now also spawns humanoid species).
  const wolves = (sim: Sim) => sim.entities().filter((e) => e.kind === 'enemy' && !e.boss && e.species === 'skeleton_minion');

  it('the starting pack is all baseline; respawns introduce tougher tiers', () => {
    const sim = new Sim(7);
    expect(wolves(sim).every((w) => w.tier === 'normal')).toBe(true);
    // each wolf's max HP matches its RING's level scaling (ring1 = base 40; deeper rings scale up)
    expect(wolves(sim).every((w) => w.maxHp === Math.round(ENEMY_TEMPLATE.hp * levelHpMult(w.level)))).toBe(true);

    // farm so the map churns reinforcements in; catch the first tiered wolf
    let tiered: { tier: string; maxHp: number; str: number } | undefined;
    for (let i = 0; i < 300 && !tiered; i++) {
      killNearestEnemy(sim);
      tiered = wolves(sim).find((w) => w.tier !== 'normal');
    }
    expect(tiered).toBeDefined();
    expect(['champion', 'elite']).toContain(tiered!.tier);
    expect(tiered!.maxHp).toBeGreaterThan(ENEMY_TEMPLATE.hp); // tougher than a baseline wolf
  });

  it('a tiered wolf has HP and damage scaled by its tier multipliers', () => {
    const sim = new Sim(7);
    let tiered: { tier: string; maxHp: number; str: number } | undefined;
    for (let i = 0; i < 300 && !tiered; i++) {
      killNearestEnemy(sim);
      tiered = wolves(sim).find((w) => w.tier !== 'normal');
    }
    expect(tiered).toBeDefined();
    const def = ENEMY_TIERS.find((t) => t.id === tiered!.tier)!;
    expect(def.hpMult).toBeGreaterThan(1);
    expect(tiered!.maxHp).toBe(Math.round(ENEMY_TEMPLATE.hp * def.hpMult)); // HP scaled
    expect(tiered!.str).toBe(Math.round(ENEMY_TEMPLATE.str * def.damageMult)); // bites harder
  });

  it('the tier system is deterministic (same seed => identical world)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      for (let i = 0; i < 60; i++) killNearestEnemy(sim); // farm so respawns roll tiers
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

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
    const maxHpBefore = before.maxHp;
    const hpBefore = before.hp;
    sim.sendCommand({ t: 'spend-attr', attr: 'str' });
    sim.step();
    const after = player(sim);
    expect(after.attrPoints).toBe(ptsBefore - 1); // one point spent
    expect(after.str).toBe(strBefore + ATTR_STR_PER_POINT); // Strength rose
    expect(meleeDamage(after.str, after.weaponDamage)).toBe(dmgBefore + 1); // a clean, exact +1 damage
    expect(after.maxHp).toBe(maxHpBefore + ATTR_STR_PER_POINT * STR_TO_HP); // Strength raised max HP
    expect(after.int).toBe(intBefore); // didn't leak into Intelligence...
    expect(after.maxMp).toBe(maxMpBefore); // ...or MP
    expect(after.hp).toBe(hpBefore); // and did NOT wrongly heal/change HP (only the cap rose)
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

    // exactly enough WOLF kills to cross the level-1 threshold (50 XP / 25 = 2 wolves)
    const kills = Math.ceil(xpForLevel(1) / ENEMY_TEMPLATE.xp);
    for (let i = 0; i < kills; i++) expect(killNearestEnemy(sim, 'skeleton_minion')).toBe(true);

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

    // one more WOLF kill: XP accumulates again toward level 3 (the HUD bar refills)
    expect(killNearestEnemy(sim, 'skeleton_minion')).toBe(true);
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
    // LF-S4: gold still goes to the killer; items now spawn as ground-loot entities (FFA), not the bag.
    const lootAfter = (seed: number, kills: number) => {
      const sim = new Sim(seed);
      for (let i = 0; i < kills; i++) killNearestEnemy(sim);
      const gold = sim.entities().find((e) => e.kind === 'player')!.gold;
      const ground = sim.entities().filter((e) => e.kind === 'loot');
      return { gold, ground };
    };

    // one kill -> always some gold, within the template's range
    const one = lootAfter(7, 1);
    expect(one.gold).toBeGreaterThanOrEqual(ENEMY_TEMPLATE.goldMin);
    expect(one.gold).toBeLessThanOrEqual(ENEMY_TEMPLATE.goldMax);

    // over a dozen kills: at least one item spawns as GROUND loot, each a valid drop-table item with
    // its display name resolved from ITEMS (what the HUD renders), dropped un-enhanced.
    const many = lootAfter(7, 12);
    expect(many.ground.length).toBeGreaterThan(0);
    // 12 kills can range from ring 1 into ring 2, so validate against the UNION of every species' drop
    // table (any valid drop-table item is fine — not just the Lacaio's).
    const dropIds = ENEMY_SPECIES.flatMap((s) => s.drops.map((d) => d.itemId));
    for (const g of many.ground) {
      expect(g.loot).toBeTruthy();
      expect(dropIds).toContain(g.loot!.itemId);
      expect(g.loot!.qty).toBeGreaterThan(0);
      expect(g.loot!.name).toBe(ITEMS[g.loot!.itemId].name);
      expect(['normal', 'sos', 'som', 'sun']).toContain(g.loot!.rarity); // a valid rarity
      expect(g.loot!.plus).toBe(0); // loot drops un-enhanced
    }

    // reproducible: same seed + same kills => identical gold AND ground loot
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

// Put `itemId` in the player's bag. Since LF-S4 (mob loot drops on the GROUND, not into the bag), the
// old "farm until it drops into the bag" is no longer a valid setup; inject the item directly via
// serialize/restore. The test then equips/consumes/sells it exactly as before — its real subject.
function killUntilBagHas(sim: Sim, itemId: string, _cap: number): boolean {
  const id = sim.localPlayerId()!;
  const save = sim.serializePlayer(id)!;
  save.bag = [...save.bag, { itemId, rarity: 'normal', plus: 0, qty: 1 }];
  sim.restorePlayer(id, save);
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
    expect(sim.inventory().equipment.find((e) => e.slot === 'chest')!.itemId).toBe('wolf_leather');
    expect(player(sim).maxHp).toBe(maxBefore + expectedBonus);
    expect(player(sim).hp).toBeLessThanOrEqual(player(sim).maxHp);

    sim.sendCommand({ t: 'unequip', slot: 'chest' });
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

// Put `itemId` at a specific rarity in the bag (a test that needs a KNOWN stat bonus). Post LF-S4,
// inject it directly (mob loot now lands on the ground, not the bag) instead of farming.
function killUntilBagHasRarity(sim: Sim, itemId: string, rarity: Rarity, _cap: number): boolean {
  const id = sim.localPlayerId()!;
  const save = sim.serializePlayer(id)!;
  save.bag = [...save.bag, { itemId, rarity, plus: 0, qty: 1 }];
  sim.restorePlayer(id, save);
  return sim.inventory().stacks.some((s) => s.itemId === itemId && s.rarity === rarity);
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
    // LF-S4: mob loot drops on the ground, so inject the potions + leather directly (the test's
    // subject is healing/clamping/consumption, not how the items were acquired).
    killUntilBagHasRarity(sim, 'health_potion', 'normal', 0); // injects 1
    const pid = sim.localPlayerId()!;
    const save0 = sim.serializePlayer(pid)!;
    save0.bag = [
      { itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 7 },
      { itemId: 'wolf_leather', rarity: 'normal', plus: 0, qty: 1 },
    ];
    sim.restorePlayer(pid, save0);
    expect(potionQty(sim)).toBeGreaterThanOrEqual(7);
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

  it('a Mana Potion restores MP and consumes one (the caster burst refill)', () => {
    const sim = new Sim(7);
    const pid = sim.localPlayerId()!;
    const save0 = sim.serializePlayer(pid)!;
    save0.bag = [{ itemId: 'mana_potion', rarity: 'normal', plus: 0, qty: 3 }];
    sim.restorePlayer(pid, save0);
    drainSomeMp(sim); // cast slot 1 until MP < maxMp (leaves us combat-fresh, so regen stays suppressed)
    const manaQty = () =>
      (sim.serializePlayer(pid)?.bag ?? []).filter((s) => s != null && s.itemId === 'mana_potion').reduce((n, s) => n + s!.qty, 0);
    const mpBefore = player(sim).mp;
    const qtyBefore = manaQty();
    expect(mpBefore).toBeLessThan(player(sim).maxMp); // there's an MP gap to refill
    sim.sendCommand({ t: 'use-item', itemId: 'mana_potion', rarity: 'normal', plus: 0 });
    sim.step();
    expect(player(sim).mp).toBeGreaterThan(mpBefore); // the potion restored MP
    expect(manaQty()).toBe(qtyBefore - 1); // exactly one consumed
  });

  it('refuses at full HP — no potion consumed and no cooldown armed', () => {
    const sim = new Sim(7);
    // LF-S4: inject the potions + leather directly (loot now drops on the ground, not into the bag).
    const pid = sim.localPlayerId()!;
    const save0 = sim.serializePlayer(pid)!;
    save0.bag = [
      { itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 7 },
      { itemId: 'wolf_leather', rarity: 'normal', plus: 0, qty: 1 },
    ];
    sim.restorePlayer(pid, save0);
    expect(potionQty(sim)).toBeGreaterThanOrEqual(7);
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
    // LF-S4: inject the potions + leather directly (loot now drops on the ground); setupHealGap then
    // flees + equips the injected leather (it uses the inject-based helpers now), opening the HP gap.
    const pid = sim.localPlayerId()!;
    const save0 = sim.serializePlayer(pid)!;
    save0.bag = [{ itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 3 }];
    sim.restorePlayer(pid, save0);
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
    sim.sendCommand({ t: 'unequip', slot: 'chest' });
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
    expect(potionQty(sim)).toBe(qtyEdge); // blocked: nothing consumed (the real cooldown signal)
    expect(player(sim).hp).toBeGreaterThanOrEqual(hpEdge); // unchanged by the POTION; out-of-combat regen may add a hair

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

describe('vendor (shop)', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const vendor = (sim: Sim) => sim.entities().find((e) => e.kind === 'npc')!;
  const qtyOf = (sim: Sim, id: string): number =>
    sim.inventory().stacks.filter((s) => s.itemId === id).reduce((n, s) => n + s.qty, 0);

  // Walk the player up to the vendor (into interact range). Bounded; re-issues a
  // move each tick (so it would resume even if a respawn reset the move intent).
  function goToVendor(sim: Sim): void {
    const range2 = VENDOR_INTERACT_RANGE * VENDOR_INTERACT_RANGE;
    for (let i = 0; i < 3000; i++) {
      const p = player(sim);
      const v = vendor(sim);
      const dx = v.x - p.x;
      const dz = v.z - p.z;
      if (dx * dx + dz * dz <= range2) break;
      sim.sendCommand({ t: 'move', dx, dz });
      sim.step();
    }
    sim.sendCommand({ t: 'stop' });
    sim.step();
  }

  it('spawns a vendor NPC at its fixed point; the shop is in-range only when close', () => {
    const sim = new Sim(7);
    const v = vendor(sim);
    expect(v).toBeDefined();
    expect(v.x).toBe(VENDOR_SPAWN_X);
    expect(v.z).toBe(VENDOR_SPAWN_Z);
    expect(sim.shop().stock.length).toBe(VENDOR_STOCK.length);
    expect(sim.shop().inRange).toBe(false); // player starts at (0,0), away from the vendor
    goToVendor(sim);
    expect(sim.shop().inRange).toBe(true);
  });

  it('selling a bag item adds (rarity-scaled) gold and removes it from the bag', () => {
    const sim = new Sim(7);
    expect(killUntilBagHas(sim, 'wolf_leather', 800)).toBe(true);
    goToVendor(sim);
    const leather = sim.inventory().stacks.find((s) => s.itemId === 'wolf_leather')!;
    const goldBefore = player(sim).gold;
    const qtyBefore = qtyOf(sim, 'wolf_leather');
    const expected = rarityStat(ITEMS.wolf_leather.value!, leather.rarity);
    expect(expected).toBeGreaterThan(0);
    expect(leather.sellValue).toBe(expected); // the seam's sell price == what sell() will pay

    sim.sendCommand({ t: 'sell', itemId: 'wolf_leather', rarity: leather.rarity, plus: leather.plus });
    sim.step();

    expect(player(sim).gold).toBe(goldBefore + leather.sellValue); // gold up by the shown sell value
    expect(qtyOf(sim, 'wolf_leather')).toBe(qtyBefore - 1); // one removed
  });

  it('buying an item removes gold and adds it to the bag', () => {
    const sim = new Sim(7);
    const entry = VENDOR_STOCK.find((s) => s.itemId === 'health_potion')!;
    for (let i = 0; i < 800 && player(sim).gold < entry.price; i++) killNearestEnemy(sim); // earn gold
    expect(player(sim).gold).toBeGreaterThanOrEqual(entry.price);
    goToVendor(sim);
    const goldBefore = player(sim).gold;
    const potsBefore = qtyOf(sim, 'health_potion');

    sim.sendCommand({ t: 'buy', itemId: 'health_potion' });
    sim.step();

    expect(player(sim).gold).toBe(goldBefore - entry.price); // gold down by the price
    expect(qtyOf(sim, 'health_potion')).toBe(potsBefore + 1); // item in the bag
  });

  it('cannot buy without enough gold', () => {
    const sim = new Sim(7);
    goToVendor(sim); // walked here, no kills -> 0 gold
    const entry = VENDOR_STOCK.find((s) => s.itemId === 'health_potion')!;
    expect(player(sim).gold).toBeLessThan(entry.price);
    const goldBefore = player(sim).gold;

    sim.sendCommand({ t: 'buy', itemId: 'health_potion' });
    sim.step();

    expect(player(sim).gold).toBe(goldBefore); // nothing spent
    expect(qtyOf(sim, 'health_potion')).toBe(0); // nothing bought
  });

  it('cannot trade when far from the vendor', () => {
    const sim = new Sim(7);
    const entry = VENDOR_STOCK.find((s) => s.itemId === 'health_potion')!;
    for (let i = 0; i < 800 && player(sim).gold < entry.price; i++) killNearestEnemy(sim);
    // walk well away from the vendor (toward a far corner)
    for (let i = 0; i < 120; i++) {
      const p = player(sim);
      sim.sendCommand({ t: 'move', dx: -WORLD_HALF - p.x, dz: -WORLD_HALF - p.z });
      sim.step();
    }
    sim.sendCommand({ t: 'stop' });
    sim.step();
    expect(sim.shop().inRange).toBe(false);
    const goldBefore = player(sim).gold;

    sim.sendCommand({ t: 'buy', itemId: 'health_potion' });
    sim.step();

    expect(player(sim).gold).toBe(goldBefore); // blocked: out of range
  });

  it('shop trades are part of the deterministic fingerprint', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      const entry = VENDOR_STOCK.find((s) => s.itemId === 'health_potion')!;
      for (let i = 0; i < 800 && player(sim).gold < entry.price; i++) killNearestEnemy(sim);
      goToVendor(sim);
      sim.sendCommand({ t: 'buy', itemId: 'health_potion' });
      sim.step();
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });

  it('selling scales the payout with item rarity (non-Normal pays above base)', () => {
    const sim = new Sim(7);
    // LF-S4: inject a rarer leather directly (loot now drops on the ground, not into the bag).
    killUntilBagHasRarity(sim, 'wolf_leather', 'sos', 0);
    const findLeather = () =>
      sim.inventory().stacks.find((s) => s.itemId === 'wolf_leather' && s.rarity !== 'normal');
    const leather = findLeather();
    expect(leather).toBeDefined();
    if (!leather) return;
    goToVendor(sim);
    const base = ITEMS.wolf_leather.value!;
    // expected payout from RARITIES (the source of truth), NOT the sim's own rarityStat
    const expected = Math.round(base * RARITIES.find((r) => r.id === leather.rarity)!.statMultiplier);
    expect(expected).toBeGreaterThan(base); // a non-Normal item is worth strictly MORE than base
    const goldBefore = player(sim).gold;
    sim.sendCommand({ t: 'sell', itemId: 'wolf_leather', rarity: leather.rarity, plus: leather.plus });
    sim.step();
    expect(player(sim).gold).toBe(goldBefore + expected); // paid the rarity-scaled value
  });

  it('the vendor NPC cannot be targeted, attacked, or damaged', () => {
    const sim = new Sim(7);
    const v = vendor(sim);
    const hp0 = v.hp;
    // clicking (set-target) the NPC is ignored — only living enemies are valid targets
    sim.sendCommand({ t: 'set-target', id: v.id });
    sim.step();
    expect(sim.localTargetId()).toBeNull();
    // Tab (cycle-target) never lands on the NPC
    for (let i = 0; i < 20; i++) {
      sim.sendCommand({ t: 'cycle-target' });
      sim.step();
      expect(sim.localTargetId()).not.toBe(v.id);
    }
    // combat happening around it never damages the NPC
    for (let i = 0; i < 10; i++) killNearestEnemy(sim);
    expect(vendor(sim).hp).toBe(hp0);
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
    // LF-S4: inject a Normal + a rarer Couro de Lobo directly (loot now drops on the ground).
    killUntilBagHasRarity(sim, 'wolf_leather', 'normal', 0);
    killUntilBagHasRarity(sim, 'wolf_leather', 'sos', 0);
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
  const farm = (sim: Sim, id: string, n: number, _cap: number): boolean => {
    // Post LF-S4 (mob loot drops on the ground), inject the materials directly into the bag.
    const pid = sim.localPlayerId()!;
    const save = sim.serializePlayer(pid)!;
    save.bag = [...save.bag, { itemId: id, rarity: 'normal', plus: 0, qty: n }];
    sim.restorePlayer(pid, save);
    return count(sim, id) >= n;
  };

  it('enhanceChance falls as "+" rises and the cap has 0 chance', () => {
    expect(enhanceChance(0)).toBeGreaterThan(enhanceChance(5));
    expect(enhanceChance(5)).toBeGreaterThan(enhanceChance(9));
    expect(enhanceChance(MAX_PLUS)).toBe(0); // no attempts past the cap
    // a "+N" item's bonus grows with the level (and +0 = base)
    expect(enhanceStat(10, 5)).toBeGreaterThan(enhanceStat(10, 0));
    expect(enhanceStat(10, 0)).toBe(10);
  });

  it('refining consumes an Elixir', () => {
    const sim = new Sim(7);
    equipSwordAndRest(sim);
    expect(farm(sim, 'elixir_weapon', 1, 600)).toBe(true);
    sim.sendCommand({ t: 'set-target', id: null });
    sim.sendCommand({ t: 'stop' });
    sim.step();
    const elixir0 = count(sim, 'elixir_weapon');

    sim.sendCommand({ t: 'enhance', slot: 'weapon' });
    sim.step();

    expect(count(sim, 'elixir_weapon')).toBe(elixir0 - 1); // elixir spent on the attempt
  });

  it('refining succeeds (+1, stat rises) or fails (-1), staying within [0, MAX_PLUS]', () => {
    const sim = new Sim(7);
    const ELIXIRS = 20;
    // Farm FIRST (deaths happen here), then equip a FRESH sword + flee — so the sword
    // stays at full durability through the refine loop and death-wear (GDD B8, tested
    // separately) can't confound the "+N raises damage" check.
    expect(farm(sim, 'elixir_weapon', ELIXIRS, 1500)).toBe(true);
    equipSwordAndRest(sim);
    fleeToSafety(sim);
    sim.sendCommand({ t: 'set-target', id: null });
    sim.sendCommand({ t: 'stop' });
    sim.step();
    const baseDmg = weaponDamage(sim); // damage at +0, at full durability

    let sawSuccess = false;
    let sawFail = false;
    // K4: gate the loop to the GENTLE band (plus < RISK_FLOOR), where behavior is UNCHANGED
    // (success +1, fail -1, 0->0 — never break/multi-drop). The risk band (>= RISK_FLOOR) is
    // covered deterministically by tests/enhance.test.ts (the pure resolver), so this seeded
    // loop never enters break territory and the assertions below stay valid.
    for (let i = 0; i < ELIXIRS && weaponPlus(sim) < RISK_FLOOR; i++) {
      const before = weaponPlus(sim);
      sim.sendCommand({ t: 'enhance', slot: 'weapon' });
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
      else throw new Error(`unexpected "+" change ${before} -> ${after}`);
    }
    expect(sawSuccess).toBe(true); // a success raised the "+" in the gentle band
    // sawFail is seed-dependent once the loop is gated (the band may climb to RISK_FLOOR with
    // no fail), so the "a sub-floor failure degrades by exactly 1, never breaks" guarantee is
    // asserted deterministically in tests/enhance.test.ts; the in-loop else-throw above already
    // enforces that ANY fail observed here was exactly -1.
    expect(sawSuccess || sawFail).toBe(true);
  });

  it('an enhanced "+N" survives unequip and re-equip (carried on the bag stack)', () => {
    const sim = new Sim(7);
    // Farm FIRST, then equip a FRESH sword + flee, so durability stays full both before
    // and after the unequip/re-equip (death-wear is GDD B8; this test isolates the "+N").
    expect(farm(sim, 'elixir_weapon', 12, 1000)).toBe(true);
    equipSwordAndRest(sim);
    fleeToSafety(sim);
    const sword = sim.inventory().equipment.find((e) => e.slot === 'weapon')!;
    sim.sendCommand({ t: 'set-target', id: null });
    sim.sendCommand({ t: 'stop' });
    sim.step();

    // refine until the weapon reaches at least +1
    let guard = 0;
    while (weaponPlus(sim) < 1 && count(sim, 'elixir_weapon') > 0 && guard++ < 12) {
      sim.sendCommand({ t: 'enhance', slot: 'weapon' });
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
        sim.sendCommand({ t: 'enhance', slot: 'weapon' });
        sim.step();
      }
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

describe('world boss', () => {
  // The world now has more than one boss; these tests are about the Alfa specifically,
  // so resolve it by its species id (the Warlord spawns later and far away).
  const findBoss = (sim: Sim) => sim.entities().find((e) => e.boss && e.species === 'pack_alpha');
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

  it('the defeat announcement names who landed the kill', () => {
    const sim = new Sim(7);
    while (!findBoss(sim)) sim.step();
    killBoss(sim); // the local player ("Hero") beats the Alfa to death
    const ev = sim.recentEvents().find((e) => e.kind === 'boss-defeat');
    expect(ev).toBeDefined();
    expect(ev!.text).toContain('Hero'); // the killer's name...
    expect(ev!.text).toContain(BOSS_TEMPLATE.name); // ...and the boss it slew
  });
});

// A SECOND world boss proves the registry is N-boss: it has its own template, a later
// schedule, a far spawn point, and — unlike the rooted Alfa — it CHASES the player.
describe('second boss (Senhor da Guerra)', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const findWarlord = (sim: Sim) => sim.entities().find((e) => e.boss && e.species === 'warlord');
  const wdef = BOSS_DEFS.find((d) => d.template.id === 'warlord')!;

  it('spawns on its OWN later schedule, at its own far location, with its own identity', () => {
    const sim = new Sim(7);
    expect(wdef.firstSpawnTick).toBeGreaterThan(BOSS_FIRST_SPAWN_TICK); // after the Alfa
    for (let i = 0; i < wdef.firstSpawnTick - 1; i++) sim.step();
    expect(findWarlord(sim)).toBeUndefined(); // not yet
    sim.step(); // reaches its scheduled tick
    const w = findWarlord(sim);
    expect(w).toBeDefined();
    expect(w!.name).toBe(WARLORD_TEMPLATE.name);
    expect(w!.maxHp).toBe(WARLORD_TEMPLATE.hp);
    expect(Math.hypot(w!.x - 0, w!.z - 30)).toBeGreaterThan(40); // far from the Alfa's spot (0,30)
  });

  it('is a MOVING boss: it leaves its spawn to chase a nearby player (the Alfa never would)', () => {
    const sim = new Sim(7);
    while (!findWarlord(sim)) sim.step();
    const spawnX = findWarlord(sim)!.x;
    const spawnZ = findWarlord(sim)!.z;
    // walk the player up to within the warlord's aggro range
    for (let i = 0; i < 800; i++) {
      const p = player(sim);
      const w = findWarlord(sim);
      if (!w || Math.hypot(w.x - p.x, w.z - p.z) < 10) break;
      sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      sim.step();
    }
    // stand still; an aggroed MOVING boss closes the gap, drifting off its spawn point
    sim.sendCommand({ t: 'stop' });
    for (let i = 0; i < 40; i++) sim.step();
    const w = findWarlord(sim)!;
    expect(Math.hypot(w.x - spawnX, w.z - spawnZ)).toBeGreaterThan(2);
  });

  it('runs deterministically alongside the Alfa (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      for (let i = 0; i < wdef.firstSpawnTick + 400; i++) sim.step(); // past BOTH bosses' spawns
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(99));
  });
});

// Enemies/bosses inflict status on the PLAYER (the reverse of the player's own kit):
// a slow/stun/bleed on a landed bite, rolled on a dedicated procRng so it can't
// perturb the deterministic loot/position stream.
describe('enemies apply status effects', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const findWarlord = (sim: Sim) => sim.entities().find((e) => e.boss && e.species === 'warlord');

  it('the content carries on-hit status data (Warlord slow, Alfa stun, Ladino bleed)', () => {
    expect(WARLORD_TEMPLATE.onHit?.kind).toBe('slow');
    expect(BOSS_TEMPLATE.onHit?.kind).toBe('stun');
    expect(ROGUE_TEMPLATE.onHit?.kind).toBe('dot');
    // the base skeleton must NOT debuff — it's the determinism-critical species
    expect(ENEMY_TEMPLATE.onHit).toBeUndefined();
  });

  it('a boss inflicts a status on the player (the Warlord hamstrings you on a hit)', () => {
    const sim = new Sim(7);
    while (!findWarlord(sim)) sim.step(); // advance to the Warlord
    let slowed = false;
    for (let i = 0; i < 2500 && !slowed; i++) {
      const w = findWarlord(sim);
      const p = player(sim);
      if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z }); // close in / re-approach after a death
      sim.step();
      if (player(sim).statuses.includes('slow')) slowed = true; // the Warlord's hamstring landed
    }
    expect(slowed).toBe(true);
  });

  it('enemy status procs do NOT perturb the deterministic stream (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      // fight the Warlord for a while so its slow procs fire, then fingerprint the world
      while (!findWarlord(sim)) sim.step();
      for (let i = 0; i < 1200; i++) {
        const w = findWarlord(sim);
        const p = player(sim);
        if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        sim.step();
      }
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
  });
});

// Auto-play (bot): the sim drives the player end-to-end — hunt, attack, loot,
// spend points. The whole point is a hands-off run that still earns progress,
// stays deterministic, and cleanly hands control back when toggled off.
describe('bot (auto-play)', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;

  it('off by default; the set-bot command flips it on and off', () => {
    const sim = new Sim(7);
    expect(sim.botActive()).toBe(false);
    sim.sendCommand({ t: 'set-bot', on: true });
    sim.step();
    expect(sim.botActive()).toBe(true);
    sim.sendCommand({ t: 'set-bot', on: false });
    sim.step();
    expect(sim.botActive()).toBe(false);
  });

  it('with the bot on, the player hunts on its own: earns loot + XP without hanging', () => {
    const sim = new Sim(7);
    sim.sendCommand({ t: 'set-bot', on: true });
    // Drive nothing but the clock. Every kill drops gold, so gold rising proves
    // the bot engaged and killed an enemy entirely on its own. The cap is the
    // "doesn't hang/livelock" guard — if the bot stalled, we'd hit it and fail.
    let scored = false;
    for (let i = 0; i < 4000 && !scored; i++) {
      sim.step();
      if (player(sim).gold > 0) scored = true;
    }
    const p = player(sim);
    expect(scored).toBe(true); // engaged + killed a wolf hands-off
    expect(p.gold).toBeGreaterThan(0); // loot (gold) earned
    // XP earned too: it either banked XP toward the next level or already dinged.
    expect(p.level > 1 || p.xp > 0).toBe(true);
    // It spends earned attribute points immediately, so none sit unspent.
    expect(p.attrPoints).toBe(0);
  });

  it('toggling off hands control back: the target clears and farming stops', () => {
    const sim = new Sim(7);
    sim.sendCommand({ t: 'set-bot', on: true });
    sim.step();
    for (let i = 0; i < 4000 && player(sim).gold === 0; i++) sim.step();
    expect(player(sim).gold).toBeGreaterThan(0); // it was actively farming

    sim.sendCommand({ t: 'set-bot', on: false });
    sim.step();
    expect(sim.botActive()).toBe(false);
    expect(sim.localTargetId()).toBe(null); // off clears the bot's target

    // Idle with NO commands: gold can't rise without the player attacking, so a
    // frozen total proves the sim is no longer driving the character.
    const goldFrozen = player(sim).gold;
    for (let i = 0; i < 300; i++) sim.step();
    expect(player(sim).gold).toBe(goldFrozen);
  });

  it('an auto-play run is deterministic (same seed => identical world)', () => {
    const botRun = (seed: number): string => {
      const sim = new Sim(seed);
      sim.sendCommand({ t: 'set-bot', on: true });
      for (let i = 0; i < 1500; i++) sim.step();
      return sim.hash();
    };
    expect(botRun(7)).toBe(botRun(7));
    expect(botRun(7)).not.toBe(botRun(123));
  });
});

// --- helpers for the smarter-bot (self-sufficiency) tests ---
const bagQty = (sim: Sim, itemId: string): number =>
  sim.inventory().stacks.filter((s) => s.itemId === itemId).reduce((a, s) => a + s.qty, 0);

// Walk the player INTO the nearest wolves with NO target (takes bites, never swings
// back) until HP drops below `frac` of max — bounded, and without dying. Bot OFF.
function hurtBelow(sim: Sim, frac: number): void {
  for (let i = 0; i < 4000; i++) {
    const p = sim.entities().find((e) => e.kind === 'player')!;
    if (!p.dead && p.hp < p.maxHp * frac) break;
    const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss && e.hp > 0);
    if (wolves.length) {
      wolves.sort((a, b) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
      const w = wolves[0];
      sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
    }
    sim.step();
  }
  sim.sendCommand({ t: 'stop' });
  sim.step();
}

// Walk the player to the vendor until in trading range (bot OFF).
function goToVendor(sim: Sim): void {
  for (let i = 0; i < 1500 && !sim.shop().inRange; i++) {
    const p = sim.entities().find((e) => e.kind === 'player')!;
    sim.sendCommand({ t: 'move', dx: VENDOR_SPAWN_X - p.x, dz: VENDOR_SPAWN_Z - p.z });
    sim.step();
  }
  sim.sendCommand({ t: 'stop' });
  sim.sendCommand({ t: 'set-target', id: null });
  sim.step();
}

// At the vendor: sell off every equippable item in the bag (frees slots + funds buys).
function sellAllGear(sim: Sim): void {
  for (let pass = 0; pass < 60; pass++) {
    const gear = sim.inventory().stacks.find((s) => s.equipSlot != null);
    if (!gear) break;
    sim.sendCommand({ t: 'sell', itemId: gear.itemId, rarity: gear.rarity, plus: gear.plus });
    sim.step();
  }
}

// Buy one of a vendor item (bot OFF; must already be in range and able to afford it).
function buyOne(sim: Sim, itemId: string): void {
  sim.sendCommand({ t: 'buy', itemId });
  sim.step();
}

// At the vendor: sell an item down to exactly `target` held (to neutralize drops).
function sellDownTo(sim: Sim, itemId: string, target: number): void {
  for (let pass = 0; pass < 40 && bagQty(sim, itemId) > target; pass++) {
    const s = sim.inventory().stacks.find((x) => x.itemId === itemId)!;
    sim.sendCommand({ t: 'sell', itemId, rarity: s.rarity, plus: s.plus });
    sim.step();
  }
}

// The smarter bot looks after itself: heals, gears up, sells junk, and refines its
// equipment with spare materials while always keeping a reserve. Each test sets the
// stage with plain commands (bot OFF), then flips the bot on and pins the decision.
describe('bot (auto-play): self-sufficiency', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;

  it('survival: below the heal threshold it drinks a Health Potion', () => {
    const sim = new Sim(7);
    // LF-S4: mob loot drops on the ground now, so inject the potions directly (the test's subject is
    // the bot's self-heal decision given potions, not how it acquired them — that's the bot rework).
    const pid = sim.localPlayerId()!;
    const save0 = sim.serializePlayer(pid)!;
    save0.bag = [{ itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 2 }];
    sim.restorePlayer(pid, save0);
    expect(bagQty(sim, 'health_potion')).toBeGreaterThanOrEqual(2);
    // take bites until below the heal threshold, without dying
    hurtBelow(sim, BOT_HEAL_FRAC);
    expect(player(sim).hp).toBeLessThan(player(sim).maxHp * BOT_HEAL_FRAC);
    expect(player(sim).hp).toBeGreaterThan(0);
    const hp0 = player(sim).hp;

    // top survival priority: it quaffs a potion -> a heal event fires and HP jumps up
    // (assert the heal, not the bag count: the same tick it may also loot a potion)
    sim.sendCommand({ t: 'set-bot', on: true });
    sim.step();
    expect(sim.recentEvents().some((e) => e.kind === 'heal')).toBe(true);
    expect(player(sim).hp).toBeGreaterThan(hp0);
  });

  it('inventory: it auto-equips a looted upgrade (empty armor slot -> Couro de Lobo, raising max HP)', () => {
    const sim = new Sim(7);
    // LF-S4: inject the armor directly (loot now drops on the ground); the bot then auto-equips it from
    // the bag — the equip-the-upgrade decision is the subject (bag acquisition is the bot rework).
    const pid = sim.localPlayerId()!;
    const save0 = sim.serializePlayer(pid)!;
    save0.bag = [{ itemId: 'wolf_leather', rarity: 'normal', plus: 0, qty: 1 }];
    sim.restorePlayer(pid, save0);
    expect(bagQty(sim, 'wolf_leather')).toBeGreaterThanOrEqual(1);
    expect(sim.inventory().equipment.find((e) => e.slot === 'chest')!.itemId).toBeNull();
    const maxHp0 = player(sim).maxHp;

    sim.sendCommand({ t: 'set-bot', on: true });
    for (let i = 0; i < 12; i++) sim.step();

    expect(sim.inventory().equipment.find((e) => e.slot === 'chest')!.itemId).toBe('wolf_leather');
    expect(player(sim).maxHp).toBeGreaterThan(maxHp0); // the +HP armor is now folded in
  });

  it('evolution: with spare materials in a safe lull, it enhances its equipped gear (keeping a reserve)', () => {
    const sim = new Sim(7);
    // LF-S4: inject the armor + gold directly (loot now drops on the ground). The bot's enhance
    // decision with a surplus is the subject (acquisition is the upcoming bot rework).
    const pid = sim.localPlayerId()!;
    const save0 = sim.serializePlayer(pid)!;
    save0.bag = [{ itemId: 'wolf_leather', rarity: 'normal', plus: 0, qty: 1 }];
    save0.gold = 250;
    sim.restorePlayer(pid, save0);
    const lea = sim.inventory().stacks.find((s) => s.itemId === 'wolf_leather')!;
    expect(lea).toBeDefined();
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: lea.rarity, plus: lea.plus });
    sim.step();
    // sell the rest of the gear for room + gold, then stock SPARE Armor Elixirs (above
    // the reserve) + a few potions so it won't make a vendor run instead of enhancing
    goToVendor(sim);
    sellAllGear(sim);
    for (let i = 0; i < BOT_MATERIAL_RESERVE + 2; i++) buyOne(sim, 'elixir_armor');
    for (let i = 0; i < 3; i++) buyOne(sim, 'health_potion');
    expect(bagQty(sim, 'elixir_armor')).toBeGreaterThan(BOT_MATERIAL_RESERVE);

    // step away to a lull and let the bot run: it attempts a refine (an enhance event)
    fleeToSafety(sim);
    sim.sendCommand({ t: 'set-bot', on: true });
    let enhanced = false;
    for (let i = 0; i < 24 && !enhanced; i++) {
      sim.step();
      enhanced = sim.recentEvents().some((e) => e.kind === 'enhance-success' || e.kind === 'enhance-fail');
    }
    expect(enhanced).toBe(true); // it spent a surplus Elixir on an enhance attempt
    expect(bagQty(sim, 'elixir_armor')).toBeGreaterThanOrEqual(BOT_MATERIAL_RESERVE); // reserve kept
  });

  it('evolution: it never enhances down past the material reserve', () => {
    const sim = new Sim(7);
    // LF-S4: inject the armor + gold directly (loot now drops on the ground).
    const pid = sim.localPlayerId()!;
    const save0 = sim.serializePlayer(pid)!;
    save0.bag = [{ itemId: 'wolf_leather', rarity: 'normal', plus: 0, qty: 1 }];
    save0.gold = 160;
    sim.restorePlayer(pid, save0);
    const lea = sim.inventory().stacks.find((s) => s.itemId === 'wolf_leather')!;
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: lea.rarity, plus: lea.plus });
    sim.step();
    goToVendor(sim);
    sellAllGear(sim);
    sellDownTo(sim, 'elixir_armor', 0); // dump any Elixirs that dropped while farming
    for (let i = 0; i < BOT_MATERIAL_RESERVE; i++) buyOne(sim, 'elixir_armor'); // hold EXACTLY the reserve
    for (let i = 0; i < 3; i++) buyOne(sim, 'health_potion');
    expect(bagQty(sim, 'elixir_armor')).toBe(BOT_MATERIAL_RESERVE);

    // a safe lull holding only the reserve: it's IN the enhance path but must not spend
    fleeToSafety(sim);
    sim.sendCommand({ t: 'set-bot', on: true });
    for (let i = 0; i < 12; i++) sim.step();
    expect(bagQty(sim, 'elixir_armor')).toBe(BOT_MATERIAL_RESERVE); // reserve untouched
    expect(sim.recentEvents().some((e) => e.kind === 'enhance-success' || e.kind === 'enhance-fail')).toBe(false);
  });

  it('scavenge: o bot anda até o loot do chão e pega (BR-S1, pós loot físico)', () => {
    const sim = new Sim(7);
    // farma mobs (bot OFF) até cair loot no chão — o loot cai onde o mob morre, perto de onde o player parou
    for (let i = 0; i < 300 && sim.entities().filter((e) => e.kind === 'loot').length === 0; i++) killNearestEnemy(sim);
    const before = new Set(sim.entities().filter((e) => e.kind === 'loot').map((e) => e.id));
    expect(before.size).toBeGreaterThan(0); // há loot no chão pra recolher
    sim.sendCommand({ t: 'set-bot', on: true }); // liga o auto-play
    for (let i = 0; i < 1500; i++) sim.step();
    const after = new Set(sim.entities().filter((e) => e.kind === 'loot').map((e) => e.id));
    // dentro de 1500 ticks (<< 6000 do despawn), o bot recolheu ao menos um dos loots originais (não sumiu sozinho)
    expect([...before].some((id) => !after.has(id))).toBe(true);
  });

  it('progressão: o bot de nível alto migra pra rings externos, saindo pelo portão (BR-S2 + BR-S3)', () => {
    const sim = new Sim(7);
    const pid = sim.localPlayerId()!;
    // nível 10 (alvo = ring10, cheb ~135) + bolsa de poções e MUITO HP pra aguentar a travessia sob ataque;
    // nasce na vila central (0,0), então só chega aos rings externos se DECIDIR viajar pra fora (BR-S3) e
    // cruzar o muro pelo portão (BR-S2) em vez de raspar a muralha.
    const save0 = sim.serializePlayer(pid)!;
    save0.level = 10;
    save0.baseMaxHp = 4000;
    save0.bag = [{ itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 40 }];
    sim.restorePlayer(pid, save0);
    const cheb = (e: { x: number; z: number }) => Math.max(Math.abs(e.x), Math.abs(e.z));
    expect(cheb(player(sim))).toBeLessThan(30); // começa DENTRO da vila

    sim.sendCommand({ t: 'set-bot', on: true });
    let maxCheb = 0;
    for (let i = 0; i < 4000; i++) {
      sim.step();
      maxCheb = Math.max(maxCheb, cheb(player(sim)));
    }
    // aventurou-se bem além da vila e do ring1 (cheb 60 = borda ring1/ring2) rumo ao ring10 — só possível
    // saindo pelo portão (se ficasse preso no muro, maxCheb travaria perto de 26)
    expect(maxCheb).toBeGreaterThan(60);
  });

  it('progressão por nível: no mesmo tempo, um bot nível 10 se aventura MUITO mais longe que um nível 1 (BR-S3)', () => {
    const cheb = (e: { x: number; z: number }) => Math.max(Math.abs(e.x), Math.abs(e.z));
    // Roda um bot do nível dado, robusto (não morre na travessia), e devolve o cheb máximo alcançado.
    const runMaxCheb = (level: number): number => {
      const sim = new Sim(7);
      const pid = sim.localPlayerId()!;
      const save0 = sim.serializePlayer(pid)!;
      save0.level = level;
      save0.baseMaxHp = 4000;
      save0.bag = [{ itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 40 }];
      sim.restorePlayer(pid, save0);
      sim.sendCommand({ t: 'set-bot', on: true });
      let m = 0;
      for (let i = 0; i < 900; i++) {
        sim.step();
        m = Math.max(m, cheb(player(sim)));
      }
      return m;
    };
    const low = runMaxCheb(1);
    const high = runMaxCheb(10);
    // o nível 1 sai da vila pra caçar (ring1 começa em cheb 30) mas fica perto; o nível 10 beelina pra fora
    // rumo ao ring10 (cheb ~135) — a distância é GATED pelo nível, que é todo o ponto do BR-S3
    expect(low).toBeGreaterThan(30);
    expect(high).toBeGreaterThan(low + 40);
  });
});

// Approach the nearest wolf WITHOUT a target (so no auto-attack pre-damages it),
// then cast the slot-1 ability and return the damage it dealt (its damage event).
function castSlot1Damage(sim: Sim): number {
  for (let i = 0; i < 2000; i++) {
    const p = sim.entities().find((e) => e.kind === 'player')!;
    const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss && e.hp > 0);
    if (wolves.length === 0) { sim.step(); continue; }
    wolves.sort((a, b) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
    const w = wolves[0];
    if (Math.hypot(w.x - p.x, w.z - p.z) > MELEE_RANGE) {
      sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      sim.step();
    } else {
      const lastSeq = sim.recentEvents().reduce((m, e) => Math.max(m, e.seq), 0);
      sim.sendCommand({ t: 'set-target', id: w.id });
      sim.sendCommand({ t: 'use-ability', slot: 1 });
      sim.sendCommand({ t: 'set-target', id: null }); // drop so no auto-attack confounds the hit
      sim.sendCommand({ t: 'stop' });
      sim.step();
      const dmg = sim
        .recentEvents()
        .filter((e) => e.seq > lastSeq && e.kind === 'damage' && e.targetId === w.id);
      if (dmg.length) return Math.max(...dmg.map((e) => e.amount));
    }
  }
  return -1;
}

// SP / skill ranks (GDD B4): mobs grant a second currency the player spends to raise
// an ability's rank, which makes it hit harder and its effects last longer.
describe('SP and skill ranks', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const slot1 = (sim: Sim) => sim.abilities().find((a) => a.slot === 1)!;

  it('killing a mob grants SP', () => {
    const sim = new Sim(7);
    expect(player(sim).sp).toBe(0);
    expect(killNearestEnemy(sim, 'skeleton_minion')).toBe(true);
    expect(player(sim).sp).toBeGreaterThanOrEqual(ENEMY_TEMPLATE.sp); // at least a normal wolf's SP
  });

  it('ranking up an ability spends the exact SP and raises its rank', () => {
    const sim = new Sim(7);
    let g = 0;
    while (player(sim).sp < SKILL_SP_COST[0] && g++ < 200) killNearestEnemy(sim);
    expect(player(sim).sp).toBeGreaterThanOrEqual(SKILL_SP_COST[0]);
    expect(slot1(sim).rank).toBe(1);
    expect(slot1(sim).rankCost).toBe(SKILL_SP_COST[0]);
    const sp0 = player(sim).sp;

    sim.sendCommand({ t: 'rank-up', slot: 1 });
    sim.step();

    expect(player(sim).sp).toBe(sp0 - SKILL_SP_COST[0]); // spent exactly the cost
    expect(slot1(sim).rank).toBe(2); // rank rose
  });

  it('a higher-rank ability hits harder (rank 2 Golpe Forte > rank 1)', () => {
    // Same seed + same farming (no manual equip/attr spend, so str/weapon are equal in
    // both runs); the ONLY difference is the rank, so any damage gap IS the rank.
    const measure = (rankUp: boolean): number => {
      const sim = new Sim(7);
      let g = 0;
      while (player(sim).sp < SKILL_SP_COST[0] && g++ < 200) killNearestEnemy(sim);
      if (rankUp) {
        sim.sendCommand({ t: 'rank-up', slot: 1 });
        sim.step();
      }
      return castSlot1Damage(sim);
    };
    const r1 = measure(false);
    const r2 = measure(true);
    expect(r1).toBeGreaterThan(0);
    expect(r2).toBeGreaterThan(r1); // ranking up increased the ability's damage
  });

  it('refuses to rank up without enough SP (nothing spent, rank unchanged)', () => {
    const sim = new Sim(7);
    expect(player(sim).sp).toBe(0); // fresh — no SP yet
    expect(slot1(sim).rank).toBe(1);
    sim.sendCommand({ t: 'rank-up', slot: 1 });
    sim.step();
    expect(player(sim).sp).toBe(0); // not charged
    expect(slot1(sim).rank).toBe(1); // still rank 1
  });

  it('rank stops at the cap (no further cost or spend)', () => {
    const sim = new Sim(7);
    const total = SKILL_SP_COST.reduce((a, c) => a + c, 0); // SP to max one ability
    let g = 0;
    while (player(sim).sp < total && g++ < 800) killNearestEnemy(sim);
    expect(player(sim).sp).toBeGreaterThanOrEqual(total);
    fleeToSafety(sim); // rank up from safety (not dead/stunned)

    for (let i = 0; i < SKILL_MAX_RANK + 2; i++) {
      sim.sendCommand({ t: 'rank-up', slot: 1 });
      sim.step();
    }
    expect(slot1(sim).rank).toBe(SKILL_MAX_RANK); // capped, not beyond
    expect(slot1(sim).rankCost).toBe(0); // no cost at the cap

    const spAtCap = player(sim).sp;
    sim.sendCommand({ t: 'rank-up', slot: 1 });
    sim.step();
    expect(player(sim).sp).toBe(spAtCap); // a press at the cap spends nothing
  });

  it('the auto-play bot raises its ability ranks as it earns SP', () => {
    const sim = new Sim(7);
    sim.sendCommand({ t: 'set-bot', on: true });
    for (let i = 0; i < 4000; i++) sim.step();
    const maxRank = Math.max(...sim.abilities().map((a) => a.rank));
    expect(maxRank).toBeGreaterThan(1); // it spent SP to rank up on its own
  });
});

// Drive the player into wolves until it dies once, then wait out the respawn so the
// world is back to a live player WITH the death penalty applied.
function dieOnceAndRespawn(sim: Sim): void {
  driveIntoWolvesUntilDead(sim);
  for (
    let i = 0;
    i < DEATH_RESPAWN_TICKS + 10 && sim.entities().find((e) => e.kind === 'player')!.dead;
    i++
  ) {
    sim.step();
  }
}

// Death penalty (GDD B8): dying wears down equipped gear; worn gear gives less of its
// bonus until repaired at the vendor for gold. Gentle — never breaks, fully restorable.
describe('death penalty (durability / repair)', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const armor = (sim: Sim) => sim.inventory().equipment.find((e) => e.slot === 'chest')!;

  // Equip a freshly-looted Couro de Lobo (armor) at full durability.
  const equipFreshArmor = (sim: Sim): void => {
    // Post LF-S4 (mob loot drops on the ground), inject the armor directly into the bag, then equip it.
    const pid = sim.localPlayerId()!;
    const save = sim.serializePlayer(pid)!;
    save.bag = [...save.bag, { itemId: 'wolf_leather', rarity: 'normal', plus: 0, qty: 1 }];
    sim.restorePlayer(pid, save);
    const lea = sim.inventory().stacks.find((s) => s.itemId === 'wolf_leather')!;
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: lea.rarity, plus: lea.plus });
    sim.step();
  };

  it('durabilityFactor: full at/above the threshold, gentle non-zero floor at 0', () => {
    expect(durabilityFactor(MAX_DURABILITY)).toBe(1);
    expect(durabilityFactor(DURABILITY_WORN_AT)).toBe(1); // healthy
    expect(durabilityFactor(DURABILITY_WORN_AT - 1)).toBeLessThan(1); // just below -> bonus drops
    expect(durabilityFactor(0)).toBeGreaterThan(0); // broken gear still gives SOME bonus (gentle)
    expect(durabilityFactor(0)).toBeLessThan(1);
    expect(durabilityFactor(20)).toBeLessThan(durabilityFactor(40)); // monotonic
    expect(repairCost(MAX_DURABILITY)).toBe(0); // full -> free
    expect(repairCost(0)).toBeGreaterThan(0); // broken -> costs gold
  });

  it('dying wears equipped gear (durability drops by the death loss)', () => {
    const sim = new Sim(7);
    equipFreshArmor(sim);
    expect(armor(sim).durability).toBe(MAX_DURABILITY); // a freshly equipped item is full
    dieOnceAndRespawn(sim);
    expect(armor(sim).durability).toBe(MAX_DURABILITY - DEATH_DURABILITY_LOSS); // exactly one loss
  });

  it('worn gear gives a smaller bonus, and repairing at the vendor (for gold) restores it', () => {
    const sim = new Sim(7);
    // LF-S4: inject the armor + repair gold directly (loot now drops on the ground), so XP/levels don't
    // shift base maxHp between measurements. The subject is wear -> smaller bonus -> repair restores it.
    const pid = sim.localPlayerId()!;
    const save0 = sim.serializePlayer(pid)!;
    save0.bag = [{ itemId: 'wolf_leather', rarity: 'normal', plus: 0, qty: 1 }];
    save0.gold = 120;
    sim.restorePlayer(pid, save0);
    const lea = sim.inventory().stacks.find((s) => s.itemId === 'wolf_leather')!;
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: lea.rarity, plus: lea.plus });
    sim.step();
    expect(armor(sim).durability).toBe(MAX_DURABILITY);
    const fullMaxHp = player(sim).maxHp;

    // die until the armor is "worn" (below the threshold) -> a smaller HP bonus
    let dGuard = 0;
    while (armor(sim).durability >= DURABILITY_WORN_AT && dGuard++ < 12) dieOnceAndRespawn(sim);
    expect(armor(sim).durability).toBeLessThan(DURABILITY_WORN_AT);
    expect(player(sim).maxHp).toBeLessThan(fullMaxHp); // worn gear -> less of its +HP

    // repair at the vendor: pay gold, durability AND the bonus come back
    goToVendor(sim);
    const gold0 = player(sim).gold;
    const cost = armor(sim).repairCost;
    expect(cost).toBeGreaterThan(0);
    expect(gold0).toBeGreaterThanOrEqual(cost);
    sim.sendCommand({ t: 'repair', slot: 'chest' });
    sim.step();
    expect(armor(sim).durability).toBe(MAX_DURABILITY); // fully repaired
    expect(player(sim).gold).toBe(gold0 - cost); // paid the repair cost
    expect(player(sim).maxHp).toBe(fullMaxHp); // full bonus restored
  });

  it('durability floors at 0, and repair is refused away from the vendor / when broke', () => {
    const sim = new Sim(7);
    equipFreshArmor(sim);
    // die well past MAX/LOSS times -> durability floors at 0 (never negative)
    const enough = Math.ceil(MAX_DURABILITY / DEATH_DURABILITY_LOSS) + 2;
    for (let i = 0; i < enough; i++) dieOnceAndRespawn(sim);
    expect(armor(sim).durability).toBe(0);

    // away from the vendor: a repair command is a no-op (no gold spent)
    fleeToSafety(sim);
    const goldAway = player(sim).gold;
    sim.sendCommand({ t: 'repair', slot: 'chest' });
    sim.step();
    expect(armor(sim).durability).toBe(0); // not repaired (not at the vendor)
    expect(player(sim).gold).toBe(goldAway);

    // at the vendor but unable to afford the full-repair cost: still refused
    goToVendor(sim);
    const cost = armor(sim).repairCost; // 100 at durability 0
    if (player(sim).gold < cost) {
      const gold0 = player(sim).gold;
      sim.sendCommand({ t: 'repair', slot: 'chest' });
      sim.step();
      expect(armor(sim).durability).toBe(0); // refused — can't afford it
      expect(player(sim).gold).toBe(gold0);
    }
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
    // Catch forbidden imports at ANY depth: src/sim/content/** must go ../../ to reach
    // render/ui/game/net, which a single-`../` matcher missed. The trailing slash-or-quote keeps
    // it precise — `../net'` and `../net/x` match, but `../network` and `../../world_api` (the
    // allowed seam) do NOT.
    const forbiddenImport = /from\s+['"](three|(?:\.\.\/)+(?:render|ui|game|net)(?:\/|['"]))/;
    // Guard the guard: it must catch a 2-level-up violation and must not flag world_api.
    expect(forbiddenImport.test("from '../../render/foo'")).toBe(true);
    expect(forbiddenImport.test("from '../../world_api'")).toBe(false);
    for (const f of files) {
      const code = stripComments(sources[f]);
      for (const pat of forbidden) {
        expect(pat.test(code), `${f} must not use ${pat.source}`).toBe(false);
      }
      expect(forbiddenImport.test(code), `${f} must not import render/ui/game/net/three`).toBe(false);
    }
  });
});

// Buy the Cajado de Aprendiz from the vendor (it isn't a drop) and equip it, switching
// the character to the Mago mastery. Mirrors equipSpear; all deterministic.
function equipStaff(sim: Sim): void {
  const playerOf = () => sim.entities().find((e) => e.kind === 'player')!;
  const price = VENDOR_STOCK.find((s) => s.itemId === 'apprentice_staff')!.price;
  let guard = 0;
  while (playerOf().gold < price && guard++ < 400) killNearestEnemy(sim);
  for (let i = 0; i < 800 && !sim.shop().inRange; i++) {
    const p = playerOf();
    sim.sendCommand({ t: 'move', dx: VENDOR_SPAWN_X - p.x, dz: VENDOR_SPAWN_Z - p.z });
    sim.step();
  }
  sim.sendCommand({ t: 'set-target', id: null });
  sim.sendCommand({ t: 'buy', itemId: 'apprentice_staff' });
  sim.sendCommand({ t: 'stop' });
  sim.step();
  const staff = sim.inventory().stacks.find((s) => s.itemId === 'apprentice_staff');
  if (staff) {
    sim.sendCommand({ t: 'equip', itemId: 'apprentice_staff', rarity: staff.rarity, plus: staff.plus });
    sim.step();
  }
  restoreToFull(sim); // farming can leave the player hurt; reset to a clean full-HP baseline
}

// The Mago mastery (G1): the first class to deal MAGICAL damage, scaling with Intelligence
// (the mirror of how physical scales with Strength). Crit still comes from the weapon.
describe('mage mastery (Mago) — magical damage (Int)', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const FIREBALL = MASTERIES.mage.abilities.find((a) => a.slot === 1)!;
  const nearestWolf = (sim: Sim) => {
    const p = player(sim);
    const wolves = sim.entities().filter((e) => e.kind === 'enemy' && !e.boss && e.hp > 0 && e.species === 'skeleton_minion');
    wolves.sort((a, b) => (a.x - p.x) ** 2 + (a.z - p.z) ** 2 - ((b.x - p.x) ** 2 + (b.z - p.z) ** 2));
    return wolves[0];
  };

  it('spellDamage scales with Int, mirroring meleeDamage/Str (INT_TO_DAMAGE === STR_TO_DAMAGE)', () => {
    expect(INT_TO_DAMAGE).toBe(STR_TO_DAMAGE); // the two attributes scale damage identically by design
    expect(spellDamage(0, 9)).toBe(9); // a fresh (Int 0) staff-user does just the staff's weapon damage
    expect(spellDamage(20, 9)).toBe(9 + Math.floor(20 * INT_TO_DAMAGE));
    expect(spellDamage(40, 9)).toBeGreaterThan(spellDamage(20, 9)); // more Int -> more magical damage
    expect(spellDamage(20, 12)).toBeGreaterThan(spellDamage(20, 9)); // a better staff -> more damage
    expect(spellDamage(20, 9)).toBe(meleeDamage(20, 9)); // exact mirror of the physical base (same k)
    // a magical ability scales the spell base by its multiplier (mirror of abilityDamage)
    expect(spellAbilityDamage(FIREBALL, 20, 9)).toBe(Math.round(spellDamage(20, 9) * (FIREBALL.damageMultiplier ?? 0)));
  });

  it('mitigate: armor curve reduces by type; magDef + Int-resist STACK for magical; armor 0 takes full', () => {
    // Balde A: gear defense now flows through the curve `30 * (1 - armor/(armor+ARMOR_K))`.
    const t = (phyDef: number, magDef: number, baseInt: number): Entity => ({ phyDef, magDef, baseInt }) as unknown as Entity;
    const magical: Damage = { amount: 30, type: 'magical', crit: false };
    const physical: Damage = { amount: 30, type: 'physical', crit: false };
    const intArmor = Math.floor(40 * MAGIC_DEF_PER_INT); // 10 from Int 40
    expect(mitigate({ hit: magical, target: t(0, 0, 40) })).toBe(Math.round(30 * (1 - intArmor / (intArmor + ARMOR_K))));
    expect(mitigate({ hit: magical, target: t(0, 0, 40) })).toBeLessThan(30); // resisted by Int
    // magDef STACKS on top of the Int-resist (more reduction than Int alone)
    expect(mitigate({ hit: magical, target: t(0, 8, 40) })).toBeLessThan(mitigate({ hit: magical, target: t(0, 0, 40) }));
    expect(mitigate({ hit: magical, target: t(0, 0, 0) })).toBe(30); // magDef 0 AND Int 0 -> full (player nukes mobs)
    expect(mitigate({ hit: physical, target: t(0, 99, 40) })).toBe(30); // physical ignores magDef/Int (phyDef 0 -> passthrough)
  });

  it('equipping the staff swaps the action bar to the Mago kit; unequipping restores the sword', () => {
    const sim = new Sim(7);
    expect(sim.abilities().map((a) => a.name)).toEqual(['Golpe Forte', 'Postura Defensiva', 'Atordoamento']);
    equipStaff(sim);
    expect(sim.inventory().equipment.find((e) => e.slot === 'weapon')!.itemId).toBe('apprentice_staff');
    expect(sim.abilities().map((a) => a.name)).toEqual(['Bola de Fogo', 'Onda de Chamas', 'Lança de Gelo']);
    sim.sendCommand({ t: 'unequip', slot: 'weapon' });
    sim.step();
    expect(sim.abilities().map((a) => a.name)).toEqual(['Golpe Forte', 'Postura Defensiva', 'Atordoamento']);
  });

  it('Bola de Fogo deals magical (Int-scaled) damage in-game, distinct from the physical (Str) formula', () => {
    const sim = new Sim(7);
    equipStaff(sim);
    // approach a wolf WITHOUT a target (no premature auto-attack) into staff range
    sim.sendCommand({ t: 'set-target', id: null });
    sim.sendCommand({ t: 'stop' });
    sim.step();
    let wid = -1;
    for (let i = 0; i < 1500; i++) {
      const p = player(sim);
      const w = nearestWolf(sim);
      if (!w) { sim.step(); continue; }
      if (Math.hypot(w.x - p.x, w.z - p.z) <= MASTERIES.mage.attackRange!) { wid = w.id; break; }
      sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      sim.step();
    }
    expect(wid).not.toBe(-1);

    const p = player(sim);
    // p.int is the player's Intelligence (0 here — no points spent); p.weaponDamage includes the staff.
    const expectedMagical = spellAbilityDamage(FIREBALL, p.int, p.weaponDamage);
    const expectedPhysical = abilityDamage(FIREBALL, p.str, p.weaponDamage);
    expect(expectedMagical).not.toBe(expectedPhysical); // meaningful: Int (0) and Str (20) paths differ

    const before = sim.recentEvents();
    const lastSeq = before.length ? Math.max(...before.map((e) => e.seq)) : 0;
    sim.sendCommand({ t: 'set-target', id: wid });
    sim.sendCommand({ t: 'use-ability', slot: 1 }); // Bola de Fogo
    sim.sendCommand({ t: 'stop' });
    sim.step();

    const hits = sim.recentEvents()
      .filter((e) => e.seq > lastSeq && e.kind === 'damage' && e.targetId === wid)
      .map((e) => e.amount);
    expect(hits.length).toBeGreaterThan(0); // the cast landed a damage event
    const isMagical = (a: number) => a === expectedMagical || a === Math.round(expectedMagical * CRIT_MULT);
    expect(hits.some(isMagical)).toBe(true); // used the MAGICAL (Int) formula (or its weapon-crit double)
    expect(hits).not.toContain(expectedPhysical); // NOT the physical (Str) formula
    expect(hits).not.toContain(Math.round(expectedPhysical * CRIT_MULT));
  });

  it('a Mago cast stream is deterministic (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      equipStaff(sim);
      for (let i = 0; i < 400; i++) {
        const p = player(sim);
        const w = nearestWolf(sim);
        if (w) {
          sim.sendCommand({ t: 'set-target', id: w.id });
          sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        }
        sim.sendCommand({ t: 'use-ability', slot: 1 }); // press Bola de Fogo (no-op when not castable)
        sim.step();
      }
      return sim.hash();
    };
    const h7a = run(7);
    const h7b = run(7);
    const h123 = run(123);
    expect(h7a).toBe(h7b);
    expect(h7a).not.toBe(h123);
  });
});

describe('class selection (G1)', () => {
  const weaponOf = (sim: Sim) => sim.inventory().equipment.find((e) => e.slot === 'weapon')!.itemId;

  it('a fresh player picks a class and gets that class starter weapon + kit', () => {
    const sim = new Sim(7);
    expect(weaponOf(sim)).toBeNull(); // fresh: unarmed (default Sword kit)
    sim.sendCommand({ t: 'select-class', classId: 'archer' });
    sim.step();
    expect(weaponOf(sim)).toBe('short_bow');
    expect(sim.abilities().map((a) => a.name)).toEqual(['Tiro Carregado', 'Tiro Múltiplo', 'Tiro Lento']);
  });

  it('each class maps to its mastery kit', () => {
    const kits: Record<string, string[]> = {
      swordshield: ['Golpe Forte', 'Postura Defensiva', 'Atordoamento'],
      spear: ['Estocada', 'Varredura', 'Investida', 'Fúria'],
      archer: ['Tiro Carregado', 'Tiro Múltiplo', 'Tiro Lento'],
      mage: ['Bola de Fogo', 'Onda de Chamas', 'Lança de Gelo'],
    };
    for (const [classId, names] of Object.entries(kits)) {
      const sim = new Sim(7);
      sim.sendCommand({ t: 'select-class', classId });
      sim.step();
      expect(sim.abilities().map((a) => a.name)).toEqual(names);
    }
  });

  it('each class exposes its mastery on the entity view (drives the per-class skin)', () => {
    const localPlayer = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
    expect(localPlayer(new Sim(7)).mastery).toBe('sword'); // fresh/unarmed -> the default Sword skin (Knight)
    const skins: Record<string, string> = {
      swordshield: 'sword', // Knight
      spear: 'spear', // Barbarian
      archer: 'bow', // Ranger
      mage: 'mage', // Mage
    };
    for (const [classId, mastery] of Object.entries(skins)) {
      const sim = new Sim(7);
      sim.sendCommand({ t: 'select-class', classId });
      sim.step();
      expect(localPlayer(sim).mastery).toBe(mastery);
    }
  });

  it('does NOT overwrite an already-equipped weapon (option b — protects upgraded gear)', () => {
    const sim = new Sim(7);
    sim.sendCommand({ t: 'select-class', classId: 'spear' }); // fresh -> equips the spear
    sim.step();
    expect(weaponOf(sim)).toBe('iron_spear');
    sim.sendCommand({ t: 'select-class', classId: 'mage' }); // already armed -> ignored
    sim.step();
    expect(weaponOf(sim)).toBe('iron_spear'); // unchanged
  });

  it('ignores an unknown class id (stays unarmed)', () => {
    const sim = new Sim(7);
    sim.sendCommand({ t: 'select-class', classId: 'wizard999' });
    sim.step();
    expect(weaponOf(sim)).toBeNull();
  });

  it('class selection is deterministic (same seed => identical hash)', () => {
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      sim.sendCommand({ t: 'select-class', classId: 'mage' });
      for (let i = 0; i < 50; i++) sim.step();
      return sim.hash();
    };
    expect(run(7)).toBe(run(7));
    expect(run(7)).not.toBe(run(123));
  });
});

// City wall (G4 / R4): the square stone rampart blocks the player except through the 4 cardinal
// gates. Deterministic, player-only — the collision lives in src/sim/movement.ts (slideThroughGates).
describe('city wall collision (gates)', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;

  it('the player only crosses the rampart through a gate, and reaches the wilds via one', () => {
    const sim = new Sim(7);
    let prev = { x: player(sim).x, z: player(sim).z };
    let crossings = 0;
    // try to barge straight out toward a CORNER (no gate there) — the player should slide to a gate
    for (let i = 0; i < 600; i++) {
      const p = player(sim);
      sim.sendCommand({ t: 'move', dx: 60 - p.x, dz: 45 - p.z });
      sim.step();
      const cur = { x: player(sim).x, z: player(sim).z };
      // a crossing of the east wall SEGMENT (|z| <= wallHalf) must fall within the gate gap
      if (prev.x < CITY_WALL_HALF && cur.x >= CITY_WALL_HALF) {
        const zc = prev.z + ((CITY_WALL_HALF - prev.x) / (cur.x - prev.x)) * (cur.z - prev.z);
        if (Math.abs(zc) <= CITY_WALL_HALF) { expect(Math.abs(zc)).toBeLessThanOrEqual(GATE_HALF + 1e-6); crossings++; }
      }
      // a crossing of the north wall SEGMENT (|x| <= wallHalf) must fall within the gate gap
      if (prev.z < CITY_WALL_HALF && cur.z >= CITY_WALL_HALF) {
        const xc = prev.x + ((CITY_WALL_HALF - prev.z) / (cur.z - prev.z)) * (cur.x - prev.x);
        if (Math.abs(xc) <= CITY_WALL_HALF) { expect(Math.abs(xc)).toBeLessThanOrEqual(GATE_HALF + 1e-6); crossings++; }
      }
      prev = cur;
    }
    expect(Math.max(Math.abs(player(sim).x), Math.abs(player(sim).z))).toBeGreaterThan(CITY_WALL_HALF); // got out
    expect(crossings).toBeGreaterThan(0); // and it crossed the rampart (through a gate, per above)
  });

  it('walking due along a cardinal axis passes straight through that gate', () => {
    const sim = new Sim(7);
    for (let i = 0; i < 400; i++) { sim.sendCommand({ t: 'move', dx: 1, dz: 0 }); sim.step(); }
    const p = player(sim);
    expect(p.x).toBeGreaterThan(CITY_WALL_HALF); // exited east...
    expect(Math.abs(p.z)).toBeLessThanOrEqual(GATE_HALF + 1e-6); // ...through the east gate (z ~ 0)
  });
});

// --- K2: equip level-requirement gate (degrees) ---
// The gate is a pure `level >= reqLevel` check in Sim.equip; the bot's botEquipBest skips
// gear it can't wear yet. We seed level + bag deterministically via restorePlayer (pure
// data, like save.test.ts) so these tests need no farming/vendor and stay Rng-free.
describe('degrees — gate de nível para equipar', () => {
  function seed(sim: Sim, level: number, ...itemIds: string[]): void {
    const id = sim.localPlayerId()!;
    sim.restorePlayer(id, {
      level,
      gold: 0,
      bag: itemIds.map((itemId) => ({ itemId, rarity: 'normal', plus: 0, qty: 1 })),
      equipment: {},
    });
  }
  const weapon = (sim: Sim) => sim.inventory().equipment.find((e) => e.slot === 'weapon')!;
  const holds = (sim: Sim, itemId: string) => sim.inventory().stacks.some((s) => s.itemId === itemId);

  it('refuses to equip a degree weapon below its required level (item stays in the bag)', () => {
    const sim = new Sim(7);
    seed(sim, 1, 'steel_sword'); // 3º grau, reqLevel 8
    sim.sendCommand({ t: 'equip', itemId: 'steel_sword', rarity: 'normal', plus: 0 });
    sim.step();
    expect(weapon(sim).itemId).toBeNull(); // nothing equipped
    expect(holds(sim, 'steel_sword')).toBe(true); // still held — not consumed
  });

  it('equips the same degree weapon once the player meets the required level', () => {
    const sim = new Sim(7);
    seed(sim, 8, 'steel_sword'); // exactly at the floor (reqLevel 8)
    sim.sendCommand({ t: 'equip', itemId: 'steel_sword', rarity: 'normal', plus: 0 });
    sim.step();
    expect(weapon(sim).itemId).toBe('steel_sword');
    expect(holds(sim, 'steel_sword')).toBe(false); // moved out of the bag into the slot
  });

  it('a legacy (degree-less) weapon is never gated — equips at level 1', () => {
    const sim = new Sim(7);
    seed(sim, 1, 'old_sword'); // no degree/reqLevel => req 0
    sim.sendCommand({ t: 'equip', itemId: 'old_sword', rarity: 'normal', plus: 0 });
    sim.step();
    expect(weapon(sim).itemId).toBe('old_sword');
  });

  it('a run that exercises the gate stays deterministic (same seed => identical world)', () => {
    const runGated = (s: number): string => {
      const sim = new Sim(s);
      seed(sim, 1, 'steel_sword');
      sim.sendCommand({ t: 'equip', itemId: 'steel_sword', rarity: 'normal', plus: 0 }); // refused (lvl 1 < 8)
      for (let i = 0; i < 120; i++) { sim.sendCommand({ t: 'move', dx: 1, dz: 0 }); sim.step(); }
      return sim.hash();
    };
    expect(runGated(2024)).toBe(runGated(2024));
  });

  it('the auto-play bot wears the wearable weapon, not the higher-degree one it cannot equip yet', () => {
    const sim = new Sim(7);
    // bag: a stronger-but-unwearable D3 (steel_sword, reqLevel 8, higher botGearScore) AND a
    // wearable base (old_sword). If the bot filtered AFTER scoring, `best` would be the D3 and
    // the equip would silently refuse, leaving the slot empty. Filtering BEFORE scoring makes
    // it fall back to old_sword.
    seed(sim, 1, 'steel_sword', 'old_sword');
    sim.sendCommand({ t: 'set-bot', on: true });
    for (let i = 0; i < 3; i++) sim.step(); // botEquipBest runs each botStep
    expect(weapon(sim).itemId).toBe('old_sword'); // the wearable lesser item — not null, not the D3
  });
});

// --- K2: the vendor stocks degree gear (Slice 3) ---
describe('degrees — mercador vende equipamento por grau', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;

  it('sells a degree weapon into the bag; equipping it is still gated by level', () => {
    const sim = new Sim(7);
    const id = sim.localPlayerId()!;
    // seed gold so we skip grinding; level 1 keeps the equip gated
    sim.restorePlayer(id, { level: 1, gold: 1000, bag: [], equipment: {} });
    for (let i = 0; i < 800 && !sim.shop().inRange; i++) {
      const p = player(sim);
      sim.sendCommand({ t: 'move', dx: VENDOR_SPAWN_X - p.x, dz: VENDOR_SPAWN_Z - p.z });
      sim.step();
    }
    expect(sim.shop().inRange).toBe(true);
    expect(sim.shop().stock.some((e) => e.itemId === 'steel_sword')).toBe(true); // vendor stocks the D3
    sim.sendCommand({ t: 'set-target', id: null });
    sim.sendCommand({ t: 'buy', itemId: 'steel_sword' });
    sim.sendCommand({ t: 'stop' });
    sim.step();
    expect(sim.inventory().stacks.some((s) => s.itemId === 'steel_sword')).toBe(true); // bought into the bag
    sim.sendCommand({ t: 'equip', itemId: 'steel_sword', rarity: 'normal', plus: 0 }); // refused at lvl 1
    sim.step();
    expect(sim.inventory().equipment.find((e) => e.slot === 'weapon')!.itemId).toBeNull();
  });
});

// --- K2: IWorld surfaces grau/requisito/canEquip per stack (Slice 4a) ---
describe('degrees — inventário expõe grau/requisito/canEquip', () => {
  it('reports degree, reqLevel and canEquip per stack, by the owner level', () => {
    const sim = new Sim(7);
    const id = sim.localPlayerId()!;
    const stackOf = (itemId: string) => sim.inventory().stacks.find((s) => s.itemId === itemId)!;
    sim.restorePlayer(id, {
      level: 1, gold: 0,
      bag: [
        { itemId: 'steel_sword', rarity: 'normal', plus: 0, qty: 1 }, // D3, reqLevel 8
        { itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 1 }, // non-equippable
      ],
      equipment: {},
    });
    expect(stackOf('steel_sword').degree).toBe(3);
    expect(stackOf('steel_sword').reqLevel).toBe(8);
    expect(stackOf('steel_sword').canEquip).toBe(false); // level 1 < 8
    // a non-equippable item carries no degree/requirement
    expect(stackOf('health_potion').degree).toBeUndefined();
    expect(stackOf('health_potion').reqLevel).toBeUndefined();
    expect(stackOf('health_potion').canEquip).toBeUndefined();
    // at level 8 the same weapon becomes equippable
    sim.restorePlayer(id, {
      level: 8, gold: 0,
      bag: [{ itemId: 'steel_sword', rarity: 'normal', plus: 0, qty: 1 }],
      equipment: {},
    });
    expect(stackOf('steel_sword').canEquip).toBe(true);
  });
});

// --- K5: armazém (storage) — superfície na IWorld ---
describe('armazém (storage) — superfície na IWorld', () => {
  it('storage() expõe o armazém vazio e fora de alcance no spawn', () => {
    const sim = new Sim(7);
    const st = sim.storage();
    expect(st.name).toBe('Armazém');
    expect(st.capacity).toBe(STORAGE_SLOTS);
    expect(st.stacks.length).toBe(0); // nada guardado ainda
    expect(st.inRange).toBe(false); // o jogador nasce em (0,0), longe do armazém (10,18)
  });
});

// --- K5: armazém (storage) — depósito/saque (comandos) ---
describe('armazém (storage) — depósito/saque (comandos)', () => {
  const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
  const seed = (sim: Sim, bag: unknown, storage: unknown) =>
    sim.restorePlayer(sim.localPlayerId()!, { bag, storage, equipment: {} });
  // o armazém (10,18) fica na zona segura da cidade (cheb 18 < 30) — sem mobs no caminho.
  function walkToWarehouse(sim: Sim): void {
    for (let i = 0; i < 800 && !sim.storage().inRange; i++) {
      const p = player(sim);
      sim.sendCommand({ t: 'move', dx: WAREHOUSE_SPAWN_X - p.x, dz: WAREHOUSE_SPAWN_Z - p.z });
      sim.step();
    }
  }
  const holdsBag = (sim: Sim, id: string) => sim.inventory().stacks.some((s) => s.itemId === id);
  const inStorage = (sim: Sim, id: string) => sim.storage().stacks.find((s) => s.itemId === id);

  it('deposita um stack INTEIRO perto do armazém; recusa fora de alcance', () => {
    const sim = new Sim(7);
    seed(sim, [{ itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 5 }], []);
    // fora de alcance (spawn 0,0): recusado, fica na bolsa
    sim.sendCommand({ t: 'deposit', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    sim.step();
    expect(holdsBag(sim, 'health_potion')).toBe(true);
    expect(sim.storage().stacks.length).toBe(0);
    // perto do armazém: deposita o stack inteiro
    walkToWarehouse(sim);
    expect(sim.storage().inRange).toBe(true);
    sim.sendCommand({ t: 'deposit', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    sim.step();
    expect(holdsBag(sim, 'health_potion')).toBe(false); // saiu da bolsa
    expect(inStorage(sim, 'health_potion')!.qty).toBe(5); // entrou inteiro
  });

  it('saca o stack de volta para a bolsa (perto do armazém)', () => {
    const sim = new Sim(7);
    seed(sim, [], [{ itemId: 'steel_sword', rarity: 'normal', plus: 0, qty: 1 }]);
    walkToWarehouse(sim);
    sim.sendCommand({ t: 'withdraw', itemId: 'steel_sword', rarity: 'normal', plus: 0 });
    sim.step();
    expect(holdsBag(sim, 'steel_sword')).toBe(true);
    expect(sim.storage().stacks.length).toBe(0);
  });

  it('vendor e armazém têm zonas de interação mutuamente exclusivas', () => {
    const sim = new Sim(7);
    walkToWarehouse(sim);
    expect(sim.storage().inRange).toBe(true);
    expect(sim.shop().inRange).toBe(false); // (10,18) está longe do mercador (10,6)
  });

  it('um run com depósito é determinístico (mesma seed => mundo idêntico)', () => {
    const runDep = (s: number): string => {
      const sim = new Sim(s);
      seed(sim, [{ itemId: 'protect_stone', rarity: 'normal', plus: 0, qty: 3 }], []);
      walkToWarehouse(sim);
      sim.sendCommand({ t: 'deposit', itemId: 'protect_stone', rarity: 'normal', plus: 0 });
      for (let i = 0; i < 60; i++) { sim.sendCommand({ t: 'move', dx: -1, dz: 0 }); sim.step(); }
      return sim.hash();
    };
    expect(runDep(2024)).toBe(runDep(2024));
  });

  it('recusa depósito com armazém CHEIO pelo gate de comando (não-destrutivo)', () => {
    const sim = new Sim(7);
    // enche o armazém com STORAGE_SLOTS stacks DISTINTOS (mesma arma, rarity×plus variados)
    // e põe um id NOVO (não casável) na bolsa.
    const full: { itemId: string; rarity: string; plus: number; qty: number }[] = [];
    for (const r of ['normal', 'sos', 'som', 'sun']) {
      for (let p = 0; p <= MAX_PLUS && full.length < STORAGE_SLOTS; p++) {
        full.push({ itemId: 'old_sword', rarity: r, plus: p, qty: 1 });
      }
    }
    expect(full.length).toBe(STORAGE_SLOTS);
    seed(sim, [{ itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 1 }], full);
    walkToWarehouse(sim);
    expect(sim.storage().inRange).toBe(true);
    sim.sendCommand({ t: 'deposit', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    sim.step();
    // recusado: o stack novo fica na bolsa, o armazém segue cheio e NÃO ganhou o id novo
    expect(holdsBag(sim, 'health_potion')).toBe(true);
    expect(sim.storage().stacks.length).toBe(STORAGE_SLOTS);
    expect(inStorage(sim, 'health_potion')).toBeUndefined();
  });

  it('o conteúdo do armazém entra no hash() (storage dobrado no fingerprint)', () => {
    const withStore = new Sim(7);
    seed(withStore, [], [{ itemId: 'protect_stone', rarity: 'normal', plus: 0, qty: 3 }]);
    const empty = new Sim(7);
    seed(empty, [], []);
    // mesma seed e mesma bolsa (vazia); só o armazém difere. Se e.storage NÃO entrasse no hash(),
    // os fingerprints seriam iguais — então a desigualdade prova o fold do storage no hash().
    // (Obs.: mover bolsa<->armazém NÃO muda o hash — os dois folds são consecutivos — por isso
    // o teste compara CONTEÚDO presente vs ausente, não depósito vs não-depósito.)
    expect(withStore.hash()).not.toBe(empty.hash());
    const h = (): string => {
      const s = new Sim(7);
      seed(s, [], [{ itemId: 'protect_stone', rarity: 'normal', plus: 0, qty: 3 }]);
      return s.hash();
    };
    expect(h()).toBe(h()); // e segue determinístico run-vs-run
  });

  it('o NPC do armazém não pode ser alvo, atacado ou ferido (id reservado 1e9)', () => {
    const sim = new Sim(7);
    const wh = sim.entities().find((e) => e.id === WAREHOUSE_ENTITY_ID)!;
    expect(wh.kind).toBe('npc');
    const hp0 = wh.hp;
    // clicar (set-target) no NPC é ignorado — só inimigos vivos são alvos válidos
    sim.sendCommand({ t: 'set-target', id: WAREHOUSE_ENTITY_ID });
    sim.step();
    expect(sim.localTargetId()).toBeNull();
    // Tab (cycle-target) nunca pousa no NPC
    for (let i = 0; i < 20; i++) {
      sim.sendCommand({ t: 'cycle-target' });
      sim.step();
      expect(sim.localTargetId()).not.toBe(WAREHOUSE_ENTITY_ID);
    }
    // combate ao redor nunca fere o armazém
    for (let i = 0; i < 10; i++) killNearestEnemy(sim);
    expect(sim.entities().find((e) => e.id === WAREHOUSE_ENTITY_ID)!.hp).toBe(hp0);
  });
});
