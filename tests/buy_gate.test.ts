// Sistema 20 — gate de compra por reqLevel. Fiel ao refaccesspermissionofshop do Silkroad (acesso à loja
// gated por condição do jogador): a loja não vende gear acima do reqLevel do comprador. Mesmo gate do equip
// (equipLevelReq), só p/ EQUIPÁVEIS. Defesa em profundidade — hoje o estoque é todo grau-1 (impacto zero),
// então injetamos um g2 num shop SÓ no teste pra exercitar o bloqueio, restaurando ao fim.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { TOWN_SHOPS, VENDOR_SPAWN_X, VENDOR_SPAWN_Z } from '../src/sim/content/vendor';

const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;
const has = (sim: Sim, id: string) => sim.inventory().stacks.some((s) => s.itemId === id);

function moveNear(sim: Sim, x: number, z: number): void {
  for (let i = 0; i < 600; i++) {
    const p = player(sim);
    if (Math.hypot(p.x - x, p.z - z) <= 3) return;
    sim.sendCommand({ t: 'move', dx: x - p.x, dz: z - p.z });
    sim.step();
  }
}

function atLevel(sim: Sim, level: number, gold: number): void {
  const pid = sim.localPlayerId()!;
  const save = sim.serializePlayer(pid)!;
  save.level = level;
  save.gold = gold;
  sim.restorePlayer(pid, save); // posição é transiente -> o restore NÃO move o jogador (fica na loja)
}

describe('Sistema 20: gate de compra por reqLevel', () => {
  it('recusa comprar gear acima do reqLevel; permite ao atingir o nível (silver_ring, reqLevel 4)', () => {
    const smith = TOWN_SHOPS.find((s) => s.species === 'blacksmith')!;
    smith.stock.push({ itemId: 'silver_ring', price: 100 }); // g2 gated, injetado só neste teste
    try {
      const sim = new Sim(7);
      moveNear(sim, VENDOR_SPAWN_X, VENDOR_SPAWN_Z); // vai até o ferreiro
      // nv1 < reqLevel 4 -> BLOQUEADO, sem cobrar
      atLevel(sim, 1, 1000);
      sim.sendCommand({ t: 'buy', itemId: 'silver_ring' });
      sim.step();
      expect(has(sim, 'silver_ring')).toBe(false);
      expect(player(sim).gold).toBe(1000); // não cobrado
      // nv4 >= reqLevel 4 -> PERMITIDO
      atLevel(sim, 4, 1000);
      sim.sendCommand({ t: 'buy', itemId: 'silver_ring' });
      sim.step();
      expect(has(sim, 'silver_ring')).toBe(true);
      expect(player(sim).gold).toBe(900); // cobrado 100
    } finally {
      smith.stock.pop(); // restaura o estoque compartilhado
    }
  });

  it('não bloqueia gear grau-1 nem consumíveis (sem falso-bloqueio)', () => {
    const sim = new Sim(7);
    moveNear(sim, VENDOR_SPAWN_X, VENDOR_SPAWN_Z); // ferreiro (armas base reqLevel 1)
    atLevel(sim, 1, 1000);
    sim.sendCommand({ t: 'buy', itemId: 'iron_spear' }); // arma base grau-1
    sim.step();
    expect(has(sim, 'iron_spear')).toBe(true); // nv1 compra gear reqLevel-1 normalmente
  });
});
