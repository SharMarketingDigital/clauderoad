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
  xpForLevel,
  HP_PER_LEVEL,
  MP_PER_LEVEL,
  ATTR_POINTS_PER_LEVEL,
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

  it('is tanky to kill, announces defeat, drops rich loot, and respawns on its timer', () => {
    const sim = new Sim(7);
    while (!findBoss(sim)) sim.step(); // advance to the boss spawn (player idle -> 0 gold)
    const bossId = findBoss(sim)!.id;
    expect(player(sim).gold).toBe(0);

    // target the boss and beat it down (auto-attack + ability)
    sim.sendCommand({ t: 'set-target', id: bossId });
    const alive = (): boolean => sim.entities().some((e) => e.id === bossId);
    let hits = 0;
    while (alive() && hits++ < 8000) {
      const b = sim.entities().find((e) => e.id === bossId);
      const p = player(sim);
      if (b) sim.sendCommand({ t: 'move', dx: b.x - p.x, dz: b.z - p.z });
      sim.sendCommand({ t: 'use-ability', slot: 1 });
      sim.step();
    }
    expect(alive()).toBe(false); // died within budget
    expect(hits).toBeGreaterThan(40); // took MANY hits — not a common one-/few-shot mob
    expect(sim.recentEvents().some((e) => e.kind === 'boss-defeat')).toBe(true);

    // rich loot: gold gained dwarfs a common mob's max
    const goldGained = player(sim).gold; // started at 0
    expect(goldGained).toBeGreaterThanOrEqual(BOSS_TEMPLATE.goldMin);
    expect(goldGained).toBeGreaterThan(ENEMY_TEMPLATE.goldMax);

    // gone now; a new boss appears after the respawn delay
    const deathTick = sim.tick;
    expect(findBoss(sim)).toBeUndefined();
    sim.sendCommand({ t: 'stop' });
    while (sim.tick < deathTick + BOSS_RESPAWN_TICKS) sim.step();
    expect(findBoss(sim)).toBeDefined();
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
