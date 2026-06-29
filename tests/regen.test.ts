// Out-of-combat HP/MP regen (Silkroad-style sustain): after a short lull with no damage dealt or
// taken, the player slowly recovers HP and MP — so the farm loop flows and a caster isn't stranded
// without mana. While still fighting, regen stays OFF. Deterministic (no Rng), so it's hashed and
// must round-trip identically. Driven by real combat (a wolf bite) since hp/mp aren't settable directly.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';

const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
const nearestWolf = (sim: Sim) => {
  const p = player(sim);
  let best: ReturnType<Sim['entities']>[number] | undefined;
  let bd = Infinity;
  for (const e of sim.entities()) {
    if (e.kind !== 'enemy') continue;
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
};

describe('Out-of-combat regen (Silkroad-style sustain)', () => {
  it('does NOT regen while fighting, then recovers to full once safely out of combat', () => {
    const sim = new Sim(7);
    // 1) walk into a wolf (no target set => we don't attack it) and tank bites until HP drops.
    let bitten = false;
    for (let i = 0; i < 1500 && !bitten; i++) {
      const p = player(sim);
      const w = nearestWolf(sim);
      if (!w) { sim.step(); continue; }
      sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      sim.step();
      if (player(sim).hp < player(sim).maxHp) bitten = true;
    }
    expect(bitten).toBe(true);

    // 2) STILL engaged: a few seconds pass — HP must only go down (bites), never UP (no regen in combat).
    const engagedHp = player(sim).hp;
    for (let i = 0; i < 60; i++) {
      const p = player(sim);
      const w = nearestWolf(sim);
      if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      sim.step();
    }
    expect(player(sim).hp).toBeLessThanOrEqual(engagedHp); // regen did NOT kick in mid-fight

    // 3) retreat to the safe town centre (0,0) and wait well past the combat linger.
    for (let i = 0; i < 700; i++) {
      const p = player(sim);
      if (Math.hypot(p.x, p.z) > 1) sim.sendCommand({ t: 'move', dx: -p.x, dz: -p.z });
      else sim.sendCommand({ t: 'stop' });
      sim.step();
    }
    expect(player(sim).hp).toBe(player(sim).maxHp); // out of combat, regen fully restored HP
  });

  it('is deterministic (same seed + commands => identical hash, regen included)', () => {
    const run = (): string => {
      const sim = new Sim(7);
      for (let i = 0; i < 400; i++) {
        const p = player(sim);
        if (Math.hypot(p.x, p.z) > 1) sim.sendCommand({ t: 'move', dx: -p.x, dz: -p.z });
        sim.step();
      }
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
