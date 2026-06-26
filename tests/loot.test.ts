// Loot físico (LF-S1) — a player's NON-duel death scatters some BAG items on the ground as pickup-able
// kind 'loot' entities (FFA, despawn ~5 min); a friendly DUEL death drops nothing; equipped gear is
// spared. Server-mode Sim; ground loot is read via entities().filter(kind === 'loot'). A 1-HP player
// (restorePlayer baseMaxHp:1 -> recomputeStats clamps hp to 1) dies to the first mob bite — a reliable,
// deterministic PvE death.
import { describe, it, expect } from 'vitest';
import { Sim, LOOT_DESPAWN_TICKS } from '../src/sim/sim';
import { chebyshev } from '../src/sim/zones';
import type { Command } from '../src/world_api';

function serverSim(seed = 1): Sim {
  return new Sim(seed, /* spawnLocal */ false);
}
function run(sim: Sim, id: number, cmd: Command): void {
  sim.sendCommandFor(id, cmd);
  sim.step();
}
const ent = (sim: Sim, id: number) => sim.entities().find((e) => e.id === id)!;
const groundLoot = (sim: Sim) => sim.entities().filter((e) => e.kind === 'loot');
const bagStacks = (sim: Sim, id: number) => (sim.serializePlayer(id)?.bag ?? []).filter((s) => s != null).length;

// A bag of distinct stacks (valid item ids / rarities), enough that with the ~8% per-stack roll SOME
// land on death for the seeds used here.
const BAG = [
  { itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 5 },
  { itemId: 'protect_stone', rarity: 'normal', plus: 0, qty: 3 },
  { itemId: 'old_sword', rarity: 'normal', plus: 0, qty: 1 },
  { itemId: 'old_sword', rarity: 'sos', plus: 0, qty: 1 },
  { itemId: 'iron_spear', rarity: 'normal', plus: 0, qty: 1 },
  { itemId: 'iron_spear', rarity: 'som', plus: 0, qty: 1 },
  { itemId: 'wolf_leather', rarity: 'normal', plus: 0, qty: 1 },
  { itemId: 'wolf_leather', rarity: 'sos', plus: 0, qty: 1 },
];

// Kill a player via MOBS (a NON-duel / PvE death): they are 1 HP, so the first bite kills. Walk EAST
// (toward the ring's east spawn pack) until a mob bites them down. Deterministic (follows the seed).
const killByMob = (sim: Sim, id: number): void => {
  sim.sendCommandFor(id, { t: 'move', dx: 1, dz: 0 });
  for (let i = 0; i < 2000 && !ent(sim, id).dead; i++) sim.step();
  sim.sendCommandFor(id, { t: 'stop' });
  sim.step();
};

// Build a server Sim where player A has just died to a mob AND dropped >=1 ground item. The ~8% per-
// stack drop is deterministic per seed, so we SEED-FISH (try seeds in order) to avoid depending on a
// single lucky seed — the first dropping seed is normally 1–3. Returns the sim mid-death (loot present).
function simWithDeathDrop(): { sim: Sim; a: number; before: number } {
  for (let seed = 1; seed <= 50; seed++) {
    const sim = serverSim(seed);
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { baseMaxHp: 1, bag: BAG });
    const before = bagStacks(sim, a);
    killByMob(sim, a);
    if (groundLoot(sim).length > 0) return { sim, a, before };
  }
  throw new Error('no seed in 1..50 produced a death-drop (unexpected — the drop mechanism may be broken)');
}

describe('loot físico — drop na morte (LF-S1)', () => {
  it('uma morte PvE (mob) dropa itens da bolsa no chão, conservando o total', () => {
    const { sim, a, before } = simWithDeathDrop();
    expect(ent(sim, a).dead).toBe(true); // caiu pra um mob (morte NÃO-duelo)
    const dropped = groundLoot(sim);
    expect(dropped.length).toBeGreaterThan(0); // ao menos um stack caiu no chão
    expect(dropped.every((e) => e.loot != null)).toBe(true); // cada item no chão carrega seu conteúdo
    expect(bagStacks(sim, a) + dropped.length).toBe(before); // conservação: sobrou + caiu = total original
  });

  it('o loot no chão some depois do tempo de vida (despawn)', () => {
    const { sim } = simWithDeathDrop();
    expect(groundLoot(sim).length).toBeGreaterThan(0);
    for (let i = 0; i < LOOT_DESPAWN_TICKS + 2; i++) sim.step();
    expect(groundLoot(sim).length).toBe(0); // sumiu após o tempo de vida
  });

  it('gear equipado NÃO cai (só a bolsa); a arma segue equipada após a morte', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, {
      baseMaxHp: 1,
      bag: BAG,
      equipment: {
        weapon: { itemId: 'old_sword', rarity: 'sos', plus: 1, durability: 100 },
        shield: null, helmet: null, chest: null, hands: null, legs: null, feet: null, necklace: null, earring: null, ring: null,
      },
    });
    killByMob(sim, a);
    expect(ent(sim, a).dead).toBe(true);
    expect(sim.serializePlayer(a)!.equipment.weapon).not.toBeNull(); // só a bolsa dropa; a arma fica
  });

  it('deterministico (mesma seed + comandos => mesmo hash, incluindo os drops)', () => {
    const play = (): string => {
      const sim = serverSim(7);
      const a = sim.addPlayer('A');
      sim.restorePlayer(a, { baseMaxHp: 1, bag: BAG });
      killByMob(sim, a);
      for (let i = 0; i < 50; i++) sim.step();
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});

describe('loot físico — duelo amigável NÃO dropa (LF-S1)', () => {
  // Minimal duel-to-down (mirrors pvp.test): B steps out of town (diagonal, dodging mobs); A hunts +
  // downs B inside the active duel — so B's death is a friendly duel loss, which must drop nothing.
  const walkOut = (sim: Sim, id: number): void => {
    sim.sendCommandFor(id, { t: 'move', dx: 1, dz: 1 });
    for (let i = 0; i < 600 && chebyshev(ent(sim, id).x, ent(sim, id).z) <= 35; i++) sim.step();
    sim.sendCommandFor(id, { t: 'stop' });
    sim.step();
  };
  it('derrubar no duelo não deixa loot no chão', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    sim.restorePlayer(b, { bag: BAG }); // B carrega itens, mas é duelo amigável
    sim.restorePlayer(a, { baseStr: 400 }); // derruba rápido e deterministico
    run(sim, a, { t: 'duel-challenge', name: 'B' });
    run(sim, b, { t: 'duel-accept' });
    walkOut(sim, b);
    for (let i = 0; i < 1500 && sim.duelViewFor(a) !== null; i++) {
      const ea = ent(sim, a); const eb = ent(sim, b);
      sim.sendCommandFor(a, { t: 'move', dx: eb.x - ea.x, dz: eb.z - ea.z });
      sim.sendCommandFor(a, { t: 'set-target', id: b });
      sim.step();
    }
    expect(ent(sim, b).dead).toBe(true); // B caiu...
    expect(groundLoot(sim).length).toBe(0); // ...mas NADA caiu (duelo amigável: a saída antecipada pula o drop)
  });
});
