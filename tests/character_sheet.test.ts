// K6 — Ficha de personagem. A ficha (src/ui/character_sheet.ts) é DOM fina e o Vitest roda em
// node SEM DOM; o que importa garantir é o CAMINHO DE DADOS que alimenta a ficha. A ficha mostra
// phyDef/magDef (a defesa do K3), que o K6 passa a expor no EntityView + SelfSnap. Estes testes
// asseguram que os DOIS mundos carregam a defesa: o offline (Sim.entities()) e o online
// (ServerWorld.selfState — o estado autoritativo do jogador local que vira a HUD).
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { ServerWorld } from '../server/world';
import type { Entity } from '../src/sim/types';
import type { EntityView } from '../src/world_api';
import { addToBag } from '../src/sim/inventory';

type EntsInternal = { ents: Map<number, Entity> };
const playerEntity = (sim: Sim): Entity =>
  [...(sim as unknown as EntsInternal).ents.values()].find((e) => e.kind === 'player')!;
const playerView = (sim: Sim): EntityView => sim.entities().find((e) => e.kind === 'player')!;

describe('K6 — caminho de dados da ficha (phyDef/magDef no seam)', () => {
  it('offline: o EntityView do jogador expõe phyDef/magDef; equipar armadura os eleva', () => {
    const sim = new Sim(1);
    const v0 = playerView(sim);
    expect(v0.phyDef).toBe(0); // jogador novo não tem armadura
    expect(v0.magDef).toBe(0);

    addToBag(playerEntity(sim).bag, 'wolf_leather', 'normal', 0, 1);
    sim.sendCommand({ t: 'equip', itemId: 'wolf_leather', rarity: 'normal', plus: 0 });
    sim.step();

    const v1 = playerView(sim);
    expect(v1.phyDef).toBe(2); // wolf_leather (peito): phyDef 2 em Normal +0, durabilidade cheia
    expect(v1.magDef).toBe(1);
  });

  it('offline: inimigos carregam defesa zero na view (combate inalterado)', () => {
    const sim = new Sim(6);
    for (let i = 0; i < 3; i++) sim.step();
    const enemy = sim.entities().find((e) => e.kind === 'enemy');
    expect(enemy).toBeDefined();
    expect(enemy!.phyDef).toBe(0);
    expect(enemy!.magDef).toBe(0);
  });

  it('online: ServerWorld.selfState carrega a defesa real do jogador (caminho do wire p/ a HUD MP)', () => {
    const w = new ServerWorld(1337);
    const id = w.addPlayer('Hero');
    expect(w.selfState(id).phyDef).toBe(0); // sem gear ainda
    expect(w.selfState(id).magDef).toBe(0);

    // Dá a armadura ao jogador do servidor pelo mesmo acesso interno que a suíte do sim usa, e
    // equipa pelo limite de comando do servidor (w.command -> sim.sendCommandFor).
    const sim = (w as unknown as { sim: Sim }).sim;
    addToBag(playerEntity(sim).bag, 'wolf_leather', 'normal', 0, 1);
    w.command(id, { t: 'equip', itemId: 'wolf_leather', rarity: 'normal', plus: 0 });
    w.step();

    expect(w.selfState(id).phyDef).toBe(2); // selfState copia e.phyDef do EntityView
    expect(w.selfState(id).magDef).toBe(1);
  });
});
