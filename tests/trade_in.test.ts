// Sistema 20 — trade-in (reciclagem package->scrap). Fiel à ponte refscrapofpackageitem do Silkroad
// ("abrir a embalagem"): troca N do input por M do output (itens, não gold), no ALQUIMISTA. Reusa o caminho
// removeFromBag/addToBag de buy/sell. Puro/determinístico (só move itens, sem Rng). Testado headless no sim.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { RECIPES } from '../src/sim/content/vendor';

const ALCH_X = 16;
const ALCH_Z = 10; // o alquimista (TOWN_SHOPS)

const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
const count = (sim: Sim, id: string) => sim.inventory().stacks.find((s) => s.itemId === id)?.qty ?? 0;

function moveNear(sim: Sim, x: number, z: number): void {
  for (let i = 0; i < 600; i++) {
    const p = player(sim);
    if (Math.hypot(p.x - x, p.z - z) <= 3) return;
    sim.sendCommand({ t: 'move', dx: x - p.x, dz: z - p.z });
    sim.step();
  }
}

function armElixirs(sim: Sim, qty: number): void {
  const pid = sim.localPlayerId()!;
  const save = sim.serializePlayer(pid)!;
  save.bag = [{ itemId: 'elixir_weapon', rarity: 'normal', plus: 0, qty }];
  sim.restorePlayer(pid, save); // posição é transiente -> o restore NÃO move o jogador
}

describe('Sistema 20: trade-in (reciclagem)', () => {
  it('recicla 3 Elixir de Arma -> 1 Pedra de Proteção no alquimista (consome inputs, produz output)', () => {
    const sim = new Sim(7);
    moveNear(sim, ALCH_X, ALCH_Z);
    armElixirs(sim, 3);
    expect(count(sim, 'elixir_weapon')).toBe(3);
    expect(count(sim, 'protect_stone')).toBe(0);
    sim.sendCommand({ t: 'redeem', recipe: 0 }); // receita 0 = elixir_weapon 3 -> protect_stone 1
    sim.step();
    expect(count(sim, 'elixir_weapon')).toBe(0);
    expect(count(sim, 'protect_stone')).toBe(1);
  });

  it('NÃO recicla longe do alquimista (o item não é consumido)', () => {
    const sim = new Sim(7); // fica no spawn (0,0), longe da loja
    armElixirs(sim, 3);
    sim.sendCommand({ t: 'redeem', recipe: 0 });
    sim.step();
    expect(count(sim, 'elixir_weapon')).toBe(3);
    expect(count(sim, 'protect_stone')).toBe(0);
  });

  it('NÃO recicla sem inputs suficientes (2 < 3)', () => {
    const sim = new Sim(7);
    moveNear(sim, ALCH_X, ALCH_Z);
    armElixirs(sim, 2);
    sim.sendCommand({ t: 'redeem', recipe: 0 });
    sim.step();
    expect(count(sim, 'elixir_weapon')).toBe(2); // intacto
    expect(count(sim, 'protect_stone')).toBe(0);
  });

  it('índice de receita inválido é no-op', () => {
    const sim = new Sim(7);
    moveNear(sim, ALCH_X, ALCH_Z);
    armElixirs(sim, 3);
    sim.sendCommand({ t: 'redeem', recipe: 99 });
    sim.step();
    expect(count(sim, 'elixir_weapon')).toBe(3);
  });

  it('há receitas definidas ancoradas em itens conhecidos', () => {
    expect(RECIPES.length).toBeGreaterThan(0);
    expect(RECIPES[0]).toMatchObject({ input: 'elixir_weapon', output: 'protect_stone', inputQty: 3, outputQty: 1 });
  });

  it('é determinístico (mesmo seed + comandos => hash idêntico)', () => {
    const run = (): string => {
      const sim = new Sim(7);
      moveNear(sim, ALCH_X, ALCH_Z);
      armElixirs(sim, 3);
      sim.sendCommand({ t: 'redeem', recipe: 0 });
      sim.step();
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
