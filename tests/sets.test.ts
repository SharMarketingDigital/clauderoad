// Sistema 4 (Set items) — Fatia 1: a fundação (modelo + fold por contagem de peças). O risco crítico é o
// FOLD: contar as peças equipadas de cada conjunto e aplicar o MAIOR limiar (2/3/4) — sem duplicar degraus,
// sem dar bônus a set incompleto/misturado, e byte-idêntico p/ quem não usa set. MVP: só HP/def FLAT.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { setBonusFor, SETS } from '../src/sim/content/sets';
import { ITEMS } from '../src/sim/content/items';
import type { Entity, EquippedItem } from '../src/sim/types';
import type { Rarity } from '../src/world_api';
import { MAX_DURABILITY } from '../src/sim/content/durability';

type Internal = { ents: Map<number, Entity>; recomputeStats: (e: Entity) => void };
const inner = (sim: Sim) => sim as unknown as Internal;
const player = (sim: Sim): Entity => [...inner(sim).ents.values()].find((e) => e.kind === 'player')!;
// Equipa uma lista de itens (por slot) direto + recomputa; devolve o DELTA efetivo sobre o baseline desarmado.
const gearDelta = (ids: string[], rarity: Rarity = 'normal', plus = 0) => {
  const sim = new Sim(1);
  const b = { maxHp: player(sim).maxHp, phyDef: player(sim).phyDef, magDef: player(sim).magDef };
  const p = player(sim);
  for (const id of ids) {
    p.equipment[ITEMS[id].slot!] = { itemId: id, rarity, plus, durability: MAX_DURABILITY } as EquippedItem;
  }
  inner(sim).recomputeStats(p);
  return { maxHp: p.maxHp - b.maxHp, phyDef: p.phyDef - b.phyDef, magDef: p.magDef - b.magDef };
};

describe('Sets — setBonusFor (helper puro: maior limiar, sem duplicar, incompleto = null)', () => {
  it('conta o MAIOR limiar atingido (2/3/4); <2 e >4 tratados corretamente', () => {
    expect(setBonusFor('leather', 1)).toBeNull(); // incompleto
    expect(setBonusFor('leather', 2)).toEqual({ maxHp: 20 });
    expect(setBonusFor('leather', 3)).toEqual({ maxHp: 20, phyDef: 3 });
    expect(setBonusFor('leather', 4)).toEqual({ maxHp: 20, phyDef: 3, magDef: 3 });
    expect(setBonusFor('leather', 5)).toEqual({ maxHp: 20, phyDef: 3, magDef: 3 }); // capa no 4 (não há 5º degrau)
  });
  it('set desconhecido => null (nunca lança)', () => {
    expect(setBonusFor('naoexiste', 4)).toBeNull();
  });
  it('os degraus são CUMULATIVOS na def (o 4pc já traz o total — o fold aplica UM degrau, não a soma)', () => {
    const b4 = SETS.leather.bonuses[2].stats; // pieces:4
    expect(b4).toEqual({ maxHp: 20, phyDef: 3, magDef: 3 }); // não 60hp (2+3+4 somados)
  });
});

describe('Sets — fold no recomputeStats (degraus 2/3/4 no stat efetivo)', () => {
  it('2 peças de couro: +20 maxHp (set 2pc), sem phyDef/magDef de set ainda', () => {
    // per-peça cap+chest = maxHp 32, phyDef 3, magDef 2; set 2pc soma só +20 maxHp
    expect(gearDelta(['leather_cap', 'wolf_leather'])).toEqual({ maxHp: 52, phyDef: 3, magDef: 2 });
  });
  it('3 peças: o set adiciona phyDef (+3) além do maxHp', () => {
    // +gloves: per-peça maxHp 40, phyDef 4, magDef 3; set 3pc: +20 maxHp, +3 phyDef
    expect(gearDelta(['leather_cap', 'wolf_leather', 'leather_gloves'])).toEqual({ maxHp: 60, phyDef: 7, magDef: 3 });
  });
  it('4 peças: o set adiciona magDef (+3); maxHp do set continua +20 (UM degrau, não somado)', () => {
    // +pants: per-peça maxHp 54, phyDef 6, magDef 4; set 4pc: +20 maxHp, +3 phyDef, +3 magDef
    expect(gearDelta(['leather_cap', 'wolf_leather', 'leather_gloves', 'leather_pants'])).toEqual({ maxHp: 74, phyDef: 9, magDef: 7 });
  });
  it('o set de PLACAS (g3) escala maior: 4pc = +45 maxHp, +6 phyDef, +6 magDef sobre as peças', () => {
    const d = gearDelta(['plate_helm', 'plate_armor', 'plate_gauntlets', 'plate_legs']);
    // per-peça g3 (4): maxHp 22+36+14+25=97, phyDef 2+4+2+4=12, magDef 2+2+2+2=8; + set 4pc 45/6/6
    expect(d).toEqual({ maxHp: 97 + 45, phyDef: 12 + 6, magDef: 8 + 6 });
  });
});

describe('Sets — incompleto / misturado NÃO dá bônus (byte-idêntico ao mundo pré-set)', () => {
  it('1 peça só: nenhum bônus de set (só o stat da peça)', () => {
    expect(gearDelta(['leather_cap'])).toEqual({ maxHp: 12, phyDef: 1, magDef: 1 });
  });
  it('peças de conjuntos DIFERENTES (couro + malha): nenhum set atinge 2 -> zero bônus de set', () => {
    // cap(couro) {12,1,1} + chain_vest(malha) {28,3,1} = {40,4,2}; nenhum setId chega a 2 peças
    expect(gearDelta(['leather_cap', 'chain_vest'])).toEqual({ maxHp: 40, phyDef: 4, magDef: 2 });
  });
  it('o ESCUDO não é peça de set: 5 armaduras de couro + escudo ainda é set couro 4/4 (escudo não conta)', () => {
    const semEscudo = gearDelta(['leather_cap', 'wolf_leather', 'leather_gloves', 'leather_pants', 'leather_boots']);
    const comEscudo = gearDelta(['leather_cap', 'wolf_leather', 'leather_gloves', 'leather_pants', 'leather_boots', 'wooden_shield']);
    // a diferença é SÓ o stat do escudo (18/2/2), não um degrau de set a mais
    expect(comEscudo.maxHp - semEscudo.maxHp).toBe(18);
    expect(comEscudo.phyDef - semEscudo.phyDef).toBe(2);
  });
});

describe('Sets — FLAT (o bônus de set não escala por raridade/+N) + determinismo', () => {
  it('o bônus de set é o MESMO em normal+0 e SUN+5 (só o branco per-peça escala)', () => {
    // setBonusFor não tem parâmetro de raridade -> o bônus é constante. Prova via fold: a porção de set (o
    // salto de phyDef que o 3pc introduz vs o 2pc) é +3 nas duas raridades, mesmo com o branco escalado.
    const jump = (rarity: Rarity, plus: number): number => {
      const two = gearDelta(['leather_cap', 'wolf_leather'], rarity, plus).phyDef; // set 2pc: sem phyDef de set
      const three = gearDelta(['leather_cap', 'wolf_leather', 'leather_gloves'], rarity, plus).phyDef; // set 3pc: +3 de set
      // three - two = phyDef da 3ª peça (gloves, escalado) + 3 (set FLAT). Isolando o set: subtrai a peça.
      return three - two;
    };
    // a peça gloves phyDef 1 escala com a raridade; o +3 do set é FLAT. Comparo o salto menos a peça escalada.
    const glovesPhyDef = (rarity: Rarity, plus: number): number =>
      gearDelta(['leather_gloves'], rarity, plus).phyDef; // 1 peça: sem set -> só o branco escalado da luva
    expect(jump('normal', 0) - glovesPhyDef('normal', 0)).toBe(3); // set FLAT +3
    expect(jump('sun', 5) - glovesPhyDef('sun', 5)).toBe(3); // MESMO +3, mesmo com a luva escalada por SUN/+5
  });

  it('determinístico: equipar o set é reproduzível (mesma seed => hash idêntico)', () => {
    const run = (): string => {
      const sim = new Sim(3);
      const p = player(sim);
      for (const id of ['plate_helm', 'plate_armor', 'plate_gauntlets', 'plate_legs', 'plate_boots']) {
        p.equipment[ITEMS[id].slot!] = { itemId: id, rarity: 'som', plus: 2, durability: MAX_DURABILITY } as EquippedItem;
      }
      inner(sim).recomputeStats(p);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
