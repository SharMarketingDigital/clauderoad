// Sistema 3 (Magic Options / "azuis") — Fatia 1: a FUNDAÇÃO, com o STACKING-IDENTITY como o ponto crítico.
// Azuis fazem parte da IDENTIDADE do item: se a chave de stack não os incluir, dois itens distintos fundem e
// corrompem bolsa/save. Estes testes provam, ISOLADO, que o stacking aguenta os azuis sem corromper nada:
// dois itens com azuis diferentes NÃO empilham; itens iguais empilham; save preserva; saves antigos ok;
// determinismo intacto (byte-idêntico sem azul). O fold e o roll no drop também são cobertos.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { addToBag, removeFromBag, BAG_SLOTS } from '../src/sim/inventory';
import { bluesKey, rollBlues, sanitizeBlues, blueAmount, BLUES } from '../src/sim/content/magic_options';
import type { BlueLine } from '../src/sim/content/magic_options';
import type { Entity, ItemStack } from '../src/sim/types';
import { MAX_DURABILITY } from '../src/sim/content/durability';
import { Rng } from '../src/sim/rng';

type Internal = { ents: Map<number, Entity> };
const player = (sim: Sim): Entity => [...(sim as unknown as Internal).ents.values()].find((e) => e.kind === 'player')!;
const stacks = (bag: (ItemStack | null)[]): ItemStack[] => bag.filter((s): s is ItemStack => s != null);

describe('Blues — bluesKey (chave de stack canônica, pura)', () => {
  it('vazio/undefined => "" (itens sem azul empilham como sempre)', () => {
    expect(bluesKey(undefined)).toBe('');
    expect(bluesKey([])).toBe('');
  });
  it('ordem-independente: mesma chave pra mesmas linhas em ordem trocada', () => {
    const a = bluesKey([{ id: 'str', level: 2 }, { id: 'hp', level: 1 }]);
    const b = bluesKey([{ id: 'hp', level: 1 }, { id: 'str', level: 2 }]);
    expect(a).toBe(b);
  });
  it('azuis diferentes (id ou level) => chaves diferentes', () => {
    expect(bluesKey([{ id: 'str', level: 2 }])).not.toBe(bluesKey([{ id: 'hp', level: 2 }])); // id
    expect(bluesKey([{ id: 'str', level: 2 }])).not.toBe(bluesKey([{ id: 'str', level: 3 }])); // level
  });
});

describe('Blues — STACKING (o ponto crítico: identidade não corrompe a bolsa)', () => {
  it('CRÍTICO: dois itens com azuis DIFERENTES NÃO empilham (ficam separados)', () => {
    const bag: (ItemStack | null)[] = [];
    addToBag(bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, [{ id: 'str', level: 2 }]);
    addToBag(bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, [{ id: 'hp', level: 1 }]);
    const s = stacks(bag);
    expect(s.length).toBe(2); // NÃO fundiram
    expect(s.every((x) => x.qty === 1)).toBe(true);
    expect(new Set(s.map((x) => bluesKey(x.blues)))).toEqual(new Set(['str:2', 'hp:1']));
  });

  it('CRÍTICO: dois itens com os MESMOS azuis empilham (qty soma)', () => {
    const bag: (ItemStack | null)[] = [];
    addToBag(bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, [{ id: 'str', level: 2 }]);
    addToBag(bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, [{ id: 'str', level: 2 }]);
    expect(stacks(bag).length).toBe(1);
    expect(stacks(bag)[0].qty).toBe(2);
  });

  it('CRÍTICO: azuis em ordem trocada = MESMO item (empilham, chave canônica)', () => {
    const bag: (ItemStack | null)[] = [];
    addToBag(bag, 'wolf_leather', 'som', 0, 1, BAG_SLOTS, [{ id: 'str', level: 2 }, { id: 'hp', level: 1 }]);
    addToBag(bag, 'wolf_leather', 'som', 0, 1, BAG_SLOTS, [{ id: 'hp', level: 1 }, { id: 'str', level: 2 }]);
    expect(stacks(bag).length).toBe(1);
    expect(stacks(bag)[0].qty).toBe(2);
  });

  it('CRÍTICO: um item COM azul não empilha com o mesmo item SEM azul', () => {
    const bag: (ItemStack | null)[] = [];
    addToBag(bag, 'wolf_leather', 'sos', 0, 1); // sem azul
    addToBag(bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, [{ id: 'str', level: 1 }]); // com azul
    expect(stacks(bag).length).toBe(2);
  });

  it('item SEM azul empilha como sempre — e o stack fica sem o campo blues (shape byte-idêntico)', () => {
    const bag: (ItemStack | null)[] = [];
    addToBag(bag, 'health_potion', 'normal', 0, 3);
    addToBag(bag, 'health_potion', 'normal', 0, 2);
    expect(stacks(bag).length).toBe(1);
    expect(stacks(bag)[0].qty).toBe(5);
    expect(stacks(bag)[0].blues).toBeUndefined();
  });

  it('removeFromBag remove a stack CERTA pelos azuis (não a errada)', () => {
    const bag: (ItemStack | null)[] = [];
    addToBag(bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, [{ id: 'str', level: 2 }]);
    addToBag(bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, [{ id: 'hp', level: 1 }]);
    expect(removeFromBag(bag, 'wolf_leather', 'sos', 0, 1, [{ id: 'str', level: 2 }])).toBe(true);
    expect(stacks(bag).length).toBe(1);
    expect(bluesKey(stacks(bag)[0].blues)).toBe('hp:1'); // sobrou o de hp
  });

  it('o stack é DONO das próprias linhas (deep-copy — não aliasa a fonte)', () => {
    const src: BlueLine[] = [{ id: 'str', level: 2 }];
    const bag: (ItemStack | null)[] = [];
    addToBag(bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, src);
    src[0].level = 99; // muta a fonte
    expect(stacks(bag)[0].blues![0].level).toBe(2); // o stack não mudou
  });
});

describe('Blues — fold FLAT no recomputeStats (via restore, que recomputa)', () => {
  // Equipar item azul por COMANDO é Fatia 2; aqui seto o equipamento e uso o roundtrip de save (que
  // recomputa no restore) pra folder. Compara peito COM azul vs SEM azul: a diferença = só os azuis.
  const equipChest = (blues?: BlueLine[], rarity: 'normal' | 'sun' = 'normal', plus = 0): Entity => {
    const a = new Sim(1);
    const pa = player(a);
    pa.equipment.chest = { itemId: 'wolf_leather', rarity, plus, durability: MAX_DURABILITY, ...(blues ? { blues } : {}) };
    const save = a.serializePlayer(pa.id)!;
    const b = new Sim(1);
    b.restorePlayer(player(b).id, JSON.parse(JSON.stringify(save)));
    return player(b);
  };

  it('azuis somam FLAT (str +3, phyDef +2) e sobrevivem ao restore', () => {
    const plain = equipChest();
    const blue = equipChest([{ id: 'str', level: 3 }, { id: 'phyDef', level: 2 }]);
    expect(blue.str).toBe(plain.str + 3); // str perLevel 1 × level 3
    expect(blue.phyDef).toBe(plain.phyDef + 2); // phyDef perLevel 1 × level 2
    expect(bluesKey(blue.equipment.chest?.blues)).toBe('phyDef:2,str:3'); // preservado no equipamento
  });

  it('azul NÃO escala por raridade/+N (ao contrário do branco): mesmo +str num peito normal vs SUN +5', () => {
    const normalDelta = equipChest([{ id: 'str', level: 3 }]).str - equipChest().str;
    const sunDelta = equipChest([{ id: 'str', level: 3 }], 'sun', 5).str - equipChest(undefined, 'sun', 5).str;
    expect(normalDelta).toBe(3);
    expect(sunDelta).toBe(3); // o azul é o mesmo +3 (o opt-level já É a magnitude); só o phyDef BRANCO escalou
  });

  it('blueAmount = perLevel × level', () => {
    expect(blueAmount({ id: 'hp', level: 4 })).toBe(BLUES.hp.perLevel * 4); // 8 × 4 = 32
    expect(blueAmount({ id: 'str', level: 6 })).toBe(6);
  });
});

describe('Blues — roll no drop (rollBlues, determinístico e gated)', () => {
  it('NORMAL não rola nem SACA RNG (drop comum byte-idêntico ao pré-azuis)', () => {
    expect(rollBlues(new Rng(1), 'chest', 'normal', 3)).toEqual([]);
    // prova de que não sacou: o rng após um rollBlues(normal) está no mesmo ponto de um Rng fresco.
    const r = new Rng(42); rollBlues(r, 'chest', 'normal', 3);
    expect(r.next()).toBe(new Rng(42).next());
  });
  it('SoS+ rola azuis; DETERMINÍSTICO (mesma seed → mesmas linhas)', () => {
    const a = rollBlues(new Rng(7), 'chest', 'som', 3);
    expect(a.length).toBe(2); // som => 2
    expect(rollBlues(new Rng(7), 'chest', 'som', 3)).toEqual(a); // reproduzível
    expect(rollBlues(new Rng(9), 'chest', 'sun', 3).length).toBeGreaterThanOrEqual(2); // sun => 2-3
  });
  it('linhas DISTINTAS (sem id repetido) e opt-level gated pelo grau', () => {
    const s = rollBlues(new Rng(3), 'chest', 'sun', 1); // grau 1 => level máx min(6, 2) = 2
    expect(new Set(s.map((b) => b.id)).size).toBe(s.length); // sem duplicata de id
    for (const b of s) { expect(b.level).toBeGreaterThanOrEqual(1); expect(b.level).toBeLessThanOrEqual(2); }
  });
  it('slot sem azul elegível (arma hoje) => [] (o azul de arma é crit, fatia futura)', () => {
    expect(rollBlues(new Rng(1), 'weapon', 'sun', 3)).toEqual([]);
  });
});

describe('Blues — save/hash (persistência + determinismo)', () => {
  it('save roundtrip preserva os azuis de CADA item da bolsa (distintos não fundem)', () => {
    const a = new Sim(1);
    addToBag(player(a).bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, [{ id: 'str', level: 2 }]);
    addToBag(player(a).bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, [{ id: 'hp', level: 3 }]);
    const save = a.serializePlayer(player(a).id)!;
    const b = new Sim(2);
    b.restorePlayer(player(b).id, JSON.parse(JSON.stringify(save)));
    const s = stacks(player(b).bag);
    expect(s.length).toBe(2); // continuam separados após o roundtrip
    expect(new Set(s.map((x) => bluesKey(x.blues)))).toEqual(new Set(['str:2', 'hp:3']));
  });

  it('saves ANTIGOS (sem campo blues) restauram sem quebrar', () => {
    const b = new Sim(2);
    const oldSave = { level: 3, bag: [{ itemId: 'old_sword', rarity: 'normal', plus: 0, qty: 1 }] };
    expect(() => b.restorePlayer(player(b).id, oldSave)).not.toThrow();
    const s = stacks(player(b).bag);
    expect(s.length).toBe(1);
    expect(s[0].blues).toBeUndefined();
  });

  it('save com blues CORROMPIDO é saneado (linhas inválidas caem, nunca lança)', () => {
    const b = new Sim(2);
    const raw = {
      bag: [{ itemId: 'wolf_leather', rarity: 'sos', plus: 0, qty: 1,
        blues: [{ id: 'str', level: 3 }, { id: 'FAKE', level: 2 }, { id: 'hp', level: 0 }, { id: 'str', level: 5 }, 'lixo'] }],
    };
    expect(() => b.restorePlayer(player(b).id, raw)).not.toThrow();
    const item = stacks(player(b).bag)[0];
    expect(bluesKey(item.blues)).toBe('str:3'); // FAKE(id), hp(level<1), str duplicado e 'lixo' caem
  });

  it('os azuis entram no HASH: mundos com azuis diferentes hasheiam diferente; sem azul é reproduzível', () => {
    const withBlue = (blues?: BlueLine[]): string => {
      const sim = new Sim(5);
      addToBag(player(sim).bag, 'wolf_leather', 'sos', 0, 1, BAG_SLOTS, blues);
      return sim.hash();
    };
    const strBlue = withBlue([{ id: 'str', level: 2 }]);
    expect(strBlue).toBe(withBlue([{ id: 'str', level: 2 }])); // reproduzível
    expect(strBlue).not.toBe(withBlue([{ id: 'hp', level: 1 }])); // azuis diferentes → hash diferente
    expect(strBlue).not.toBe(withBlue(undefined)); // com azul ≠ sem azul
  });

  it('sanitizeBlues: entrada boa mantida, ruim vira undefined', () => {
    expect(sanitizeBlues([{ id: 'str', level: 2 }])).toEqual([{ id: 'str', level: 2 }]);
    expect(sanitizeBlues('lixo')).toBeUndefined();
    expect(sanitizeBlues([])).toBeUndefined();
    expect(sanitizeBlues([{ id: 'str', level: 999 }])![0].level).toBe(BLUES.str.maxLevel); // clampado ao teto
  });
});

// Buracos de CORRUPÇÃO que a revisão focada no stacking pegou (fix-forward).
describe('Blues — corrupção pega pela revisão focada (fix-forward)', () => {
  it('CRÍTICO: death-drop preserva a IDENTIDADE — não duplica o azul nem destrói o gêmeo sem-azul', () => {
    // dropPhysicalLoot iterava snapshots com azuis mas removia por (itemId,rarity,plus) SEM os azuis → removia
    // o gêmeo sem-azul e spawnava o snapshot azul: item azul DUPLICADO (bolsa+chão) + sem-azul DESTRUÍDO.
    const sim = new Sim(1);
    const p = player(sim);
    p.bag = new Array(BAG_SLOTS).fill(null);
    p.bag[0] = { itemId: 'wolf_leather', rarity: 'sos', plus: 0, qty: 1, blues: [{ id: 'str', level: 2 }] }; // AZUL primeiro
    p.bag[1] = { itemId: 'wolf_leather', rarity: 'sos', plus: 0, qty: 1 }; // gêmeo SEM-AZUL, mesmo id/rarity/plus
    // Força TODO item a dropar (dropRng sempre 0 < DEATH_DROP_CHANCE), e chama o mover direto.
    (sim as unknown as { dropRng: { next: () => number } }).dropRng = { next: () => 0 };
    (sim as unknown as { dropPhysicalLoot: (e: Entity) => void }).dropPhysicalLoot(p);
    // Conservação por IDENTIDADE (chave de azul) somando bolsa + chão.
    const countByKey = (key: string): number => {
      let n = 0;
      for (const s of p.bag) if (s && bluesKey(s.blues) === key) n += s.qty;
      for (const e of [...(sim as unknown as Internal).ents.values()]) {
        if (e.loot && bluesKey(e.loot.stack.blues) === key) n += e.loot.stack.qty;
      }
      return n;
    };
    expect(countByKey('str:2')).toBe(1); // o azul NÃO foi duplicado
    expect(countByKey('')).toBe(1); // o sem-azul NÃO foi destruído
  });

  it('CRÍTICO: sanitizeBlues REJEITA ids de Object.prototype (constructor/toString/__proto__/hasOwnProperty)', () => {
    // `id in BLUES` andava pela cadeia de protótipo → esses ids passavam (→ level NaN → corrompe stacking/hash).
    for (const id of ['constructor', 'toString', '__proto__', 'hasOwnProperty', 'valueOf', 'isPrototypeOf']) {
      expect(sanitizeBlues([{ id, level: 2 }])).toBeUndefined();
    }
    // um id de protótipo junto de um válido: só o válido sobra (identidade limpa)
    expect(sanitizeBlues([{ id: 'str', level: 2 }, { id: 'constructor', level: 1 }])).toEqual([{ id: 'str', level: 2 }]);
  });

  it('os azuis entram no HASH também em STORAGE e PETBAG (não só na bolsa)', () => {
    const hashWith = (where: 'storage' | 'petBag', blues?: BlueLine[]): string => {
      const sim = new Sim(5);
      const p = player(sim);
      if (where === 'petBag') p.petBag = new Array(12).fill(null);
      const arr = where === 'storage' ? p.storage : p.petBag!;
      arr[0] = { itemId: 'wolf_leather', rarity: 'sos', plus: 0, qty: 1, ...(blues ? { blues } : {}) };
      return sim.hash();
    };
    // um item azul no armazém/pet-bag hasheia DIFERENTE da contraparte sem-azul (senão dois hosts desyncam).
    expect(hashWith('storage', [{ id: 'str', level: 2 }])).not.toBe(hashWith('storage', undefined));
    expect(hashWith('petBag', [{ id: 'str', level: 2 }])).not.toBe(hashWith('petBag', undefined));
  });
});
