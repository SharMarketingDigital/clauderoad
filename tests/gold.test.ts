// Gold por nível — a régua ancorada ao nível, fiel à levelgold.txt do Silkroad (faixa [piso,teto] por
// nível, quase-linear e devagar de propósito: o ouro fica atrás da curva de poder). Funções puras.
import { describe, it, expect } from 'vitest';
import { goldFloor, goldCeil, levelUpGold } from '../src/sim/content/gold';
import { LEVEL_CAP } from '../src/sim/sim';

describe('Gold por nível (régua)', () => {
  it('bate os marcos baixos do SRO no nível 1 (piso 28, teto 59)', () => {
    expect(goldFloor(1)).toBe(28);
    expect(goldCeil(1)).toBe(59);
  });

  it('é linear e monotônica até o cap; o teto é sempre > o piso (~2.1×)', () => {
    for (let L = 1; L < LEVEL_CAP; L++) {
      expect(goldFloor(L + 1)).toBeGreaterThan(goldFloor(L)); // piso sobe
      expect(goldCeil(L + 1)).toBeGreaterThan(goldCeil(L)); // teto sobe
      expect(goldCeil(L)).toBeGreaterThan(goldFloor(L)); // teto > piso
    }
    // a forma copiada do dado: piso ~+3.6/nível, teto ~+7.4/nível
    expect(goldFloor(10)).toBe(28 + Math.round(3.6 * 9));
    expect(goldCeil(10)).toBe(59 + Math.round(7.4 * 9));
    expect(goldCeil(10) / goldFloor(10)).toBeGreaterThan(2); // teto ~2.1× o piso
  });

  it('o bônus ao dingar é o PISO da faixa (conservador, atrás da curva de poder)', () => {
    for (let L = 1; L <= LEVEL_CAP; L++) expect(levelUpGold(L)).toBe(goldFloor(L));
  });

  it('níveis < 1 são clampados a 1 (defesa)', () => {
    expect(goldFloor(0)).toBe(goldFloor(1));
    expect(goldCeil(-5)).toBe(goldCeil(1));
  });
});
