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

describe('Pets — grab pet auto-collect (PET1)', () => {
  // Farm the nearest mob (walk onto it + auto-attack) for N ticks, like a real player. Mob kills drop
  // loot on the GROUND (LF-S4), near where the player stands — exactly where a trailing pet can reach.
  const farm = (sim: Sim, a: number, steps: number, stopWhen: () => boolean): void => {
    for (let i = 0; i < steps && !stopWhen(); i++) {
      const me = ent(sim, a);
      let mob: { id: number; x: number; z: number } | null = null;
      let bd = Infinity;
      for (const e of sim.entities()) {
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
  };
  const bagCount = (sim: Sim, a: number) => (sim.serializePlayer(a)?.bag ?? []).filter((s) => s != null).length;

  it('the summoned grab pet vacuums nearby ground loot into the owner bag', () => {
    const sim = serverSim(1337);
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { bag: [PET_ITEM], baseStr: 400 }); // owns the pet + hits hard (fast kills -> ground loot)
    run(sim, a, { t: 'set-pet', on: true });
    expect(bagCount(sim, a)).toBe(1); // only the pet item to start
    // A never sends a pickup, so ANY bag growth is the trailing pet auto-grabbing a ground drop.
    farm(sim, a, 3000, () => bagCount(sim, a) > 1);
    expect(bagCount(sim, a)).toBeGreaterThan(1); // the pet collected at least one drop
  });

  it('without a summoned pet, ground loot is NOT auto-collected (the pet is what does it)', () => {
    const sim = serverSim(1337);
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { bag: [PET_ITEM], baseStr: 400 }); // owns the item but does NOT summon a pet
    let groundLootSeen = false;
    farm(sim, a, 3000, () => false);
    // (re-check after the farm: loot is still on the ground, untouched)
    if (sim.entities().some((e) => e.kind === 'loot')) groundLootSeen = true;
    expect(groundLootSeen).toBe(true); // loot DID drop on the ground...
    expect(bagCount(sim, a)).toBe(1); // ...but with no pet, it stayed there (bag is still just the pet item)
  });
});

describe('Pets — transport pet bag (PET2)', () => {
  const SWORD = { itemId: 'old_sword', rarity: 'normal' as const, plus: 0, qty: 1 };
  const hasSword = (arr: ({ itemId: string } | null)[]) => arr.filter((s) => s != null && s.itemId === 'old_sword').length;

  it('with a pet summoned, you can stow a bag item in the pet bag and take it back', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { bag: [PET_ITEM, SWORD] }); // owns the pet + a sword to stow
    run(sim, a, { t: 'set-pet', on: true });
    expect(sim.petBagFor(a).available).toBe(true);

    run(sim, a, { t: 'pet-deposit', itemId: 'old_sword', rarity: 'normal', plus: 0 });
    expect(sim.petBagFor(a).stacks.some((s) => s.itemId === 'old_sword')).toBe(true); // in the pet bag now
    expect(hasSword(sim.serializePlayer(a)!.bag)).toBe(0); // left the main bag

    run(sim, a, { t: 'pet-withdraw', itemId: 'old_sword', rarity: 'normal', plus: 0 });
    expect(sim.petBagFor(a).stacks.length).toBe(0); // back out of the pet bag
    expect(hasSword(sim.serializePlayer(a)!.bag)).toBe(1); // back in the main bag
  });

  it('cannot use the pet bag without a pet summoned', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { bag: [PET_ITEM, SWORD] }); // owns the pet item but does NOT summon
    expect(sim.petBagFor(a).available).toBe(false);
    run(sim, a, { t: 'pet-deposit', itemId: 'old_sword', rarity: 'normal', plus: 0 });
    expect(sim.petBagFor(a).stacks.length).toBe(0); // nothing stowed (no pet out)
    expect(hasSword(sim.serializePlayer(a)!.bag)).toBe(1); // still in the bag
  });

  it('the pet bag persists across a serialize -> restore round-trip', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { bag: [PET_ITEM, SWORD] });
    run(sim, a, { t: 'set-pet', on: true });
    run(sim, a, { t: 'pet-deposit', itemId: 'old_sword', rarity: 'normal', plus: 0 });
    const save = sim.serializePlayer(a)!;
    expect(hasSword(save.petBag)).toBe(1); // the pet bag is in the save

    const sim2 = serverSim();
    const b = sim2.addPlayer('B');
    sim2.restorePlayer(b, save); // returning player
    expect(sim2.petBagFor(b).stacks.some((s) => s.itemId === 'old_sword')).toBe(true); // pet bag came back
  });
});
