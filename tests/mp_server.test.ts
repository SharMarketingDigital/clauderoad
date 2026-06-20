// Server-boundary tests: ServerWorld wraps the full Sim and is the authoritative seam
// the clients talk to. These assert the per-LAYER guarantees — what intent it accepts,
// and the PERSONAL state (HUD/bag) it hands back to each player. Layer 1 = combat + HUD.
import { describe, it, expect } from 'vitest';
import { ServerWorld } from '../server/world';

const enemyId = (w: ServerWorld) => w.snapshot().entities.find((e) => e.kind === 'enemy')!.id;
const selfOf = (w: ServerWorld, id: number) => w.snapshot().entities.find((e) => e.id === id)!;

// Drive a player to farm the nearest mob (re-targeting as they die) for N ticks — so a
// test can build up XP/levels/SP exactly the way a real player would, all server-side.
function farm(w: ServerWorld, a: number, steps: number): void {
  for (let i = 0; i < steps; i++) {
    const snap = w.snapshot();
    const me = snap.entities.find((e) => e.id === a);
    if (!me) break;
    let mob: { id: number; x: number; z: number } | null = null;
    let bd = Infinity;
    for (const e of snap.entities) {
      if (e.kind !== 'enemy') continue;
      const d = (e.x - me.x) ** 2 + (e.z - me.z) ** 2;
      if (d < bd) { bd = d; mob = e; }
    }
    if (mob) {
      w.setIntent(a, mob.x - me.x, mob.z - me.z);
      w.command(a, { t: 'set-target', id: mob.id });
    }
    w.step();
  }
}

describe('ServerWorld — Layer 1: combat commands + personal HUD', () => {
  it('hands each player its OWN self state (HUD + action bar)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    const sa = w.selfState(a);
    expect(sa.abilities.length).toBeGreaterThan(0); // a real action bar
    expect(sa.maxHp).toBeGreaterThan(0);
    expect(sa.maxMp).toBeGreaterThan(0);
    expect(sa.targetId).toBeNull();
    expect(w.selfState(b).targetId).toBeNull();
  });

  it('accepts set-target (combat) and keeps it PER PLAYER', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    const eid = enemyId(w);
    w.command(a, { t: 'set-target', id: eid });
    w.step();
    expect(w.selfState(a).targetId).toBe(eid); // A locked on
    expect(w.selfState(b).targetId).toBeNull(); // B unaffected — independent
  });

  it('rejects a command not wired in this layer (set-bot stays off)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    w.command(a, { t: 'set-bot', on: true }); // Layer 4 — not accepted yet
    w.step();
    expect(w.selfState(a).botActive).toBe(false);
  });

  it('routes use-ability — a cast fires on the server (MP spent or cooldown started)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const eid = enemyId(w);
    const mp0 = w.selfState(a).maxMp;
    let cast = false;
    for (let i = 0; i < 500 && !cast; i++) {
      const me = selfOf(w, a);
      const t = w.snapshot().entities.find((e) => e.id === eid);
      if (!t) break;
      w.setIntent(a, t.x - me.x, t.z - me.z); // close the distance
      w.command(a, { t: 'set-target', id: eid });
      w.command(a, { t: 'use-ability', slot: 1 });
      w.step();
      const self = w.selfState(a);
      const slot1 = self.abilities.find((x) => x.slot === 1);
      if (self.mp < mp0 || (slot1 != null && slot1.cooldownRemaining > 0)) cast = true;
    }
    expect(cast).toBe(true); // the ability was accepted + processed by the sim
  });

  it('snapshot is shared, self is personal — both reflect the same authoritative world', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    for (let i = 0; i < 10; i++) w.step();
    const snap = w.snapshot();
    const meInSnap = snap.entities.find((e) => e.id === a)!;
    const self = w.selfState(a);
    expect(meInSnap.hp).toBe(self.hp); // the shared view and the personal view agree
    expect(meInSnap.maxHp).toBe(self.maxHp);
  });
});

describe('ServerWorld — Layer 2: personal progression (XP/attr/SP/ranks)', () => {
  it('farming grants XP/level/attr points/SP server-side, per player', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const before = w.selfState(a);
    farm(w, a, 3000); // kill a bunch of mobs like a real player
    const after = w.selfState(a);
    expect(after.sp).toBeGreaterThan(before.sp); // SP comes from kills
    expect(after.level + after.xp).toBeGreaterThan(before.level + before.xp); // it progressed
    expect(after.attrPoints).toBeGreaterThan(0); // leveled up at least once
  });

  it('accepts spend-attr — a point converts to Strength (server decides)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    farm(w, a, 3000);
    for (let i = 0; i < 200 && w.selfState(a).hp <= 0; i++) w.step(); // wait out any respawn
    const before = w.selfState(a);
    expect(before.attrPoints).toBeGreaterThan(0);
    w.command(a, { t: 'spend-attr', attr: 'str' });
    w.step();
    // str only ever moves via spend-attr (gear unchanged), so this is a clean proof the
    // server accepted + applied the spend — robust to any incidental kill on the same tick.
    expect(w.selfState(a).str).toBeGreaterThan(before.str);
  });

  it('accepts rank-up — SP raises an ability rank (server decides)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    farm(w, a, 3000);
    for (let i = 0; i < 200 && w.selfState(a).hp <= 0; i++) w.step();
    const s0 = w.selfState(a);
    const ab = s0.abilities.find((x) => x.rank < x.maxRank && x.rankCost <= s0.sp);
    expect(ab).toBeDefined(); // we earned enough SP to raise something
    const rank0 = ab!.rank;
    w.command(a, { t: 'rank-up', slot: ab!.slot });
    w.step();
    // the sim only raises a rank by deducting SP, so a +1 rank proves SP was spent.
    const raised = w.selfState(a).abilities.find((x) => x.slot === ab!.slot)!;
    expect(raised.rank).toBe(rank0 + 1);
  });

  it('ignores malformed / out-of-layer progression commands (no corruption)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    farm(w, a, 1500); // earn some points
    const before = w.selfState(a);
    w.command(a, { t: 'spend-attr', attr: 'maxHp' } as never); // bad attr -> dropped at the boundary
    w.command(a, { t: 'rank-up', slot: 99 }); // out-of-range slot -> dropped
    w.command(a, { t: 'equip', itemId: 'x', rarity: 'normal', plus: 0 } as never); // Layer 3 — not wired yet
    w.step();
    // str only ever moves via an accepted spend-attr; none was accepted -> unchanged.
    expect(w.selfState(a).str).toBe(before.str);
  });

  it('two players progress INDEPENDENTLY (each their own XP/SP)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    farm(w, a, 2500); // only A farms
    const sa = w.selfState(a);
    const sb = w.selfState(b);
    expect(sa.sp).toBeGreaterThan(0); // A earned SP
    expect(sb.sp).toBe(0); // B did nothing -> still zero (personal, not shared)
    expect(sb.attrPoints).toBe(0);
  });
});

describe('ServerWorld — Layer 3: inventory, loot, equip + vendor economy', () => {
  it('self carries the bag + shop, per player', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const s = w.selfState(a);
    expect(s.inventory).toBeDefined();
    expect(s.inventory.capacity).toBeGreaterThan(0);
    expect(s.inventory.equipment.length).toBeGreaterThan(0); // weapon + armor slots
    expect(s.shop).toBeDefined();
    expect(s.shop.stock.length).toBeGreaterThan(0); // the vendor sells something
    expect(s.shop.inRange).toBe(false); // spawned away from the vendor
  });

  it('loot + gold land in the KILLER, per player', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    farm(w, a, 3000); // only A farms
    const sa = w.selfState(a);
    const sb = w.selfState(b);
    expect(sa.inventory.stacks.length).toBeGreaterThan(0); // A looted items
    expect(sa.gold).toBeGreaterThan(0); // and earned gold from kills
    expect(sb.inventory.stacks.length).toBe(0); // B got nothing — loot is personal
    expect(sb.gold).toBe(0);
  });

  it('accepts equip — a looted item goes onto the character (server applies it)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    let gear: { itemId: string; rarity: 'normal' | 'sos' | 'som' | 'sun'; plus: number; equipSlot?: 'weapon' | 'armor' } | undefined;
    for (let r = 0; r < 10 && !gear; r++) {
      farm(w, a, 1200);
      gear = w.selfState(a).inventory.stacks.find((s) => s.equipSlot != null) as typeof gear;
    }
    expect(gear).toBeDefined(); // looted some equippable gear
    w.command(a, { t: 'equip', itemId: gear!.itemId, rarity: gear!.rarity, plus: gear!.plus });
    w.step();
    const eq = w.selfState(a).inventory.equipment.find((e) => e.slot === gear!.equipSlot);
    expect(eq!.itemId).toBe(gear!.itemId); // it's now equipped (the server decided it)
  });

  it('the vendor loop works in MP — walk into range, sell loot for gold', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    farm(w, a, 2500); // earn loot to sell
    const vendor = w.snapshot().entities.find((e) => e.kind === 'npc')!;
    for (let i = 0; i < 2500 && !w.selfState(a).shop.inRange; i++) {
      const me = selfOf(w, a);
      w.command(a, { t: 'set-target', id: null }); // stop attacking
      w.setIntent(a, vendor.x - me.x, vendor.z - me.z); // walk to the shop
      w.step();
    }
    expect(w.selfState(a).shop.inRange).toBe(true); // reached the vendor
    const s = w.selfState(a);
    const sellable = s.inventory.stacks.find((st) => st.sellValue > 0);
    expect(sellable).toBeDefined();
    const gold0 = s.gold;
    w.command(a, { t: 'sell', itemId: sellable!.itemId, rarity: sellable!.rarity, plus: sellable!.plus });
    w.step(); // sell is drained BEFORE movement, so it lands while still in range
    expect(w.selfState(a).gold).toBeGreaterThan(gold0); // converted loot to gold
  });
});
