// Server-boundary tests: ServerWorld wraps the full Sim and is the authoritative seam
// the clients talk to. These assert the per-LAYER guarantees — what intent it accepts,
// and the PERSONAL state (HUD/bag) it hands back to each player. Layer 1 = combat + HUD.
import { describe, it, expect } from 'vitest';
import { ServerWorld } from '../server/world';
import { VENDOR_STOCK } from '../src/sim/content/vendor';
import { WAREHOUSE_SPAWN_X, WAREHOUSE_SPAWN_Z } from '../src/sim/storage';
import type { EquipSlot } from '../src/world_api';

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

  it('Sistema 2: espelha as passivas no self state (paridade online) e as mantém FORA da action bar', () => {
    const w = new ServerWorld(7);
    const a = w.addPlayer('A');
    // nv2 destrava a passiva; desarmado => Espada (Corpo de Ferro). SP de sobra pra ranquear.
    w.restorePlayer(a, {
      level: 2, xp: 0, attrPoints: 0, baseStr: 20, baseInt: 5, baseMaxHp: 140, baseMaxMp: 60,
      sp: 500, skillRanks: {}, gold: 0, bag: [], equipment: {},
    });
    const s1 = w.selfState(a);
    expect(s1.passives.map((p) => p.name)).toEqual(['Corpo de Ferro']); // espelhada no snapshot pessoal
    expect(s1.passives[0].rank).toBe(1);
    expect(s1.passives[0].slot).toBe(5);
    expect(s1.passives[0].unlocked).toBe(true); // Sistema 1: flag de destrave também no online (nv2)
    expect(s1.abilities.some((ab) => ab.slot === 5)).toBe(false); // NUNCA na action bar (paridade com o offline)
    // Sistema 1 (HUD do destrave): o kit completo trafega com o flag — o slot 4 (Corte Amplo, nv7) chega ao
    // cliente BLOQUEADO (unlocked:false) pra o painel de skills previsualizar. Paridade offline/online.
    const s4 = s1.abilities.find((ab) => ab.slot === 4);
    expect(s4).toBeDefined();
    expect(s4!.unlocked).toBe(false);
    expect(s4!.unlockLevel).toBe(7);
    // ranquear via comando sobe o rank no self state — o online reflete a mesma mecânica do sim
    w.command(a, { t: 'rank-up', slot: 5 });
    w.step();
    expect(w.selfState(a).passives[0].rank).toBe(2);
  });

  it('Sistema 2: o respec (use-item skill_reset) atravessa o seam do ServerWorld — paridade offline/online', () => {
    // O reset é a mudança mais sensível (muta sp + skillRanks, estado HASHEADO). Guarda de regressão contra a
    // classe "whitelist K1": se um refactor derrubar o forward de use-item no server, o respec pararia de
    // funcionar online e o SP/ranks divergiriam do offline SEM nenhum teste falhando.
    const w = new ServerWorld(7);
    const a = w.addPlayer('A');
    w.restorePlayer(a, {
      level: 7, xp: 0, attrPoints: 0, baseStr: 20, baseInt: 5, baseMaxHp: 140, baseMaxMp: 60,
      sp: 500, skillRanks: {}, gold: 0,
      bag: [{ itemId: 'skill_reset', rarity: 'normal', plus: 0, qty: 1 }], equipment: {},
    });
    const sp0 = w.selfState(a).sp;
    w.command(a, { t: 'rank-up', slot: 1 }); w.step(); // slot 1: rank 1 -> 2
    w.command(a, { t: 'rank-up', slot: 1 }); w.step(); // -> 3
    expect(w.selfState(a).sp).toBeLessThan(sp0);
    expect(w.selfState(a).abilities.find((x) => x.slot === 1)!.rank).toBe(3);
    // usa o pergaminho PELO seam -> devolve o SP e zera os ranks (idêntico ao Sim offline)
    w.command(a, { t: 'use-item', itemId: 'skill_reset', rarity: 'normal', plus: 0 });
    w.step();
    expect(w.selfState(a).sp).toBe(sp0); // SP de volta ao total
    expect(w.selfState(a).abilities.find((x) => x.slot === 1)!.rank).toBe(1); // ranks zerados
    expect(w.selfState(a).inventory.stacks.some((s) => s.itemId === 'skill_reset')).toBe(false); // consumido
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

  it('ignores an unknown / malformed command at the boundary (no crash)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const hp0 = w.selfState(a).hp;
    w.command(a, { t: 'not-a-real-command' } as never); // unknown discriminant -> default
    w.command(a, null as never); // non-object -> rejected up front
    w.command(a, { t: 'use-ability' } as never); // missing slot -> field guard rejects
    w.step();
    expect(w.selfState(a).hp).toBe(hp0); // nothing threw; state intact
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
    expect(w.snapshot().entities.filter((e) => e.kind === 'loot').length).toBeGreaterThan(0); // LF-S4: items drop on the GROUND (FFA), not into the bag
    expect(sa.gold).toBeGreaterThan(0); // the killer still earns gold from kills
    expect(sb.inventory.stacks.length).toBe(0); // B got nothing in its bag (loot is on the ground)
    expect(sb.gold).toBe(0);
  });

  it('the snapshot carries the loot CONTENTS for ground-loot entities (and ONLY those) — remote clients see the drop', () => {
    // The MP gap this closes: the chest (kind 'loot') crossed the wire, but its contents did not, so a
    // remote player saw an anonymous box. Now EntitySnap.loot carries name/rarity/+N/qty for loot only.
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    farm(w, a, 3000); // mob kills drop loot on the GROUND (LF-S4), exactly like a real player
    const snap = w.snapshot();
    const loot = snap.entities.find((e) => e.kind === 'loot');
    expect(loot).toBeDefined(); // a chest is on the ground after farming
    // its CONTENTS now cross the wire, so a remote client can render what dropped
    expect(loot!.loot).toBeTruthy();
    expect(typeof loot!.loot!.itemId).toBe('string');
    expect(loot!.loot!.itemId.length).toBeGreaterThan(0);
    expect(loot!.loot!.name.length).toBeGreaterThan(0);
    expect(['normal', 'sos', 'som', 'sun']).toContain(loot!.loot!.rarity);
    expect(loot!.loot!.qty).toBeGreaterThan(0);
    expect(Number.isInteger(loot!.loot!.plus)).toBe(true);
    // and NON-loot entities (players/mobs/NPC) stay lean — no loot field, so the snapshot isn't bloated
    const nonLoot = snap.entities.filter((e) => e.kind !== 'loot');
    expect(nonLoot.length).toBeGreaterThan(0);
    expect(nonLoot.every((e) => e.loot === undefined)).toBe(true);
  });

  it('accepts equip — a looted item goes onto the character (server applies it)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    w.restorePlayer(a, { bag: [{ itemId: 'old_sword', rarity: 'normal', plus: 0, qty: 1 }] }); // LF-S4: inject (mob loot drops on the ground now)
    const gear = w.selfState(a).inventory.stacks.find((s) => s.equipSlot != null) as { itemId: string; rarity: 'normal' | 'sos' | 'som' | 'sun'; plus: number; equipSlot?: EquipSlot } | undefined;
    expect(gear).toBeDefined(); // injected some equippable gear
    w.command(a, { t: 'equip', itemId: gear!.itemId, rarity: gear!.rarity, plus: gear!.plus });
    w.step();
    const eq = w.selfState(a).inventory.equipment.find((e) => e.slot === gear!.equipSlot);
    expect(eq!.itemId).toBe(gear!.itemId); // it's now equipped (the server decided it)
  });

  it('accepts unequip on a NON-weapon slot — the server whitelist covers all 10 equip slots (K1)', () => {
    // Regression guard for K1: the server's VALID_SLOTS used to be {weapon,armor}, so online
    // it silently dropped unequip/enhance/repair for the 8 real non-weapon slots. This drives
    // that exact path through ServerWorld.command() with a looted armor piece (e.g. chest).
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    w.restorePlayer(a, { bag: [{ itemId: 'wolf_leather', rarity: 'normal', plus: 0, qty: 1 }] }); // LF-S4: inject a non-weapon piece (loot drops on the ground now)
    const gear = w.selfState(a).inventory.stacks.find((s) => s.equipSlot != null && s.equipSlot !== 'weapon') as { itemId: string; rarity: 'normal' | 'sos' | 'som' | 'sun'; plus: number; equipSlot?: EquipSlot } | undefined;
    expect(gear).toBeDefined(); // injected a non-weapon piece (armor/accessory)
    expect(gear!.equipSlot).not.toBe('weapon');
    const slot = gear!.equipSlot!;
    w.command(a, { t: 'equip', itemId: gear!.itemId, rarity: gear!.rarity, plus: gear!.plus });
    w.step();
    expect(w.selfState(a).inventory.equipment.find((e) => e.slot === slot)!.itemId).toBe(gear!.itemId);
    // The regression assertion: unequip that non-weapon slot THROUGH THE SERVER. Under the old
    // {weapon,armor} whitelist this command was silently discarded and the slot stayed filled.
    w.command(a, { t: 'unequip', slot });
    w.step();
    expect(w.selfState(a).inventory.equipment.find((e) => e.slot === slot)!.itemId).toBeNull();
  });

  it('forwards the enhance useProtection flag — protection is NOT dropped online (K4)', () => {
    // Regression guard for K4 (the same shape as the K1 whitelist bug): the server REBUILDS the
    // enhance command from validated fields. If it forwarded only {slot, useLuckyPowder} and
    // dropped useProtection, a high-"+" failure could DESTROY the weapon online while the
    // single-player sim (which gets the flag directly) protected it. Set up a weapon in the RISK
    // band (+5 >= RISK_FLOOR) with elixirs + protection stones via restore, then drive many
    // PROTECTED enhances THROUGH THE SERVER and assert it never breaks and stones are spent.
    const w = new ServerWorld(7);
    const a = w.addPlayer('A');
    w.restorePlayer(a, {
      level: 30, xp: 0, attrPoints: 0, baseStr: 30, baseInt: 5, baseMaxHp: 400, baseMaxMp: 100,
      sp: 0, skillRanks: {}, gold: 0,
      bag: [
        { itemId: 'elixir_weapon', rarity: 'normal', plus: 0, qty: 60 },
        { itemId: 'protect_stone', rarity: 'normal', plus: 0, qty: 60 },
      ],
      equipment: { weapon: { itemId: 'old_sword', rarity: 'normal', plus: 5, durability: 100 } },
    });
    const weaponSlot = () => w.selfState(a).inventory.equipment.find((e) => e.slot === 'weapon')!;
    const stones = (): number =>
      w.selfState(a).inventory.stacks.filter((s) => s.itemId === 'protect_stone').reduce((n, s) => n + s.qty, 0);
    expect(weaponSlot().itemId).toBe('old_sword'); // equipped in the risk band (+5)
    const stones0 = stones();

    for (let i = 0; i < 40; i++) {
      w.command(a, { t: 'enhance', slot: 'weapon', useProtection: true });
      w.step();
      expect(weaponSlot().itemId).not.toBeNull(); // protected: the weapon is NEVER destroyed
    }
    // A protected failure in the risk band consumes a stone; over 40 attempts at least one
    // failed. If the server had dropped useProtection, NO stone would be spent (and the weapon
    // could have broken above) — exactly the regression this guards.
    expect(stones()).toBeLessThan(stones0);
  });

  it('encaminha useProtection VERBATIM para o comando do sim (direto, sem depender de seed) (K4)', () => {
    const w = new ServerWorld(7);
    const a = w.addPlayer('A');
    // Espiona a fronteira servidor->sim: prova o forward diretamente, sem depender de uma falha
    // sorteada (mais robusto que inferir pela quebra/gasto de pedra ao longo de N tentativas).
    const sim = (w as unknown as { sim: { sendCommandFor(id: number, cmd: Record<string, unknown>): void } }).sim;
    const orig = sim.sendCommandFor.bind(sim);
    const seen: Record<string, unknown>[] = [];
    sim.sendCommandFor = (id, cmd) => { seen.push(cmd); orig(id, cmd); };

    w.command(a, { t: 'enhance', slot: 'weapon', useProtection: true });
    const fwd = seen.find((c) => c.t === 'enhance')!;
    expect(fwd).toBeDefined();
    expect(fwd.useProtection).toBe(true);
    expect(fwd.slot).toBe('weapon');

    // o caso undefined é preservado (não coagido para false)
    seen.length = 0;
    w.command(a, { t: 'enhance', slot: 'weapon' });
    expect(seen.find((c) => c.t === 'enhance')!.useProtection).toBeUndefined();
  });

  it('the vendor loop works in MP — walk into range, sell loot for gold', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    w.restorePlayer(a, { bag: [{ itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 10 }] }); // LF-S4: inject sellable items (loot drops on the ground now)
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

  it('roteia depósito/saque pelo servidor e persiste o armazém por jogador (K5)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    // seed A's bag and walk it to the warehouse (town safe zone — no mobs en route)
    w.restorePlayer(a, { bag: [{ itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 6 }], storage: [], equipment: {} });
    for (let i = 0; i < 1500 && !w.selfState(a).storage.inRange; i++) {
      const me = w.snapshot().entities.find((e) => e.id === a)!;
      w.setIntent(a, WAREHOUSE_SPAWN_X - me.x, WAREHOUSE_SPAWN_Z - me.z);
      w.step();
    }
    expect(w.selfState(a).storage.inRange).toBe(true);
    // the deposit command is ROUTED by the server whitelist (not silently dropped — K1 lesson)
    w.command(a, { t: 'deposit', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    w.step();
    expect(w.selfState(a).storage.stacks.find((s) => s.itemId === 'health_potion')!.qty).toBe(6);
    expect(w.selfState(a).inventory.stacks.some((s) => s.itemId === 'health_potion')).toBe(false);
    expect(w.selfState(b).storage.stacks.length).toBe(0); // B's warehouse is independent (per-owner)
    // persists in the save (serialize round-trips the warehouse)
    expect(w.serializePlayer(a)!.storage).toEqual([{ itemId: 'health_potion', rarity: 'normal', plus: 0, qty: 6 }]);
    // and the WITHDRAW path is routed by the server whitelist too (round-trip back to the bag)
    w.command(a, { t: 'withdraw', itemId: 'health_potion', rarity: 'normal', plus: 0 });
    w.step();
    expect(w.selfState(a).inventory.stacks.find((s) => s.itemId === 'health_potion')!.qty).toBe(6);
    expect(w.selfState(a).storage.stacks.length).toBe(0);
  });
});

describe('ServerWorld — Layer 4: per-player auto-play (bot)', () => {
  it('accepts set-bot and toggles ONLY that player', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    w.command(a, { t: 'set-bot', on: true });
    w.step();
    expect(w.selfState(a).botActive).toBe(true); // A's bot on
    expect(w.selfState(b).botActive).toBe(false); // B unaffected (per-player)
    w.command(a, { t: 'set-bot', on: false });
    w.step();
    expect(w.selfState(a).botActive).toBe(false); // toggled back off
  });

  it('the bot plays the SERVER-side player with NO manual input (it survives + evolves)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    w.command(a, { t: 'set-bot', on: true });
    const before = w.selfState(a);
    for (let i = 0; i < 4000; i++) w.step(); // hands off — the server's bot plays this player
    const after = w.selfState(a);
    expect(after.botActive).toBe(true);
    // level+xp only ever goes UP (kills), so this proves the bot fought + progressed alone.
    expect(after.level + after.xp).toBeGreaterThan(before.level + before.xp);
  });

  it('two players run INDEPENDENT bots — A on, B off', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    w.command(a, { t: 'set-bot', on: true }); // only A's bot is on; B sends nothing
    for (let i = 0; i < 3000; i++) w.step();
    const sa = w.selfState(a);
    const sb = w.selfState(b);
    expect(sa.level + sa.xp).toBeGreaterThan(1); // A's bot farmed + progressed
    expect(sb.level).toBe(1); // B did nothing — no bot, no input
    expect(sb.xp).toBe(0);
    expect(sb.botActive).toBe(false);
  });
});

// Farm the nearest mob until the player has at least `target` gold (stops as soon as it's
// reached, so loot doesn't overfill the bag). Mirrors how a real player earns to shop.
// Walk a player to the town vendor (server-side) until shop.inRange becomes true.
// Walk a player to a SPECIFIC shop NPC (by species) — the town now has specialized shops (ferreiro/
// armadureiro/boticário/alquimista), each selling a slice of the catalog. Loops on DISTANCE to the
// target NPC (not shop.inRange, which would trip on a nearer shop en route).
function goToShop(w: ServerWorld, a: number, species: string): void {
  const npc = w.snapshot().entities.find((e) => e.kind === 'npc' && e.species === species)!;
  w.command(a, { t: 'set-target', id: null });
  for (let i = 0; i < 1500; i++) {
    const me = w.snapshot().entities.find((e) => e.id === a)!;
    const dx = npc.x - me.x;
    const dz = npc.z - me.z;
    if (dx * dx + dz * dz <= 9) break; // within ~3 units -> inside the interaction range of THIS shop
    w.setIntent(a, dx, dz);
    w.step();
  }
  w.setIntent(a, 0, 0);
  w.step();
}

describe('ServerWorld — Layer 3: vendor buy (online path)', () => {
  it('a player buys items (incl. the Mago staff) through the server: gold spent + item in the bag', () => {
    const w = new ServerWorld(7);
    const a = w.addPlayer('A');
    const staffPrice = VENDOR_STOCK.find((s) => s.itemId === 'apprentice_staff')!.price;
    const potPrice = VENDOR_STOCK.find((s) => s.itemId === 'health_potion')!.price;
    // Grant the gold directly (the subject here is the BUY path, not farming).
    w.restorePlayer(a, { gold: staffPrice + potPrice + 50 });

    // a basic stackable (poção) buys at the BOTICÁRIO: gold drops by the price, the item lands in the bag
    goToShop(w, a, 'apothecary');
    expect(w.selfState(a).shop.inRange).toBe(true);
    const g0 = w.selfState(a).gold;
    w.command(a, { t: 'buy', itemId: 'health_potion' });
    w.step();
    const s1 = w.selfState(a);
    expect(s1.gold).toBe(g0 - potPrice);
    expect(s1.inventory.stacks.some((x) => x.itemId === 'health_potion')).toBe(true);

    // the Mago staff buys at the FERREIRO (specialized shops — each sells its own slice)
    goToShop(w, a, 'blacksmith');
    expect(w.selfState(a).shop.stock.some((s) => s.itemId === 'apprentice_staff')).toBe(true); // staff listed there
    const g1 = w.selfState(a).gold;
    w.command(a, { t: 'buy', itemId: 'apprentice_staff' });
    w.step();
    const s2 = w.selfState(a);
    expect(s2.gold).toBe(g1 - staffPrice);
    expect(s2.inventory.stacks.some((x) => x.itemId === 'apprentice_staff')).toBe(true);
  });
});

describe('ServerWorld — class selection (G1)', () => {
  it('select-class equips the class starter weapon for a fresh player', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const weapon = () => w.selfState(a).inventory.equipment.find((e) => e.slot === 'weapon')!.itemId;
    expect(weapon()).toBeNull(); // fresh: unarmed
    w.command(a, { t: 'select-class', classId: 'mage' });
    w.step();
    expect(weapon()).toBe('apprentice_staff'); // class kit applied via the server whitelist
  });
});
