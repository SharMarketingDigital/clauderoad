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
