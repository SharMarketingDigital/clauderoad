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

  it('NÃO recicla numa loja que não é o alquimista (só o alquimista recicla)', () => {
    const sim = new Sim(7);
    moveNear(sim, 16, 6); // armadureiro (16,6), a 4 unidades do alquimista -> nearestShop = armadureiro
    armElixirs(sim, 3);
    sim.sendCommand({ t: 'redeem', recipe: 0 });
    sim.step();
    expect(count(sim, 'elixir_weapon')).toBe(3); // intacto (gate species !== 'alchemist')
    expect(count(sim, 'protect_stone')).toBe(0);
  });

  it('recicla com a bolsa CHEIA quando o slot do input se libera (sem falso-bloqueio)', () => {
    const sim = new Sim(7);
    moveNear(sim, ALCH_X, ALCH_Z);
    const pid = sim.localPlayerId()!;
    // 20 slots (bolsa cheia): slot 0 = 3 elixir_weapon; os outros 19 = itens distintos SEM protect_stone.
    const filler = ['leather_cap', 'wolf_leather', 'leather_gloves', 'leather_pants', 'leather_boots',
      'wooden_shield', 'copper_necklace', 'copper_earring', 'copper_ring', 'iron_spear', 'short_bow',
      'apprentice_staff', 'mana_potion', 'health_potion', 'elixir_armor', 'pet_grab', 'mount_horse',
      'skill_reset', 'return_scroll'];
    const save = sim.serializePlayer(pid)!;
    save.bag = [
      { itemId: 'elixir_weapon', rarity: 'normal', plus: 0, qty: 3 },
      ...filler.map((id) => ({ itemId: id, rarity: 'normal' as const, plus: 0, qty: 1 })),
    ];
    sim.restorePlayer(pid, save);
    expect(sim.inventory().stacks.length).toBe(20); // bolsa cheia (20/20)
    sim.sendCommand({ t: 'redeem', recipe: 0 });
    sim.step();
    expect(count(sim, 'elixir_weapon')).toBe(0); // consumidos -> o slot se liberou
    expect(count(sim, 'protect_stone')).toBe(1); // e o output coube no slot liberado (o fix)
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
