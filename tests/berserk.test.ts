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
import { BERSERK_MAX } from '../src/sim/content/berserk';

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

  it('aplica ANTES do crit (o burst e o crit compõem)', () => {
    // critChance 1 => sempre crita; base já com berserk, depois × CRIT_MULT.
    const hit = compute(ctx({ damageMult: 2, critChance: 1, rng: new Rng(1) }));
    expect(hit.crit).toBe(true);
    expect(hit.amount).toBe(Math.round(50 * CRIT_MULT)); // (25×2)=50, depois × 2.0 = 100
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
