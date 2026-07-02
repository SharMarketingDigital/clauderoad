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
import { SPECIES_BY_ID } from '../src/sim/content/enemies';

// Os 5 slots defensivos de couro (parry 15) — usados p/ ativar parry E block ao mesmo tempo (ordem canônica).
const LEATHER5 = ['leather_cap', 'wolf_leather', 'leather_gloves', 'leather_pants', 'leather_boots'];

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
    // Âncora do stream do mundo BARE (re-baselineada quando o berserkGauge entrou no hash — Sistema 2). Se
    // este assert falhar, ou o gate `blockRatio>0` sacou rng num mundo pelado, ou outra mudança perturbou o
    // stream bare. (Valor original pré-block: 76afeb09; muda a cada campo novo hasheado — atualizar então.)
    expect(combatRun(12345, [], 800)).toBe('ffebc3d5');
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

// Buracos que a revisão adversarial (worktree isolado) pegou: o núcleo block≠esquiva (on-hit ainda aplica),
// o piso ≥1 num golpe bloqueado, e a ordem esquiva-antes-de-block.
describe('Block — cobertura adversarial (block ≠ esquiva; piso; ordem)', () => {
  it('um golpe BLOQUEADO ainda aplica on-hit status (amortece ≠ anula — o oposto da esquiva)', () => {
    // O núcleo do slice: a esquiva ANULA (miss, sem on-hit); o block AMORTECE (conecta, on-hit AINDA aplica).
    // Isso vive em hitPlayer retornar landed=true num golpe bloqueado (gateia applyEnemyOnHit). Mutação
    // `return true`→`return !blocked` suprimiria o on-hit num bloqueio — este teste pega.
    const rogue = SPECIES_BY_ID['skeleton_rogue'];
    const originalChance = rogue.onHit!.chance;
    rogue.onHit!.chance = 1; // toda mordida CONECTADA aplica o dot
    try {
      const sim = new Sim(7);
      const pid = player(sim).id;
      const seen = new Set<number>();
      let blockedHits = 0;
      let gotDot = false;
      for (let i = 0; i < 600; i++) {
        const p = player(sim);
        p.hp = p.maxHp; // sobrevive tankando
        p.blockRatio = 1; // bloqueia TODO golpe (parry 0 → nunca esquiva; logo todo golpe é bloqueado E conecta)
        for (const e of ents(sim)) if (e.kind === 'enemy') e.species = 'skeleton_rogue';
        const w = nearestWolf(sim);
        if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        sim.step();
        for (const ev of sim.recentEvents()) {
          if (seen.has(ev.seq)) continue;
          seen.add(ev.seq);
          if (ev.kind === 'damage' && ev.targetId === pid && ev.blocked) blockedHits++;
        }
        if (player(sim).effects.some((s) => s.kind === 'dot')) gotDot = true;
      }
      expect(blockedHits).toBeGreaterThan(0); // o player de fato BLOQUEOU golpes (não esquivou — parry 0)
      expect(gotDot).toBe(true); // e um golpe BLOQUEADO ainda aplicou o on-hit (bleed) — amortece, não anula
    } finally {
      rogue.onHit!.chance = originalChance;
    }
  });

  it('um golpe bloqueado que renderia <1 é floored em ≥1 (o piso Math.max(1,...) é load-bearing)', () => {
    // Mordida crua = 1 → bloqueada round(1*0.25)=0 → sem o piso, um golpe que CONECTOU daria 0 dano
    // (violando "amortece, não anula"). O piso mantém ≥1. Mutação Math.max(1)→Math.max(0) daria 0 aqui.
    const sim = new Sim(7);
    const pid = player(sim).id;
    const seen = new Set<number>();
    const blockedAmounts: number[] = [];
    for (let i = 0; i < 400; i++) {
      const p = player(sim);
      p.hp = p.maxHp;
      p.blockRatio = 1; // bloqueia todo golpe
      for (const e of ents(sim)) if (e.kind === 'enemy') { e.weaponDamage = 1; e.str = 0; } // mordida crua = 1
      const w = nearestWolf(sim);
      if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      sim.step();
      for (const ev of sim.recentEvents()) {
        if (seen.has(ev.seq)) continue;
        seen.add(ev.seq);
        if (ev.kind === 'damage' && ev.targetId === pid && ev.blocked) blockedAmounts.push(ev.amount);
      }
    }
    expect(blockedAmounts.length).toBeGreaterThan(0); // bloqueou mordidas crus (round(1*0.25)=0 antes do piso)
    expect(Math.min(...blockedAmounts)).toBe(1); // o piso segurou em ≥1 (mutação Math.max(0) daria 0)
  });

  it('ordem canônica esquiva→block: com parry E block ativos, o hash trava a ordem dos rolls', () => {
    // Único cenário com AMBOS os gates ativos (couro=parry 15 + escudo=block 0.10). Reordenar o roll de block
    // pra ANTES do de esquiva consome rng em ordem diferente → muda o stream → o hash pinado difere. (Um
    // assert de evento não pega: o path de esquiva empurra seu próprio 'miss' sem flag blocked em qualquer ordem.)
    const run = (seed: number): string => {
      const sim = new Sim(seed);
      for (const it of LEATHER5) equip(sim, it); // parry 15
      equip(sim, 'wooden_shield'); // blockRatio 0.10 → AMBOS os gates ativos por mordida
      expect(player(sim).parry).toBe(15);
      expect(player(sim).blockRatio).toBeCloseTo(0.10, 10);
      // SEM refill de hp: o dano de golpes esquivados/bloqueados precisa afetar o hp (que ENTRA no hash),
      // senão o hash fica cego à ordem dos rolls. O player de couro+escudo sobrevive à janela (como armor.test).
      for (let i = 0; i < 400; i++) {
        const p = player(sim);
        const w = nearestWolf(sim);
        if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        sim.step();
      }
      expect(player(sim).deadUntil).toBe(0); // sobreviveu → o hash reflete o hp acumulado (sensível à ordem)
      return sim.hash();
    };
    const h = run(20);
    expect(run(20)).toBe(h); // reproduzível
    expect(h).toBe('b97e1292'); // ÂNCORA da ordem: reordenar block-antes-de-esquiva muda o stream → hash difere (re-baselineada no Sistema 2)
  });
});
