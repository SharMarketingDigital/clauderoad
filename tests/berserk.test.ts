// Berserk/Hwan (Sistema 2, Fatia 1) — o EIXO DE DANO DE SAÍDA que faltava ao combate. compute() ganha um
// damageMult (default 1 => byte-idêntico); o sim soma os buffs 'berserk' num attackFactor e o passa nos
// golpes do JOGADOR. Espelho invertido do defenseFactor de entrada. Duas camadas de teste: o compute() puro
// (byte-idêntico quando ausente, multiplica, aplica ANTES do crit) e a fiação em combate real.
import { describe, it, expect } from 'vitest';
import { compute, CRIT_MULT } from '../src/sim/combat';
import type { OffenseContext } from '../src/sim/combat';
import type { AbilityDef } from '../src/sim/content/abilities';
import type { Entity } from '../src/sim/types';
import { Sim } from '../src/sim/sim';
import { Rng } from '../src/sim/rng';
import { BERSERK_MAX, BERSERK_PER_HIT, BERSERK_LEVELS, berserkLevel } from '../src/sim/content/berserk';
import { addToBag } from '../src/sim/inventory';
import { chebyshev } from '../src/sim/zones';

const LEATHER5 = ['leather_cap', 'wolf_leather', 'leather_gloves', 'leather_pants', 'leather_boots']; // parry 15

const entById = (sim: Sim, id: number): Entity =>
  [...(sim as unknown as Internal).ents.values()].find((e) => e.id === id)!;

// compute() só lê attacker.str / weaponDamage / baseInt — um stub minúsculo basta (como o target() do armor.test).
const attacker = (str: number, weaponDamage: number): Entity =>
  ({ str, weaponDamage, baseInt: 0 }) as unknown as Entity;
const ctx = (over: Partial<OffenseContext>): OffenseContext => ({
  attacker: attacker(10, 20), rank: 1, damageType: 'physical', critChance: 0, rng: new Rng(1), ...over,
});

describe('Berserk — damageMult no compute() (puro)', () => {
  it('ausente ou 1 é byte-idêntico (mundo sem berserk intocado)', () => {
    expect(compute(ctx({})).amount).toBe(25); // meleeDamage(10,20) = 20 + floor(10*0.5) = 25
    expect(compute(ctx({ damageMult: 1 })).amount).toBe(25); // ×1 não muda o round
  });

  it('multiplica o dano de saída do auto-attack', () => {
    expect(compute(ctx({ damageMult: 2 })).amount).toBe(50); // 25 × 2
    expect(compute(ctx({ damageMult: 1.5 })).amount).toBe(38); // round(25 × 1.5) = 38
  });

  it('multiplica também as abilities (× rankDamageMult × berserk)', () => {
    const def = { damageMultiplier: 2 } as unknown as AbilityDef; // abilityDamage = round(25 × 2) = 50
    expect(compute(ctx({ ability: def })).amount).toBe(50);
    expect(compute(ctx({ ability: def, damageMult: 2 })).amount).toBe(100); // 50 × 2
  });

  it('aplica ANTES do crit (o burst compõe com o crit; DISTINGUE a ordem)', () => {
    // Multiplicador FRACIONÁRIO (1.5) pra a ordem importar: antes-do-crit round(round(25×1.5)×2)=76;
    // depois-do-crit daria round(round(25×2)×1.5)=75. (Com ×2 inteiro, 100=100 — não distinguiria.)
    const hit = compute(ctx({ damageMult: 1.5, critChance: 1, rng: new Rng(1) }));
    expect(hit.crit).toBe(true);
    const burstBase = Math.round(25 * 1.5); // 38 — o base JÁ com o burst, ANTES do crit
    expect(hit.amount).toBe(Math.round(burstBase * CRIT_MULT)); // 76 (antes); a ordem invertida daria 75
  });
});

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
// Combate contínuo e confiável (sem depender de pathing): cola o player NO mob (contato → o auto-attack
// dispara sem checar facing) com o mob de HP inflado e revidando — ambos os eixos da barra enchem rápido.
const pinAndFight = (sim: Sim, mobId: number, ticks: number): void => {
  for (let i = 0; i < ticks; i++) {
    const w = ents(sim).find((e) => e.id === mobId);
    if (w) {
      w.maxHp = 100000; w.hp = 100000;
      const p = player(sim);
      p.x = w.x + 0.3; p.z = w.z; // contato: dentro do alcance de melee, dispara golpes todo swing
      sim.sendCommand({ t: 'set-target', id: mobId });
    }
    sim.step();
  }
};

describe('Berserk — damageMult em combate real (fiação attackFactor→compute)', () => {
  it('um buff berserk faz o player causar MAIS dano ao alvo (o eixo chega ao golpe)', () => {
    // Soma o dano causado a um mob (com HP inflado p/ não morrer) por 80 ticks de auto-attack. O buff berserk
    // não muda movimento/comandos, só o dano — então o run com berserk (×2) causa mais que o baseline.
    const dealtTo = (berserk: boolean): number => {
      const sim = new Sim(3);
      const mobId = nearestWolf(sim)!.id;
      if (berserk) {
        player(sim).effects.push({ kind: 'berserk', expiresAt: 999999, magnitude: 1.0, period: 0, nextAt: 0, source: 0 });
      }
      const seen = new Set<number>();
      let dealt = 0;
      for (let i = 0; i < 300; i++) {
        const p = player(sim);
        const w = ents(sim).find((e) => e.id === mobId);
        if (w) {
          w.maxHp = 100000; w.hp = 100000; // HP inflado → sobrevive a todo golpe, acumula hits comparáveis
          sim.sendCommand({ t: 'set-target', id: mobId });
          sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        }
        sim.step();
        for (const ev of sim.recentEvents()) {
          if (seen.has(ev.seq)) continue;
          seen.add(ev.seq);
          if (ev.kind === 'damage' && ev.targetId === mobId) dealt += ev.amount;
        }
      }
      return dealt;
    };
    const baseline = dealtTo(false);
    const bersered = dealtTo(true);
    expect(baseline).toBeGreaterThan(0); // o player de fato bateu no mob
    expect(bersered).toBeGreaterThan(baseline); // berserk (×2) causou mais — o damageMult chegou ao compute
  });
});

describe('Berserk — a barra (enche em combate, decai fora) — Fatia 2', () => {
  it('DAR um golpe enche a barra (isolado: o mob não revida)', () => {
    const sim = new Sim(3);
    const mobId = nearestWolf(sim)!.id;
    expect(player(sim).berserkGauge ?? 0).toBe(0);
    for (let i = 0; i < 300; i++) {
      const p = player(sim);
      const w = ents(sim).find((e) => e.id === mobId);
      if (w) {
        w.maxHp = 100000; w.hp = 100000; w.swingTicks = 0; // HP inflado + NÃO revida (swingTicks 0)
        sim.sendCommand({ t: 'set-target', id: mobId });
        sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      }
      sim.step();
    }
    expect(player(sim).berserkGauge ?? 0).toBeGreaterThan(0); // só DEU golpes → a barra encheu
  });

  it('LEVAR um golpe enche a barra (isolado: o player não revida)', () => {
    const sim = new Sim(3);
    for (let i = 0; i < 400; i++) {
      const p = player(sim);
      const w = nearestWolf(sim);
      if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z }); // sem set-target → não ataca, só tanka
      sim.step();
    }
    expect(player(sim).berserkGauge ?? 0).toBeGreaterThan(0); // só LEVOU mordidas → a barra encheu
  });

  it('a barra CAPA em BERSERK_MAX (combate sustentado não passa do teto)', () => {
    const sim = new Sim(3);
    const mobId = nearestWolf(sim)!.id;
    pinAndFight(sim, mobId, 800); // combate contínuo prolongado
    expect(player(sim).berserkGauge).toBe(BERSERK_MAX); // enche até o teto e trava lá
  });

  it('fora de combate a barra DECAI até 0', () => {
    const sim = new Sim(3);
    player(sim).berserkGauge = BERSERK_MAX; // barra cheia
    for (let i = 0; i < 200; i++) sim.step(); // ~10 s parado em segurança (town) → fora de combate → decai
    expect(player(sim).berserkGauge).toBe(0); // esvaziou (mutação "decay não faz nada" ficaria em BERSERK_MAX)
  });

  it('um tick de DoT NÃO enche a barra (só golpes reais, não passivos)', () => {
    const sim = new Sim(3);
    player(sim).effects.push({ kind: 'dot', expiresAt: 999999, magnitude: 5, period: 1, nextAt: sim.tick + 1, source: 0 });
    for (let i = 0; i < 40; i++) { player(sim).hp = player(sim).maxHp; sim.step(); } // refill: o DoT ticka mas não mata
    expect(player(sim).berserkGauge ?? 0).toBe(0); // DoT (dodgeable=false) não conta como golpe levado
  });

  it('DAR: um golpe do player ESQUIVADO pelo alvo (PvP) NÃO enche a barra do atacante (gate landed)', () => {
    // Espelho do teste do DoT, mas no lado do DAR (o gate `landed` em hitTarget). Só ativável em PvP — mob
    // nunca esquiva. B veste couro (parry 15) e NÃO revida (swingTicks 0), então a barra de A só pode encher
    // pelo que A DÁ; num tick de esquiva PURA de A→B, a barra de A não pode crescer.
    const sim = new Sim(3, /* spawnLocal */ false);
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    sim.sendCommandFor(a, { t: 'duel-challenge', name: 'B' }); sim.step();
    sim.sendCommandFor(b, { t: 'duel-accept' }); sim.step();
    entById(sim, b).swingTicks = 0; // B não ataca A → isola o DAR de A (a barra de A não enche por LEVAR)
    for (const it of LEATHER5) {
      addToBag(entById(sim, b).bag, it, 'normal', 0, 1);
      sim.sendCommandFor(b, { t: 'equip', itemId: it, rarity: 'normal', plus: 0 });
      sim.step();
    }
    expect(entById(sim, b).parry).toBe(15);
    sim.sendCommandFor(b, { t: 'move', dx: 1, dz: 1 }); // B sai da cidade (fora da safe-zone A conecta/esquiva)
    for (let i = 0; i < 600 && chebyshev(entById(sim, b).x, entById(sim, b).z) <= 35; i++) sim.step();
    sim.sendCommandFor(b, { t: 'stop' }); sim.step();
    entById(sim, a).berserkGauge = 0;
    const seen = new Set<number>();
    let landedOnB = 0;
    let dodgedByB = 0;
    for (let i = 0; i < 400; i++) {
      // DESLIGA as mordidas de TODO mob → o único combate é A→B; assim as esquivas ('miss' em B) são só
      // dos golpes de A (senão mobs mordendo B, que esquiva com parry 15, poluiriam a medição).
      for (const e of ents(sim)) if (e.kind === 'enemy') e.swingTicks = 0;
      const A = entById(sim, a), B = entById(sim, b);
      A.x = B.x + 0.3; A.z = B.z; // cola A em B (contato → A desfere golpes em B)
      sim.sendCommandFor(a, { t: 'set-target', id: b });
      sim.step();
      for (const ev of sim.recentEvents()) {
        if (seen.has(ev.seq)) continue;
        seen.add(ev.seq);
        if (ev.targetId !== b) continue;
        if (ev.kind === 'damage') landedOnB++;
        else if (ev.kind === 'miss') dodgedByB++;
      }
    }
    expect(dodgedByB).toBeGreaterThan(0); // B esquivou golpes de A (o gate landed foi exercido)
    expect(landedOnB * BERSERK_PER_HIT).toBeLessThan(BERSERK_MAX); // barra abaixo do teto → a diferença aparece
    // A barra de A = SÓ os golpes que CONECTARAM × PER_HIT. Se o gate landed cair, os esquivados também
    // contariam ((landed+dodged)×PER_HIT) e a barra ficaria maior.
    expect(entById(sim, a).berserkGauge ?? 0).toBe(landedOnB * BERSERK_PER_HIT);
  });

  it('a barra é DETERMINÍSTICA (mesma seed + mesmo combate → mesma barra) e persiste no save', () => {
    const gaugeAfter = (): number => {
      const sim = new Sim(3);
      const mobId = nearestWolf(sim)!.id;
      pinAndFight(sim, mobId, 120);
      return player(sim).berserkGauge ?? 0;
    };
    const g = gaugeAfter();
    expect(g).toBeGreaterThan(0);
    expect(gaugeAfter()).toBe(g); // determinístico

    const a = new Sim(3);
    player(a).berserkGauge = 48;
    const save = a.serializePlayer(player(a).id)!;
    const b = new Sim(4);
    b.restorePlayer(player(b).id, JSON.parse(JSON.stringify(save)));
    expect(player(b).berserkGauge).toBe(48); // roundtrip de save preserva a barra
  });

  it('mobs não têm barra de berserk (só players enchem)', () => {
    const sim = new Sim(8);
    for (let i = 0; i < 30; i++) sim.step();
    const enemy = ents(sim).find((e) => e.kind === 'enemy')!;
    expect(enemy.berserkGauge ?? 0).toBe(0);
  });
});

const kinds = (p: Entity): string[] => p.effects.map((s) => s.kind);

describe('Berserk — ativação do burst (Fatia 3)', () => {
  it('berserkLevel deriva 0/1/2/3 nos limiares (>=33/66/100%)', () => {
    expect(berserkLevel(0)).toBe(0);
    expect(berserkLevel(32)).toBe(0); // < 33% → não ativa
    expect(berserkLevel(33)).toBe(1);
    expect(berserkLevel(65)).toBe(1);
    expect(berserkLevel(66)).toBe(2);
    expect(berserkLevel(99)).toBe(2);
    expect(berserkLevel(100)).toBe(3);
  });

  it('ativar com a barra cheia aplica os 3 eixos (berserk/crit/haste), ZERA a barra e emite evento', () => {
    const sim = new Sim(3);
    player(sim).berserkGauge = BERSERK_MAX; // cheia → nível 3
    const pid = player(sim).id;
    sim.sendCommand({ t: 'activate-berserk' });
    sim.step();
    const p = player(sim);
    expect(kinds(p)).toEqual(expect.arrayContaining(['berserk', 'crit', 'haste'])); // os 3 eixos
    expect(p.berserkGauge).toBe(0); // gastou a barra
    const berserk = p.effects.find((s) => s.kind === 'berserk')!;
    expect(berserk.magnitude).toBe(BERSERK_LEVELS[2].damageMult); // nível 3 → 0.80
    expect(sim.recentEvents().some((ev) => ev.kind === 'berserk' && ev.targetId === pid && ev.amount === 3)).toBe(true);
  });

  it('NÃO ativa com a barra < 33% (recusa sem gastar)', () => {
    const sim = new Sim(3);
    player(sim).berserkGauge = 30; // 30% < 33%
    sim.sendCommand({ t: 'activate-berserk' });
    sim.step();
    const p = player(sim);
    expect(p.effects.some((s) => s.kind === 'berserk')).toBe(false); // não aplicou nada
    expect(p.berserkGauge).toBe(30); // não gastou a barra
  });

  it('o nível deriva da barra: 40% → nível 1 (magnitudes fracas, não as do nível 3)', () => {
    const sim = new Sim(3);
    player(sim).berserkGauge = 40; // 40% → nível 1
    sim.sendCommand({ t: 'activate-berserk' });
    sim.step();
    const berserk = player(sim).effects.find((s) => s.kind === 'berserk')!;
    expect(berserk.magnitude).toBe(BERSERK_LEVELS[0].damageMult); // nível 1 → 0.20 (não 0.80)
  });

  it('haste: em berserk o player desfere MAIS golpes na mesma janela (swings mais rápidos)', () => {
    const hitsDealt = (berserk: boolean): number => {
      const sim = new Sim(3);
      const mobId = nearestWolf(sim)!.id;
      if (berserk) { player(sim).berserkGauge = BERSERK_MAX; sim.sendCommand({ t: 'activate-berserk' }); }
      const seen = new Set<number>();
      let hits = 0;
      for (let i = 0; i < 120; i++) {
        const w = ents(sim).find((e) => e.id === mobId);
        if (w) { w.maxHp = 100000; w.hp = 100000; const p = player(sim); p.x = w.x + 0.3; p.z = w.z; sim.sendCommand({ t: 'set-target', id: mobId }); }
        sim.step();
        for (const ev of sim.recentEvents()) {
          if (seen.has(ev.seq)) continue;
          seen.add(ev.seq);
          if (ev.kind === 'damage' && ev.targetId === mobId) hits++;
        }
      }
      return hits;
    };
    const baseline = hitsDealt(false);
    const bersered = hitsDealt(true);
    expect(baseline).toBeGreaterThan(0);
    expect(bersered).toBeGreaterThan(baseline); // haste (×1.25) → mais swings na mesma janela
  });

  it('paridade online: activate-berserk é aceito no server-mode (o buff aplica)', () => {
    const sim = new Sim(1, /* spawnLocal */ false);
    const a = sim.addPlayer('A');
    entById(sim, a).berserkGauge = BERSERK_MAX;
    sim.sendCommandFor(a, { t: 'activate-berserk' });
    sim.step();
    expect(entById(sim, a).effects.some((s) => s.kind === 'berserk')).toBe(true);
  });
});
