// Sistema 2 — respec (reset de skill). Fiel ao item de reset do Silkroad (escopo 1828): um pergaminho
// consumível vendido pelo alquimista devolve TODO o SP gasto acima do rank 1 e zera os ranks. Maestria =
// arma equipada, então NÃO há reset de maestria (corte consciente). Puro/determinístico; save inalterado
// (sp/skillRanks já persistidos). Testado headless no sim.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TOWN_SHOPS } from '../src/sim/content/vendor';

const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
const abilityRank = (sim: Sim, slot: number) => sim.abilities().find((a) => a.slot === slot)!.rank;

// Sobe o personagem ao nv7 (tudo destravado) com SP de sobra e o pergaminho na bolsa.
function prep(sim: Sim, sp = 500): void {
  const pid = sim.localPlayerId()!;
  const save = sim.serializePlayer(pid)!;
  save.level = 7;
  save.sp = sp;
  save.bag = [{ itemId: 'skill_reset', rarity: 'normal', plus: 0, qty: 1 }];
  sim.restorePlayer(pid, save);
}

const useReset = (sim: Sim) => {
  sim.sendCommand({ t: 'use-item', itemId: 'skill_reset', rarity: 'normal', plus: 0 });
  sim.step();
};

describe('Sistema 2: respec (reset de skill)', () => {
  it('o Pergaminho de Reinício devolve EXATAMENTE o SP gasto e zera os ranks, consumindo o item', () => {
    const sim = new Sim(7); // Espada
    prep(sim);
    const sp0 = player(sim).sp;
    // investe: slot 1 -> rank 3, slot 2 -> rank 2
    sim.sendCommand({ t: 'rank-up', slot: 1 }); sim.step(); // rank 1 -> 2
    sim.sendCommand({ t: 'rank-up', slot: 1 }); sim.step(); // -> 3
    sim.sendCommand({ t: 'rank-up', slot: 2 }); sim.step(); // -> 2
    const spent = sp0 - player(sim).sp;
    expect(spent).toBeGreaterThan(0);
    expect(abilityRank(sim, 1)).toBe(3);
    expect(abilityRank(sim, 2)).toBe(2);

    useReset(sim);
    expect(player(sim).sp).toBe(sp0); // devolveu exatamente o gasto (reversível 100%)
    expect(abilityRank(sim, 1)).toBe(1); // ranks zerados
    expect(abilityRank(sim, 2)).toBe(1);
    expect(sim.inventory().stacks.some((s) => s.itemId === 'skill_reset')).toBe(false); // consumido
  });

  it('usar o pergaminho sem NADA investido é no-op — não consome o item nem mexe no SP', () => {
    const sim = new Sim(7);
    prep(sim, 100);
    const sp0 = player(sim).sp;
    useReset(sim);
    expect(player(sim).sp).toBe(sp0); // nada mudou
    expect(sim.inventory().stacks.some((s) => s.itemId === 'skill_reset')).toBe(true); // não desperdiçado
  });

  it('o respec devolve o SP da PASSIVA e volta o bônus dela ao baseline (Espada Corpo de Ferro)', () => {
    const sim = new Sim(7);
    prep(sim);
    const hp1 = player(sim).maxHp; // passiva no rank 1 (grátis ao destravar)
    sim.sendCommand({ t: 'rank-up', slot: 5 }); sim.step(); // passiva -> rank 2 (+HP)
    expect(player(sim).maxHp).toBeGreaterThan(hp1);
    useReset(sim);
    expect(player(sim).maxHp).toBe(hp1); // o bônus da passiva volta ao rank-1 baseline (recompute)
  });

  it('o alquimista vende o Pergaminho de Reinício (acesso fiel: item de reset num NPC)', () => {
    const alchemist = TOWN_SHOPS.find((s) => s.species === 'alchemist')!;
    expect(alchemist.stock.some((e) => e.itemId === 'skill_reset')).toBe(true);
  });

  it('o respec é determinístico (mesmo seed + comandos => hash idêntico)', () => {
    const run = (): string => {
      const sim = new Sim(7);
      prep(sim, 300);
      sim.sendCommand({ t: 'rank-up', slot: 1 }); sim.step();
      sim.sendCommand({ t: 'rank-up', slot: 3 }); sim.step();
      useReset(sim);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
