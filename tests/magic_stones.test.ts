// Sistema 3 (magic stones / alquimia de atributo) — enhanceBlue. Uma Pedra Astral soca/sobe UMA linha azul
// num item EQUIPADO (referência por slot — sem a ambiguidade de stacking da bolsa). Rng-gated (1 draw, só
// depois de passar todos os gates E consumir a pedra), falha GENTIL (a pedra é o custo; o item nunca quebra).
// Estes testes fixam: sucesso adiciona/sobe a linha + folda o stat; falha só gasta a pedra; os gates (slot,
// teto grau×2, espaço, posse da pedra) recusam corretamente; determinismo + byte-identidade (quem não soca
// não saca Rng); e o readout `socketable` da view (que a UI consome).
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { addToBag } from '../src/sim/inventory';
import { bluesKey, blueEnhanceChance, blueLevelCap, BLUES } from '../src/sim/content/magic_options';
import type { Entity, EquippedItem } from '../src/sim/types';
import type { EquipSlot } from '../src/world_api';
import { MAX_DURABILITY } from '../src/sim/content/durability';

type Internal = { ents: Map<number, Entity>; rng: { next: () => number }; recomputeStats: (e: Entity) => void; enhanceBlue: (p: Entity, slot: EquipSlot, blueId: string) => void };
const inner = (sim: Sim) => sim as unknown as Internal;
const player = (sim: Sim): Entity => [...inner(sim).ents.values()].find((e) => e.kind === 'player')!;
const stones = (sim: Sim): number => player(sim).bag.reduce((n, s) => n + (s?.itemId === 'magic_stone' ? s.qty : 0), 0);
// Fixa o Rng do sim num valor constante: 0 => sucesso garantido (0 < qualquer chance); 0.999 => falha (>0.90).
const forceRng = (sim: Sim, v: number): void => { inner(sim).rng = { next: () => v }; };
// Equipa uma peça direto (escape hatch) e recomputa — o baseline dos stats já reflete os brancos da peça.
const equipDirect = (sim: Sim, slot: EquipSlot, itemId: string, blues?: { id: string; level: number }[]): Entity => {
  const p = player(sim);
  p.equipment[slot] = { itemId, rarity: 'sos', plus: 0, durability: MAX_DURABILITY, ...(blues ? { blues } : {}) } as EquippedItem;
  inner(sim).recomputeStats(p);
  return p;
};
const chestBlues = (p: Entity) => p.equipment.chest?.blues;

describe('Magic stones — enhanceBlue: sucesso (adiciona / sobe a linha + folda o stat)', () => {
  it('adiciona uma linha NOVA no sucesso: str:1, consome a pedra, o str sobe +1', () => {
    const sim = new Sim(1);
    const p = equipDirect(sim, 'chest', 'plate_armor'); // grau 3 -> cap str = min(6,6)=6
    addToBag(p.bag, 'magic_stone', 'normal', 0, 1);
    const str0 = p.str;
    forceRng(sim, 0); // sucesso garantido
    inner(sim).enhanceBlue(p, 'chest', 'str');
    expect(bluesKey(chestBlues(p))).toBe('str:1'); // linha nova
    expect(stones(sim)).toBe(0); // pedra consumida
    expect(player(sim).str).toBe(str0 + 1); // azul folda FLAT no derived
  });

  it('SOBE uma linha existente no sucesso: str:2 -> str:3', () => {
    const sim = new Sim(1);
    const p = equipDirect(sim, 'chest', 'plate_armor', [{ id: 'str', level: 2 }]);
    addToBag(p.bag, 'magic_stone', 'normal', 0, 1);
    const str0 = p.str;
    forceRng(sim, 0);
    inner(sim).enhanceBlue(p, 'chest', 'str');
    expect(bluesKey(chestBlues(p))).toBe('str:3');
    expect(player(sim).str).toBe(str0 + 1); // subiu 1 opt-level -> +1 str (perLevel 1)
  });
});

describe('Magic stones — falha GENTIL (a pedra é o custo; o item fica intacto)', () => {
  it('falha: consome a pedra, NÃO muda os azuis, nunca quebra o item', () => {
    const sim = new Sim(1);
    const p = equipDirect(sim, 'chest', 'plate_armor', [{ id: 'str', level: 2 }]);
    addToBag(p.bag, 'magic_stone', 'normal', 0, 1);
    forceRng(sim, 0.999); // falha garantida (> 0.90)
    inner(sim).enhanceBlue(p, 'chest', 'str');
    expect(bluesKey(chestBlues(p))).toBe('str:2'); // inalterado
    expect(stones(sim)).toBe(0); // pedra gasta (o custo)
    expect(p.equipment.chest).toBeTruthy(); // item intacto (sem quebra)
  });
});

describe('Magic stones — GATES (recusam antes de gastar a pedra / de sacar Rng)', () => {
  it('slot inválido: hp num ELMO (hp só em peito/calça) -> recusa, pedra intacta', () => {
    const sim = new Sim(1);
    const p = equipDirect(sim, 'helmet', 'leather_cap');
    addToBag(p.bag, 'magic_stone', 'normal', 0, 1);
    forceRng(sim, 0);
    inner(sim).enhanceBlue(p, 'helmet', 'hp'); // hp não é elegível ao elmo
    expect(p.equipment.helmet?.blues).toBeUndefined();
    expect(stones(sim)).toBe(1); // NÃO gastou a pedra
  });

  it('sem a pedra: no-op e NÃO saca Rng (byte-idêntico)', () => {
    const a = new Sim(5); const b = new Sim(5);
    equipDirect(a, 'chest', 'plate_armor'); // A tem a peça mas nenhuma pedra
    equipDirect(b, 'chest', 'plate_armor');
    inner(a).enhanceBlue(player(a), 'chest', 'str'); // gated no removeFromBag (sem pedra) -> sem draw
    // se A não sacou Rng, o próximo draw dos dois sims é idêntico (mesma seed, mesma posição de stream)
    expect(inner(a).rng.next()).toBe(inner(b).rng.next());
    expect(chestBlues(player(a))).toBeUndefined(); // nada mudou
  });

  it('no teto do item (grau×2): recusa e NÃO gasta a pedra', () => {
    const sim = new Sim(1);
    // wolf_leather (sem grau -> grau 1) -> cap str = min(6, 2) = 2. Já em str:2 = no teto.
    const p = equipDirect(sim, 'chest', 'wolf_leather', [{ id: 'str', level: 2 }]);
    expect(blueLevelCap(BLUES.str, 1)).toBe(2); // sanity do cap
    addToBag(p.bag, 'magic_stone', 'normal', 0, 1);
    forceRng(sim, 0);
    inner(sim).enhanceBlue(p, 'chest', 'str');
    expect(bluesKey(chestBlues(p))).toBe('str:2'); // não subiu além do teto
    expect(stones(sim)).toBe(1); // pedra intacta (não desperdiça no teto)
  });

  it('sem espaço (já com MAX_BLUES=3 linhas): uma linha NOVA é recusada, pedra intacta', () => {
    const sim = new Sim(1);
    const p = equipDirect(sim, 'chest', 'plate_armor', [{ id: 'str', level: 1 }, { id: 'hp', level: 1 }, { id: 'phyDef', level: 1 }]);
    addToBag(p.bag, 'magic_stone', 'normal', 0, 1);
    forceRng(sim, 0);
    inner(sim).enhanceBlue(p, 'chest', 'magDef'); // 4ª linha nova -> sem espaço
    expect(chestBlues(p)!.length).toBe(3); // continua 3
    expect(stones(sim)).toBe(1); // pedra intacta
  });
});

describe('Magic stones — determinismo + view', () => {
  it('mesma seed + mesma sequência de enhance-blue (via comando) => hash idêntico', () => {
    const run = (): string => {
      const sim = new Sim(9);
      const p = equipDirect(sim, 'chest', 'plate_armor');
      addToBag(p.bag, 'magic_stone', 'normal', 0, 5);
      for (let i = 0; i < 5; i++) { sim.sendCommand({ t: 'enhance-blue', slot: 'chest', blueId: 'str' }); sim.step(); }
      return sim.hash();
    };
    expect(run()).toBe(run()); // reproduzível (o Rng real decide sucesso/falha, mas igual nos dois)
  });

  it('a view expõe `socketable` com nível/cap/chance (o que a UI consome)', () => {
    const sim = new Sim(1);
    equipDirect(sim, 'chest', 'plate_armor', [{ id: 'str', level: 2 }]);
    const chest = sim.inventory().equipment.find((e) => e.slot === 'chest')!;
    const str = chest.socketable!.find((s) => s.id === 'str')!;
    expect(str.level).toBe(2);
    expect(str.cap).toBe(6); // grau 3 -> min(6,6)
    expect(str.chance).toBe(blueEnhanceChance(3)); // próxima tentativa = subir p/ o nível 3
    // uma linha ainda não socada aparece com nível 0 e a chance de adicionar (nível 1)
    const magDef = chest.socketable!.find((s) => s.id === 'magDef')!;
    expect(magDef.level).toBe(0);
    expect(magDef.chance).toBe(blueEnhanceChance(1));
  });
});
