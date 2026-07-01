// Sistema 15 (QoL) — Pergaminho de Retorno (return scroll). Recall à cidade registrada como item
// consumível: reusa o use-item + a lógica de destino do Return grátis, mas SEM o cooldown de 120s (o item
// é o custo). Bloqueado em combate (não é fuga instantânea). Fiel aos ITEM_ETC_SCROLL_RETURN_* do Silkroad;
// instantâneo (sem warm-up — corte consciente). Puro/determinístico (teleporte = posição fixa, sem Rng).
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TOWN_SHOPS } from '../src/sim/content/vendor';

const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
const hasScroll = (sim: Sim) => sim.inventory().stacks.some((s) => s.itemId === 'return_scroll');

// Dá gold (p/ o teleporte de ida) + N pergaminhos, mantendo o returnCity default ('town', centro em 0,0).
function armScroll(sim: Sim, qty = 1): void {
  const pid = sim.localPlayerId()!;
  const save = sim.serializePlayer(pid)!;
  save.gold = 1000;
  save.baseMaxHp = 1000; // aguenta um lobo no teste de combate
  save.bag = [{ itemId: 'return_scroll', rarity: 'normal', plus: 0, qty }];
  sim.restorePlayer(pid, save);
}

const useScroll = (sim: Sim) => {
  sim.sendCommand({ t: 'use-item', itemId: 'return_scroll', rarity: 'normal', plus: 0 });
  sim.step();
};

// Anda em direção ao lobo mais próximo até um aggro-ar (= em combate), pra testar o bloqueio.
function aggroAWolf(sim: Sim): void {
  for (let i = 0; i < 500; i++) {
    if (sim.entities().some((e) => e.kind === 'enemy' && !e.boss && e.hostile)) return;
    const p = player(sim);
    const w = sim.entities().find((e) => e.kind === 'enemy' && !e.boss && e.hp > 0);
    if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
    sim.step();
  }
}

describe('Sistema 15: Pergaminho de Retorno', () => {
  it('teleporta pra cidade registrada (town, 0,0) e consome o item', () => {
    const sim = new Sim(7);
    armScroll(sim);
    // vai pra outra cidade (Leste, 250,0) pelo teleporte da cidade central, longe de town
    sim.sendCommand({ t: 'teleport', cityId: 'leste' });
    sim.step();
    expect(Math.abs(player(sim).x - 250)).toBeLessThan(5); // chegou em Leste
    // usa o pergaminho -> volta pra cidade registrada (town, 0,0), sem esperar cooldown
    useScroll(sim);
    expect(Math.abs(player(sim).x) + Math.abs(player(sim).z)).toBeLessThan(5); // de volta ao centro de town
    expect(hasScroll(sim)).toBe(false); // consumido
  });

  it('é BLOQUEADO em combate — não teleporta nem consome o item (não é fuga instantânea)', () => {
    const sim = new Sim(7);
    armScroll(sim);
    aggroAWolf(sim); // entra em combate
    useScroll(sim);
    expect(hasScroll(sim)).toBe(true); // bloqueado -> o pergaminho NÃO é gasto
  });

  it('o boticário vende os pergaminhos de Retorno e Reverso', () => {
    const apoth = TOWN_SHOPS.find((s) => s.species === 'apothecary')!;
    expect(apoth.stock.some((e) => e.itemId === 'return_scroll')).toBe(true);
    expect(apoth.stock.some((e) => e.itemId === 'reverse_scroll')).toBe(true);
  });

  it('o Reverso volta ao ponto de campo anterior (gravado no último recall à cidade)', () => {
    const sim = new Sim(7);
    const pid = sim.localPlayerId()!;
    const save = sim.serializePlayer(pid)!;
    save.gold = 1000;
    save.bag = [
      { itemId: 'return_scroll', rarity: 'normal', plus: 0, qty: 1 },
      { itemId: 'reverse_scroll', rarity: 'normal', plus: 0, qty: 1 },
    ];
    sim.restorePlayer(pid, save);
    sim.sendCommand({ t: 'teleport', cityId: 'leste' }); // vai pra Leste (250,0) — o "ponto de campo"
    sim.step();
    // recall à cidade (town) via return scroll -> grava lastFieldPos = (250,0)
    sim.sendCommand({ t: 'use-item', itemId: 'return_scroll', rarity: 'normal', plus: 0 });
    sim.step();
    expect(Math.abs(player(sim).x) + Math.abs(player(sim).z)).toBeLessThan(5); // em town
    // reverse -> volta pro ponto de campo (250,0)
    sim.sendCommand({ t: 'use-item', itemId: 'reverse_scroll', rarity: 'normal', plus: 0 });
    sim.step();
    expect(Math.abs(player(sim).x - 250)).toBeLessThan(5); // de volta ao grind
    expect(sim.inventory().stacks.some((s) => s.itemId === 'reverse_scroll')).toBe(false); // consumido
  });

  it('o Reverso SEM recall prévio é no-op (não teleporta nem consome)', () => {
    const sim = new Sim(7);
    const pid = sim.localPlayerId()!;
    const save = sim.serializePlayer(pid)!;
    save.bag = [{ itemId: 'reverse_scroll', rarity: 'normal', plus: 0, qty: 1 }];
    sim.restorePlayer(pid, save);
    const x0 = player(sim).x;
    const z0 = player(sim).z;
    sim.sendCommand({ t: 'use-item', itemId: 'reverse_scroll', rarity: 'normal', plus: 0 });
    sim.step();
    expect(sim.inventory().stacks.some((s) => s.itemId === 'reverse_scroll')).toBe(true); // não gasto
    expect(player(sim).x).toBe(x0); // não moveu (sem lastFieldPos)
    expect(player(sim).z).toBe(z0);
  });

  it('é determinístico (mesmo seed + comandos => hash idêntico)', () => {
    const run = (): string => {
      const sim = new Sim(7);
      armScroll(sim, 2);
      sim.sendCommand({ t: 'teleport', cityId: 'leste' });
      sim.step();
      useScroll(sim);
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
