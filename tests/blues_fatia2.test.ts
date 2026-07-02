// Sistema 3 (Magic Options / "azuis") — Fatia 2: o item azul JOGÁVEL DE PONTA A PONTA. A Fatia 1 provou que o
// stacking-identity aguenta os azuis; aqui a referência de item se estende aos COMANDOS (equip/sell/deposit/
// withdraw/use-item/market carregam a identidade CHEIA), a UI/views a refletem, e o server a threada online.
// Os três testes-alvo do Shar: (1) equipar um item azul aplica os stats certos; (2) vender remove a stack
// CERTA (o gêmeo sem-azul não é tocado); (3) paridade online (o server não perde os azuis no snapshot).
import { describe, it, expect } from 'vitest';
import { Sim, rarityStat } from '../src/sim/sim';
import { ServerWorld } from '../server/world';
import { addToBag, BAG_SLOTS } from '../src/sim/inventory';
import { bluesKey } from '../src/sim/content/magic_options';
import type { BlueLine } from '../src/sim/content/magic_options';
import type { Entity, ItemStack } from '../src/sim/types';
import { WAREHOUSE_SPAWN_X, WAREHOUSE_SPAWN_Z } from '../src/sim/storage';

type Internal = {
  ents: Map<number, Entity>;
  stalls: Map<number, unknown[]>;
  openStall: (p: Entity, req: ReadonlyArray<{ itemId: string; rarity: string; plus: number; price: number }>) => void;
};
const player = (sim: Sim): Entity => [...(sim as unknown as Internal).ents.values()].find((e) => e.kind === 'player')!;
const bagStacks = (sim: Sim) => sim.inventory().stacks;
const STR3: BlueLine[] = [{ id: 'str', level: 3 }];
const ARMORER_X = 16, ARMORER_Z = 6; // um shop NPC da cidade (TOWN_SHOPS) — perto o bastante p/ nearestShop
// Posiciona o jogador (posição é transiente; nenhum passo a reseta sem um move-intent).
const placeAt = (sim: Sim, x: number, z: number): void => { const p = player(sim); p.x = x; p.z = z; };

describe('Blues Fatia 2 — EQUIPAR (a identidade cheia aplica os stats certos)', () => {
  // Isola o delta azul: equipa a MESMA peça com e sem azul e compara. O couro branco não dá STR nenhum,
  // então str é 100% do azul; o phyDef branco escala por raridade, então comparo contra o equip sem-azul.
  const equipChest = (blues?: BlueLine[]): Entity => {
    const sim = new Sim(1);
    addToBag(player(sim).bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, blues);
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: 'sos', plus: 0, blues });
    sim.step();
    return player(sim);
  };

  it('equipar um item azul aplica os stats (str +3 e phyDef +2 FLAT sobre a peça branca)', () => {
    const plain = equipChest();
    const blue = equipChest([{ id: 'str', level: 3 }, { id: 'phyDef', level: 2 }]);
    expect(blue.equipment.chest).toBeTruthy(); // equipou de fato
    expect(bluesKey(blue.equipment.chest?.blues)).toBe('phyDef:2,str:3'); // a identidade foi p/ o slot
    expect(blue.str - plain.str).toBe(3); // str: 100% do azul (o couro branco não dá str)
    expect(blue.phyDef - plain.phyDef).toBe(2); // phyDef: o azul soma +2 FLAT em cima do branco escalado
  });

  it('equipar SEM os azuis no comando NÃO equipa o item azul (a identidade tem que casar)', () => {
    const sim = new Sim(1);
    addToBag(player(sim).bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, STR3); // só o item AZUL na bolsa
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: 'sos', plus: 0 }); // comando SEM blues
    sim.step();
    expect(player(sim).equipment.chest).toBeFalsy(); // referenciou a variante sem-azul -> não achou -> no-op
    expect(bagStacks(sim).length).toBe(1); // o item azul continua na bolsa (nada perdido)
  });

  it('CRÍTICO: com gêmeo azul + sem-azul, equipa a stack CERTA (a azul) e deixa a outra na bolsa', () => {
    const sim = new Sim(1);
    const p = player(sim);
    addToBag(p.bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, STR3); // azul
    addToBag(p.bag, 'wolf_leather', 'sos', 0, 1); // gêmeo SEM-azul (mesmo id/rarity/plus)
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: 'sos', plus: 0, blues: STR3 });
    sim.step();
    expect(bluesKey(player(sim).equipment.chest?.blues)).toBe('str:3'); // equipou a AZUL
    const left = bagStacks(sim);
    expect(left.length).toBe(1);
    expect(left[0].blues).toBeUndefined(); // o gêmeo sem-azul ficou intacto na bolsa
  });
});

describe('Blues Fatia 2 — VENDER (remove a stack certa pelos azuis)', () => {
  it('vender o item AZUL remove só a stack azul; o gêmeo sem-azul permanece (e vice-versa)', () => {
    const sim = new Sim(1);
    const p = player(sim);
    addToBag(p.bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, STR3); // azul
    addToBag(p.bag, 'wolf_leather', 'sos', 0, 1); // gêmeo sem-azul
    placeAt(sim, ARMORER_X, ARMORER_Z);
    const gold0 = p.gold;

    sim.sendCommand({ t: 'sell', itemId: 'wolf_leather', rarity: 'sos', plus: 0, blues: STR3 }); // vende a AZUL
    sim.step();
    let left = bagStacks(sim);
    expect(left.length).toBe(1);
    expect(left[0].blues).toBeUndefined(); // sobrou o sem-azul (a azul saiu)
    expect(player(sim).gold).toBe(gold0 + rarityStat(8, 'sos')); // pagou o valor da peça

    sim.sendCommand({ t: 'sell', itemId: 'wolf_leather', rarity: 'sos', plus: 0 }); // agora vende o sem-azul
    sim.step();
    expect(bagStacks(sim).length).toBe(0); // bolsa vazia — cada venda tirou a stack certa
  });
});

describe('Blues Fatia 2 — ARMAZÉM + MERCADO (a identidade viaja nos comandos)', () => {
  it('depositar e sacar um item azul faz roundtrip e NÃO funde com o gêmeo sem-azul', () => {
    const sim = new Sim(1);
    const p = player(sim);
    addToBag(p.bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, [{ id: 'str', level: 2 }]); // azul
    addToBag(p.bag, 'wolf_leather', 'sos', 0, 1); // gêmeo sem-azul
    placeAt(sim, WAREHOUSE_SPAWN_X, WAREHOUSE_SPAWN_Z);

    sim.sendCommand({ t: 'deposit', itemId: 'wolf_leather', rarity: 'sos', plus: 0, blues: [{ id: 'str', level: 2 }] });
    sim.step();
    expect(bluesKey(sim.storage().stacks[0]?.blues)).toBe('str:2'); // a azul foi p/ o armazém (view carrega o azul)
    expect(bagStacks(sim).every((s) => s.blues === undefined)).toBe(true); // na bolsa sobrou só a sem-azul

    sim.sendCommand({ t: 'withdraw', itemId: 'wolf_leather', rarity: 'sos', plus: 0, blues: [{ id: 'str', level: 2 }] });
    sim.step();
    const keys = new Set(bagStacks(sim).map((s) => bluesKey(s.blues)));
    expect(keys).toEqual(new Set(['str:2', ''])); // as DUAS na bolsa, ainda separadas (não fundiram)
  });

  it('listar um item azul no mercado escrowa a stack certa; a listing carrega os azuis', () => {
    const sim = new Sim(1);
    const p = player(sim);
    addToBag(p.bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, STR3); // azul
    addToBag(p.bag, 'wolf_leather', 'sos', 0, 1); // gêmeo sem-azul
    sim.sendCommand({ t: 'market-list', itemId: 'wolf_leather', rarity: 'sos', plus: 0, price: 100, blues: STR3 });
    sim.step();
    const listings = sim.market().listings;
    expect(listings.length).toBe(1);
    expect(bluesKey(listings[0].blues)).toBe('str:3'); // a listing mostra os azuis (o comprador vê o que compra)
    const left = bagStacks(sim);
    expect(left.length).toBe(1);
    expect(left[0].blues).toBeUndefined(); // escrowou a AZUL — sobrou o gêmeo sem-azul
  });
});

describe('Blues Fatia 2 — STALL (guarda de DUP: o gate fecha o vetor introduzido pelos azuis)', () => {
  it('um item azul NÃO é listável no stall (só a variante sem-azul); controle: sem-azul lista', () => {
    // transferItem contava um item azul por identidade parcial mas o removeFromBag por chave cheia não o
    // tiraria -> dup. O gate do openStall (bluesKey '') fecha o vetor na origem: azul-no-stall é fatia futura.
    const sim = new Sim(1);
    const p = player(sim);
    const inner = sim as unknown as Internal;
    p.bag[0] = { itemId: 'wolf_leather', rarity: 'sos', plus: 0, qty: 1, blues: [{ id: 'str', level: 2 }] } as ItemStack;
    inner.openStall(p, [{ itemId: 'wolf_leather', rarity: 'sos', plus: 0, price: 100 }]);
    expect(inner.stalls.get(p.id)).toBeUndefined(); // item azul não vira listing

    p.bag[1] = { itemId: 'wolf_leather', rarity: 'sos', plus: 0, qty: 1 } as ItemStack; // gêmeo sem-azul
    inner.openStall(p, [{ itemId: 'wolf_leather', rarity: 'sos', plus: 0, price: 100 }]);
    expect(inner.stalls.get(p.id)?.length).toBe(1); // o sem-azul É listável (controle positivo)
  });
});

describe('Blues Fatia 2 — PARIDADE ONLINE (o server threada os azuis)', () => {
  const chestEq = (w: ServerWorld, a: number) =>
    w.selfState(a).inventory.equipment.find((e) => e.slot === 'chest')!;

  it('o snapshot preserva os azuis da bolsa (o server não os perde no self state)', () => {
    const w = new ServerWorld(7);
    const a = w.addPlayer('A');
    w.restorePlayer(a, { bag: [{ itemId: 'wolf_leather', rarity: 'sos', plus: 0, qty: 1, blues: STR3 }], equipment: {} });
    const stack = w.selfState(a).inventory.stacks.find((s) => s.itemId === 'wolf_leather')!;
    expect(bluesKey(stack.blues)).toBe('str:3'); // o azul chegou ao snapshot pessoal
  });

  it('o server FORWARDA os azuis no comando equip (equipar online mantém a identidade)', () => {
    const w = new ServerWorld(7);
    const a = w.addPlayer('A');
    w.restorePlayer(a, { bag: [{ itemId: 'wolf_leather', rarity: 'sos', plus: 0, qty: 1, blues: STR3 }], equipment: {} });
    w.command(a, { t: 'equip', itemId: 'wolf_leather', rarity: 'sos', plus: 0, blues: STR3 });
    w.step();
    const eqv = chestEq(w, a);
    expect(eqv.itemId).toBe('wolf_leather');
    expect(bluesKey(eqv.blues)).toBe('str:3'); // o server NÃO descartou os azuis na whitelist
  });

  it('o server SANEIA os azuis na wire: um blues corrompido no comando não corrompe (equipa o sem-azul)', () => {
    const w = new ServerWorld(7);
    const a = w.addPlayer('A');
    w.restorePlayer(a, { bag: [{ itemId: 'wolf_leather', rarity: 'normal', plus: 0, qty: 1 }], equipment: {} }); // item SEM azul
    // blues de lixo (id fora do catálogo) -> sanitizeBlues -> undefined -> referencia a variante sem-azul.
    w.command(a, { t: 'equip', itemId: 'wolf_leather', rarity: 'normal', plus: 0, blues: [{ id: 'FAKE', level: 2 }] as unknown as BlueLine[] });
    w.step();
    const eqv = chestEq(w, a);
    expect(eqv.itemId).toBe('wolf_leather'); // equipou o sem-azul (garbage saneado, sem corromper)
    expect(eqv.blues).toBeUndefined();
  });
});
