// Teleporte entre cidades (TP1) — server-mode Sim (no local player; clients join via addPlayer),
// applying each command on its own tick like party/pvp. The teleport moves the player to another
// city's centre for a fixed gold cost, only when standing at a city teleport point.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TELEPORT_COST, TELEPORT_RANGE } from '../src/sim/teleport';
import type { Command } from '../src/world_api';

function serverSim(seed = 1): Sim {
  return new Sim(seed, /* spawnLocal */ false);
}
function run(sim: Sim, id: number, cmd: Command): void {
  sim.sendCommandFor(id, cmd);
  sim.step(); // queued commands apply inside step()
}
const ent = (sim: Sim, id: number) => sim.entities().find((e) => e.id === id)!;

describe('teleporte entre cidades (TP1)', () => {
  it('teleporta da cidade central pra Vila do Leste, descontando o custo fixo', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A'); // spawns at (0,0) = the central city's teleport point
    sim.restorePlayer(a, { gold: 1000 });
    const g0 = ent(sim, a).gold;
    run(sim, a, { t: 'teleport', cityId: 'leste' });
    const e = ent(sim, a);
    expect(e.x).toBe(250); // moved to Vila do Leste's centre
    expect(e.z).toBe(0);
    expect(e.gold).toBe(g0 - TELEPORT_COST); // paid the fixed cost
  });

  it('volta da Vila do Leste pra central (round-trip pelo NPC de lá)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' });
    expect(ent(sim, a).x).toBe(250);
    run(sim, a, { t: 'teleport', cityId: 'town' }); // now at Leste's teleporter -> back to the centre
    expect(ent(sim, a).x).toBe(0);
    expect(ent(sim, a).z).toBe(0);
  });

  it('só teleporta perto do NPC do centro (longe da cidade = no-op)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    sim.sendCommandFor(a, { t: 'move', dx: 1, dz: 0 });
    for (let i = 0; i < 60; i++) sim.step(); // walk east, out of the central teleporter's range
    sim.sendCommandFor(a, { t: 'stop' });
    sim.step();
    const before = ent(sim, a);
    expect(Math.hypot(before.x, before.z)).toBeGreaterThan(TELEPORT_RANGE); // away from any city centre
    run(sim, a, { t: 'teleport', cityId: 'leste' });
    const after = ent(sim, a);
    expect(after.x).not.toBe(250); // did NOT teleport (not at a teleport point)
    expect(after.gold).toBe(before.gold); // and spent no gold
  });

  it('exige gold suficiente (sem gold = no-op)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' }); // park at Leste's exact centre (a known position)
    expect(ent(sim, a).x).toBe(250);
    sim.restorePlayer(a, { gold: TELEPORT_COST - 1 }); // now one gold short (position is unchanged by restore)
    run(sim, a, { t: 'teleport', cityId: 'town' });
    expect(ent(sim, a).x).toBe(250); // still at Leste — couldn't afford the trip
    expect(ent(sim, a).gold).toBe(TELEPORT_COST - 1); // unchanged
  });

  it('ignora destino desconhecido ou a propria cidade', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' }); // park at Leste's exact centre
    expect(ent(sim, a).x).toBe(250);
    const goldAtLeste = ent(sim, a).gold;
    run(sim, a, { t: 'teleport', cityId: 'leste' }); // same city you're standing in -> no-op
    expect(ent(sim, a).x).toBe(250);
    run(sim, a, { t: 'teleport', cityId: 'cidade-fantasma' }); // unknown destination -> no-op
    expect(ent(sim, a).x).toBe(250);
    expect(ent(sim, a).gold).toBe(goldAtLeste); // no extra gold spent
  });

  it('e deterministico (mesma seed + comandos => mesmo hash)', () => {
    const play = (): string => {
      const sim = serverSim(7);
      const a = sim.addPlayer('A');
      sim.restorePlayer(a, { gold: 1000 });
      run(sim, a, { t: 'teleport', cityId: 'leste' });
      run(sim, a, { t: 'teleport', cityId: 'town' });
      for (let i = 0; i < 10; i++) sim.step();
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});
