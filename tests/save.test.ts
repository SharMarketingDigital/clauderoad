// Character persistence (Sim.serializePlayer / restorePlayer, backed by src/sim/save.ts).
// Data-only: it moves progression in/out and must NEVER break the sim, even from corrupt
// input. (The DB layer itself lives in the server and isn't unit-tested here.)
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';

// Drive a player to farm mobs so it gains REAL XP/levels/loot/gold (like a real session).
function farm(sim: Sim, a: number, steps: number): void {
  for (let i = 0; i < steps; i++) {
    const ents = sim.entities();
    const me = ents.find((e) => e.id === a);
    if (!me) break;
    let mob: { id: number; x: number; z: number } | null = null;
    let bd = Infinity;
    for (const e of ents) {
      if (e.kind !== 'enemy') continue;
      const d = (e.x - me.x) ** 2 + (e.z - me.z) ** 2;
      if (d < bd) { bd = d; mob = e; }
    }
    if (mob) {
      sim.sendCommandFor(a, { t: 'move', dx: mob.x - me.x, dz: mob.z - me.z });
      sim.sendCommandFor(a, { t: 'set-target', id: mob.id });
    }
    sim.step();
  }
}

describe('character persistence — serialize/restore (data-only, defensive)', () => {
  it('round-trips a full character through JSON (every field preserved)', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    const save = {
      level: 6, xp: 40, attrPoints: 3,
      baseStr: 16, baseInt: 5, baseMaxHp: 220, baseMaxMp: 90,
      sp: 8, skillRanks: { sword_strike: 3, sword_guard: 2 }, gold: 320,
      bag: [
        { itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 5 },
        { itemId: 'iron_spear', rarity: 'som', plus: 4, qty: 1 },
      ],
      equipment: {
        weapon: { itemId: 'old_sword', rarity: 'sos', plus: 2, durability: 70 },
        shield: null,
        helmet: null,
        chest: { itemId: 'wolf_leather', rarity: 'normal', plus: 0, durability: 100 },
        hands: null,
        legs: null,
        feet: null,
        necklace: null,
        earring: null,
        ring: null,
      },
    };
    sim.restorePlayer(a, JSON.parse(JSON.stringify(save))); // through JSON, like the DB
    expect(sim.serializePlayer(a)).toEqual(save);
  });

  it('round-trips a REAL farmed character (serialize -> JSON -> restore -> serialize)', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    farm(sim, a, 3000); // earn levels/loot/gold for real
    const save = sim.serializePlayer(a)!;
    expect(save.level).toBeGreaterThanOrEqual(1);
    const sim2 = new Sim(1337, false);
    const b = sim2.addPlayer('B');
    sim2.restorePlayer(b, JSON.parse(JSON.stringify(save)));
    expect(sim2.serializePlayer(b)).toEqual(save); // the player continues exactly where it left off
  });

  it('a garbage / corrupt save NEVER breaks the player (stays sane, never throws)', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    const bads: unknown[] = [
      null, undefined, 'nope', 42, [],
      { level: 'x', xp: -5, baseMaxHp: 0, attrPoints: -3, sp: 'no', gold: NaN, bag: 'no', equipment: 7, skillRanks: [1, 2] },
    ];
    for (const bad of bads) sim.restorePlayer(a, bad); // must not throw
    const s = sim.serializePlayer(a)!;
    expect(s.level).toBeGreaterThanOrEqual(1);
    expect(Array.isArray(s.bag)).toBe(true);
    const view = sim.entities().find((e) => e.id === a)!;
    expect(view.hp).toBeGreaterThan(0); // recompute didn't zero HP (baseMaxHp:0 was rejected)
    expect(view.maxHp).toBeGreaterThan(0);
  });

  it('applies valid fields and drops invalid pieces (partial corrupt)', () => {
    const sim = new Sim(1337, false);
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, {
      level: 7, gold: 500, sp: 4,
      bag: 'garbage', // invalid -> empty bag
      skillRanks: { good: 4, tooHigh: 99, bad: 'x' }, // keep good; drop out-of-range / non-int
      equipment: { weapon: { itemId: 'nope_unknown', rarity: 'normal', plus: 0, durability: 50 } }, // unknown item -> dropped
    });
    const s = sim.serializePlayer(a)!;
    expect(s.level).toBe(7);
    expect(s.gold).toBe(500);
    expect(s.sp).toBe(4);
    expect(s.bag).toEqual([]);
    expect(s.skillRanks).toEqual({ good: 4 });
    expect(s.equipment.weapon).toBeNull();
  });

  it('serializePlayer returns null for a missing / non-player id', () => {
    const sim = new Sim(1337, false);
    expect(sim.serializePlayer(99999)).toBeNull();
  });
});
