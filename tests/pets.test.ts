// Pets (GDD v0.5 §4) — the grab pet's COMPANION layer (PET0 follow + PET3 summon/acquisition). A pet is
// an inert kind 'pet' sim entity spawned when the owner summons one (and owns the pet item), that trails
// the owner via the shared deterministic mover. Driven on a server-mode Sim (clients join via addPlayer),
// like the duel/loot tests. The grab behavior (PET1) is a separate slice.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import type { Command } from '../src/world_api';

function serverSim(seed = 1): Sim {
  return new Sim(seed, /* spawnLocal */ false);
}
function run(sim: Sim, id: number, cmd: Command): void {
  sim.sendCommandFor(id, cmd);
  sim.step();
}
const ent = (sim: Sim, id: number) => sim.entities().find((e) => e.id === id)!;
const pets = (sim: Sim) => sim.entities().filter((e) => e.kind === 'pet');
// The pet item the player must own (bought from the vendor) before a pet can be summoned.
const PET_ITEM = { itemId: 'pet_grab', rarity: 'normal' as const, plus: 0, qty: 1 };

describe('Pets — summon / dismiss / acquisition (PET0 + PET3)', () => {
  it('summoning spawns a pet linked to the owner; dismissing removes it', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { bag: [PET_ITEM] }); // owns the pet item (as if bought from the vendor)
    expect(pets(sim).length).toBe(0);
    expect(sim.petActiveFor(a)).toBe(false);

    run(sim, a, { t: 'set-pet', on: true });
    expect(sim.petActiveFor(a)).toBe(true);
    const ps = pets(sim);
    expect(ps.length).toBe(1); // a companion appeared in the world (visible to everyone, like any entity)
    expect(ps[0].kind).toBe('pet');

    run(sim, a, { t: 'set-pet', on: false });
    expect(sim.petActiveFor(a)).toBe(false);
    expect(pets(sim).length).toBe(0); // dismissed
  });

  it('cannot summon a pet you do not own (no pet item in the bag)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A'); // fresh — no pet item
    run(sim, a, { t: 'set-pet', on: true });
    expect(sim.petActiveFor(a)).toBe(false);
    expect(pets(sim).length).toBe(0); // nothing spawns without ownership
  });

  it('the pet FOLLOWS its owner as they walk (it travels with them, not left at spawn)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { bag: [PET_ITEM] });
    run(sim, a, { t: 'set-pet', on: true });
    const petId = pets(sim)[0].id;

    sim.sendCommandFor(a, { t: 'move', dx: 1, dz: 0 }); // walk the owner east a good distance
    for (let i = 0; i < 200; i++) sim.step();
    sim.sendCommandFor(a, { t: 'stop' });
    for (let i = 0; i < 40; i++) sim.step(); // let the pet catch up + settle

    const owner = ent(sim, a);
    const pet = sim.entities().find((e) => e.id === petId)!;
    const d = Math.hypot(owner.x - pet.x, owner.z - pet.z);
    expect(d).toBeLessThan(4); // the pet trailed the owner and settled close (within the follow band)
    expect(pet.x).toBeGreaterThan(5); // it actually moved with the owner (not stuck at the spawn point)
  });

  it('a disconnecting owner takes its pet with it (no ghost follower)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { bag: [PET_ITEM] });
    run(sim, a, { t: 'set-pet', on: true });
    expect(pets(sim).length).toBe(1);
    sim.removePlayer(a);
    expect(pets(sim).length).toBe(0); // the pet is despawned with its owner
  });

  it('deterministic: same seed + summon + walk => identical hash (pet folds into the world fingerprint)', () => {
    const play = (): string => {
      const sim = serverSim(7);
      const a = sim.addPlayer('A');
      sim.restorePlayer(a, { bag: [PET_ITEM] });
      run(sim, a, { t: 'set-pet', on: true });
      sim.sendCommandFor(a, { t: 'move', dx: 1, dz: 1 });
      for (let i = 0; i < 100; i++) sim.step();
      return sim.hash();
    };
    expect(play()).toBe(play());
  });

  it('a summon+dismiss returns to a byte-identical world (the pet field is inert when absent)', () => {
    const mk = (): { sim: Sim; a: number } => {
      const sim = serverSim(7);
      const a = sim.addPlayer('A');
      sim.restorePlayer(a, { bag: [PET_ITEM] });
      return { sim, a };
    };
    const toggled = mk();
    run(toggled.sim, toggled.a, { t: 'set-pet', on: true });
    run(toggled.sim, toggled.a, { t: 'set-pet', on: false }); // pet gone again
    const plain = mk();
    plain.sim.step();
    plain.sim.step();
    // Same seed/player/2 ticks; the toggled run ends with no pet -> the world hashes identically.
    expect(toggled.sim.hash()).toBe(plain.sim.hash());
  });
});
