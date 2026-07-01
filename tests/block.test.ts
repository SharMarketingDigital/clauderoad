// Block (Fase 3 · Sistema 1 · Fatia 2) — o ESCUDO amortece um golpe que conectou. Distinto da esquiva: a
// esquiva ANULA (miss, 0 dano, sem on-hit), o block AMORTECE (o golpe conecta, dá dano reduzido, ainda aplica
// on-hit). Camadas separadas: leve esquiva, pesado bloqueia. Cobre: o FOLD (blockRatio FLAT do escudo, não
// escala), o ROLL gated por blockRatio>0 (mundo sem escudo byte-idêntico ao pré-block), o amortecimento
// (reduz, não anula), e que mobs não bloqueiam.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { BLOCK_DMG_MULT } from '../src/sim/combat';
import type { Entity } from '../src/sim/types';
import type { Rarity } from '../src/world_api';
import { addToBag } from '../src/sim/inventory';

type Internal = { ents: Map<number, Entity> };
const ents = (sim: Sim): Entity[] => [...(sim as unknown as Internal).ents.values()];
const player = (sim: Sim): Entity => ents(sim).find((e) => e.kind === 'player')!;
const nearestWolf = (sim: Sim): Entity | undefined => {
  const p = player(sim);
  let best: Entity | undefined; let bd = Infinity;
  for (const e of ents(sim)) {
    if (e.kind !== 'enemy') continue;
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
};
const equip = (sim: Sim, itemId: string, rarity: Rarity = 'normal', plus = 0): void => {
  addToBag(player(sim).bag, itemId, rarity, plus, 1);
  sim.sendCommand({ t: 'equip', itemId, rarity, plus });
  sim.step();
};

describe('Block — fold da chance de bloqueio (FLAT, só escudo)', () => {
  it('sem escudo → blockRatio 0 (o roll de block nunca dispara)', () => {
    expect(player(new Sim(1)).blockRatio ?? 0).toBe(0);
  });

  it('escudo maior bloqueia mais: madeira 0.10 < ferro 0.15 < torre 0.20 (por grau)', () => {
    const blockOf = (shieldId: string, seed: number): number => {
      const sim = new Sim(seed);
      player(sim).level = 10; // ferro (reqLevel 4) e torre (reqLevel 8) exigem nível
      equip(sim, shieldId);
      return player(sim).blockRatio ?? 0;
    };
    expect(blockOf('wooden_shield', 1)).toBeCloseTo(0.10, 10);
    expect(blockOf('iron_shield', 2)).toBeCloseTo(0.15, 10);
    expect(blockOf('tower_shield', 3)).toBeCloseTo(0.20, 10);
  });

  it('blockRatio é FLAT — NÃO escala por raridade nem +N: um escudo SUN +5 ainda bloqueia 0.10', () => {
    const sim = new Sim(4);
    equip(sim, 'wooden_shield', 'sun', 5);
    expect(player(sim).blockRatio ?? 0).toBeCloseTo(0.10, 10); // derivado do item, ignora raridade/+N
    expect(player(sim).phyDef).toBeGreaterThan(2); // …enquanto phyDef DID escalar — provando que divergem
  });

  it('só ESCUDO dá block — armadura/arma/acessório não', () => {
    const sim = new Sim(5);
    equip(sim, 'wolf_leather'); // chest
    equip(sim, 'old_sword'); // weapon
    equip(sim, 'copper_ring'); // accessory
    expect(player(sim).blockRatio ?? 0).toBe(0);
  });

  it('desequipar o escudo reverte o block a 0; é derivado (recomputa no restore)', () => {
    const a = new Sim(6);
    equip(a, 'wooden_shield');
    expect(player(a).blockRatio).toBeCloseTo(0.10, 10);
    a.sendCommand({ t: 'unequip', slot: 'shield' });
    a.step();
    expect(player(a).blockRatio ?? 0).toBe(0);

    const b = new Sim(7);
    equip(b, 'wooden_shield');
    const save = b.serializePlayer(player(b).id)!;
    const c = new Sim(8);
    c.restorePlayer(player(c).id, JSON.parse(JSON.stringify(save)));
    expect(player(c).blockRatio).toBeCloseTo(0.10, 10); // recomputado do escudo salvo
  });
});

// Reproduz EXATAMENTE o cenário do gate de determinismo da Fatia 1 (mesma seed/cadência/ticks). O mundo
// pelado não toca escudo → o hash TEM de ser idêntico ao pré-block. Se o gate `blockRatio>0` for removido,
// cada mordida saca um rng extra (rng.next() < 0 nunca bloqueia, mas CONSOME o valor) → o hash muda.
function combatRun(seed: number, equipIds: string[], ticks: number): string {
  const sim = new Sim(seed);
  for (const it of equipIds) equip(sim, it);
  for (let i = 0; i < ticks; i++) {
    const p = player(sim);
    const w = nearestWolf(sim);
    if (w) {
      sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      if (i % 3 === 0) sim.sendCommand({ t: 'set-target', id: w.id });
      if (i % 9 === 0) sim.sendCommand({ t: 'use-ability', slot: 1 });
    }
    sim.step();
  }
  return sim.hash();
}

describe('Block — determinismo gated (mundo sem escudo byte-idêntico ao pré-block)', () => {
  it('ÂNCORA: um mundo SEM escudo hasheia o valor pré-block (o gate não saca rng) — pega a remoção do gate', () => {
    // 76afeb09 = hash do mesmo cenário BARE capturado antes de existir código de block. Se este assert
    // falhar, ou o gate `blockRatio>0` sacou rng num mundo pelado, ou outra mudança perturbou o stream bare.
    expect(combatRun(12345, [], 800)).toBe('76afeb09');
  });

  it('um mundo COM escudo é reproduzível (mesma seed → mesmo hash) e DIFERE do pelado (block vivo)', () => {
    const shielded = combatRun(12345, ['wooden_shield'], 800);
    expect(shielded).toBe(combatRun(12345, ['wooden_shield'], 800)); // reproduzível
    expect(shielded).not.toBe(combatRun(12345, [], 800)); // o block muda o mundo → feature viva, não no-op
  });
});

describe('Block — amortece (não anula) e mobs não bloqueiam', () => {
  it('BLOCK_DMG_MULT é a fração provisória (0.25 — absorve 75%)', () => {
    expect(BLOCK_DMG_MULT).toBe(0.25);
  });

  it('um golpe BLOQUEADO dá dano REDUZIDO mas ≥1 (amortece, não anula)', () => {
    const sim = new Sim(7);
    const pid = player(sim).id;
    const seen = new Set<number>();
    const blocked: number[] = [];
    const unblocked: number[] = [];
    for (let i = 0; i < 700; i++) {
      const p = player(sim);
      p.hp = p.maxHp; // sobrevive tankando
      p.blockRatio = 0.5; // sem armadura: sem esquiva/mitigação → separação limpa entre bloqueado e não
      const w = nearestWolf(sim);
      if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      sim.step();
      for (const ev of sim.recentEvents()) {
        if (seen.has(ev.seq)) continue;
        seen.add(ev.seq);
        if (ev.kind !== 'damage' || ev.targetId !== pid) continue;
        (ev.blocked ? blocked : unblocked).push(ev.amount);
      }
    }
    expect(blocked.length).toBeGreaterThan(0); // alguns golpes foram bloqueados
    expect(unblocked.length).toBeGreaterThan(0); // e alguns não (a 50% ambos aparecem)
    expect(Math.min(...blocked)).toBeGreaterThanOrEqual(1); // NÃO anula: um bloqueio ainda tira ≥1
    expect(Math.max(...blocked)).toBeLessThan(Math.min(...unblocked)); // bloqueado << não-bloqueado (~25%)
  });

  it('mobs não têm escudo → nunca bloqueiam (o caminho de block é só do player)', () => {
    const sim = new Sim(8);
    for (let i = 0; i < 5; i++) sim.step();
    const enemy = ents(sim).find((e) => e.kind === 'enemy')!;
    expect(enemy.blockRatio ?? 0).toBe(0);
  });
});
