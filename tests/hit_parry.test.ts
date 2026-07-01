// Hit × Parry (Fase 3 · Sistema 1 · Fatia 1) — ANTES de qualquer mitigação, o alvo pode ESQUIVAR o golpe
// inteiro. Três camadas: (1) a curva pura hitChance(); (2) o FOLD de parry — derivado FLAT do GRAU da
// armadura (couro g1 3 > malha g2 2 > placa g3 1), NÃO escalado por raridade/+N como phyDef; (3) o combate
// de verdade — um jogador com parry esquiva mordidas (reproduzível), um sem armadura NUNCA esquiva (o roll é
// gated por parry>0, então o mundo sem armadura é byte-idêntico), e mobs não têm parry (nunca esquivam).
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { hitChance, HIT_BASE, HIT_K, HIT_MIN, HIT_MAX, BASE_HIT_RATE } from '../src/sim/combat';
import type { Entity } from '../src/sim/types';
import type { Rarity } from '../src/world_api';
import { addToBag } from '../src/sim/inventory';
import { chebyshev } from '../src/sim/zones';
import { SPECIES_BY_ID } from '../src/sim/content/enemies';

const entById = (sim: Sim, id: number): Entity =>
  [...(sim as unknown as Internal).ents.values()].find((e) => e.id === id)!;

// O maior expiresAt entre os efeitos ativos. applyStatus SUBSTITUI um efeito de mesmo kind (não muda a
// CONTAGEM), então "ganhou/refrescou um debuff" se detecta pelo expiresAt subir — nunca por effects.length.
// Num tick sem aplicação, esse máximo só pode ficar igual ou CAIR (efeitos expiram); um refresh o AUMENTA.
const maxExpiry = (e: Entity): number => e.effects.reduce((m, s) => Math.max(m, s.expiresAt), -1);

type Internal = { ents: Map<number, Entity> };
const ents = (sim: Sim): Entity[] => [...(sim as unknown as Internal).ents.values()];
const player = (sim: Sim): Entity => ents(sim).find((e) => e.kind === 'player')!;
const equip = (sim: Sim, itemId: string, rarity: Rarity = 'normal', plus = 0): void => {
  addToBag(player(sim).bag, itemId, rarity, plus, 1);
  sim.sendCommand({ t: 'equip', itemId, rarity, plus });
  sim.step();
};

// The 5 DEFENSIVE slots per grade (helmet/chest/hands/legs/feet). Shields are a separate slot (block, later).
const LEATHER5 = ['leather_cap', 'wolf_leather', 'leather_gloves', 'leather_pants', 'leather_boots']; // g1 → 3 cada
const CHAIN5 = ['studded_cap', 'chain_vest', 'chain_gloves', 'chain_leggings', 'chain_boots']; // g2 → 2 cada
const PLATE5 = ['plate_helm', 'plate_armor', 'plate_gauntlets', 'plate_legs', 'plate_boots']; // g3 → 1 cada

describe('Hit × Parry — hitChance() (pura)', () => {
  it('as constantes batem com os valores tunados (lean-Silkroad)', () => {
    expect([HIT_BASE, HIT_K, HIT_MIN, HIT_MAX, BASE_HIT_RATE]).toEqual([0.9, 0.01, 0.2, 0.98, 10]);
  });

  it('fórmula: 0.90 + 0.01·(hit − parry)', () => {
    expect(hitChance(10, 10)).toBeCloseTo(0.9, 10); // precisão = esquiva → chance-base
    expect(hitChance(10, 5)).toBeCloseTo(0.95, 10); // set de placa (parry 5) → 95% conecta / 5% esquiva
    expect(hitChance(10, 15)).toBeCloseTo(0.85, 10); // set de couro (parry 15) → 85% conecta / 15% esquiva
  });

  it('faz clamp em [0.20, 0.98]', () => {
    expect(hitChance(10, 1000)).toBe(HIT_MIN); // parry absurdo não passa de 80% de esquiva
    expect(hitChance(1000, 0)).toBe(HIT_MAX); // precisão absurda não garante o acerto (piso de 2% de esquiva)
    expect(hitChance(10, 0)).toBe(HIT_MAX); // 0.90 + 0.10 = 1.0 → cortado em 0.98
  });
});

describe('Hit × Parry — fold de parry (derivado FLAT do grau)', () => {
  it('jogador sem armadura tem parry 0 (o roll de esquiva nunca dispara)', () => {
    expect(player(new Sim(1)).parry ?? 0).toBe(0);
  });

  it('leve esquiva mais que pesado: couro(15) > malha(10) > placa(5), por grau', () => {
    const parryOf = (set: string[], seed: number): number => {
      const sim = new Sim(seed);
      player(sim).level = 10; // malha (reqLevel 4) e placa (reqLevel 8) exigem nível; couro não — inócuo p/ os 3
      for (const it of set) equip(sim, it);
      return player(sim).parry ?? 0;
    };
    expect(parryOf(LEATHER5, 1)).toBe(15); // 5 × 3
    expect(parryOf(CHAIN5, 2)).toBe(10); // 5 × 2
    expect(parryOf(PLATE5, 3)).toBe(5); // 5 × 1
  });

  it('escudo, acessórios e arma NÃO dão parry (só os 5 slots de armadura)', () => {
    const sim = new Sim(4);
    equip(sim, 'wooden_shield'); // slot shield → block depois, não parry
    equip(sim, 'copper_necklace');
    equip(sim, 'copper_ring');
    equip(sim, 'old_sword');
    expect(player(sim).parry ?? 0).toBe(0);
  });

  it('parry é FLAT — NÃO escala por raridade nem +N (ao contrário de phyDef): um peito couro SUN +5 ainda dá 3', () => {
    const sim = new Sim(5);
    equip(sim, 'wolf_leather', 'sun', 5);
    expect(player(sim).parry ?? 0).toBe(3); // derivado do grau, ignora a raridade/+N que aumentam phyDef
    expect(player(sim).phyDef).toBeGreaterThan(2); // …enquanto phyDef SUBIU — provando que divergem
  });

  it('desequipar reverte o parry a 0', () => {
    const sim = new Sim(6);
    equip(sim, 'wolf_leather');
    expect(player(sim).parry).toBe(3);
    sim.sendCommand({ t: 'unequip', slot: 'chest' });
    sim.step();
    expect(player(sim).parry).toBe(0);
  });

  it('parry é DERIVADO, não persistido: volta pelo recompute no restore', () => {
    const a = new Sim(7);
    for (const it of LEATHER5) equip(a, it);
    expect(player(a).parry).toBe(15);
    const save = a.serializePlayer(player(a).id)!;

    const b = new Sim(8);
    const bid = player(b).id;
    b.restorePlayer(bid, JSON.parse(JSON.stringify(save)));
    expect(player(b).parry).toBe(15); // recomputado a partir das armaduras salvas (identidade do gear)
  });
});

// ---- combate de verdade: coletar TODOS os eventos 'miss' ao longo de uma janela (recentEvents é curto) ----
const nearestWolf = (sim: Sim): Entity | undefined => {
  const p = player(sim);
  let best: Entity | undefined;
  let bd = Infinity;
  for (const e of (sim as unknown as Internal).ents.values()) {
    if (e.kind !== 'enemy') continue;
    const d = Math.hypot(e.x - p.x, e.z - p.z);
    if (d < bd) { bd = d; best = e; }
  }
  return best;
};

// Tank the nearest wolf for `ticks`, accumulating every 'miss' event by seq (recentEvents prunes, so poll).
const tankAndCountMisses = (armorSet: string[] | null, seed: number, ticks: number): { misses: number; hash: string; pid: number } => {
  const sim = new Sim(seed);
  if (armorSet) for (const it of armorSet) equip(sim, it);
  const pid = player(sim).id;
  const seen = new Set<number>();
  let misses = 0;
  for (let i = 0; i < ticks; i++) {
    const p = player(sim);
    const w = nearestWolf(sim);
    if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
    sim.step();
    for (const ev of sim.recentEvents()) {
      if (seen.has(ev.seq)) continue;
      seen.add(ev.seq);
      if (ev.kind === 'miss') { misses++; expect(ev.targetId).toBe(pid); } // toda esquiva é do PLAYER
    }
  }
  return { misses, hash: sim.hash(), pid };
};

describe('Hit × Parry — no combate', () => {
  it('um jogador com parry (set de couro) ESQUIVA mordidas; um sem armadura NUNCA esquiva', () => {
    const geared = tankAndCountMisses(LEATHER5, 7, 600);
    // Seed 42 (não 7): com o gate `parry > 0` PRESENTE, um mundo pelado nunca rola → 0 esquivas em qualquer
    // seed. Mas se o gate for removido, hitChance(10,0)=0.98 rola ~2% no player pelado — e no seed 42 isso
    // dispara ≥1 esquiva (no seed 7 a subsequência de rng mascarava, dando 0 mesmo sem o gate). Assim este
    // assert ANCORA a Invariante 1 (mundo sem armadura não toca o rng): pega a remoção do gate.
    const bare = tankAndCountMisses(null, 42, 600);
    expect(geared.misses).toBeGreaterThan(0); // parry 15 → algumas mordidas são desviadas
    expect(bare.misses).toBe(0); // parry 0 → o roll nunca dispara (stream byte-idêntico ao de antes da feature)
  });

  it('as esquivas são DETERMINÍSTICAS: mesma seed → mesma contagem e mesmo hash', () => {
    const a = tankAndCountMisses(LEATHER5, 7, 600);
    const b = tankAndCountMisses(LEATHER5, 7, 600);
    expect(a.misses).toBe(b.misses);
    expect(a.hash).toBe(b.hash);
  });

  it('mobs não têm parry (nunca esquivam — o caminho de esquiva é só do player)', () => {
    const sim = new Sim(8);
    for (let i = 0; i < 5; i++) sim.step();
    const enemy = ents(sim).find((e) => e.kind === 'enemy')!;
    expect(enemy.parry ?? 0).toBe(0);
  });

  it('uma mordida ESQUIVADA não aplica on-hit status — nem de um mob com onHit (bleed)', () => {
    // Protege o gate `if (landed) applyEnemyOnHit(...)` (esquiva ⇒ sem slow/bleed/stun). Sem cobertura, a
    // mutação (applyEnemyOnHit incondicional, ou o ramo de esquiva retornar true) escapa, porque o mob do
    // anel 1 não tem onHit. Aqui o mob que morde vira Ladino E forçamos onHit.chance=1: assim TODA mordida
    // esquivada, SE a mutação rodar applyEnemyOnHit, aplica o dot — o catch fica DETERMINÍSTICO (sem depender
    // do proc de 30% cair num tick de esquiva, o que mascarava a mutação no seed 7).
    const rogue = SPECIES_BY_ID['skeleton_rogue'];
    const originalChance = rogue.onHit!.chance;
    rogue.onHit!.chance = 1;
    try {
      const sim = new Sim(7);
      for (const it of LEATHER5) equip(sim, it); // parry 15 → ~15% de esquiva
      const pid = player(sim).id;
      const seen = new Set<number>();
      let pureDodges = 0;
      for (let i = 0; i < 600; i++) {
        const p = player(sim);
        p.hp = p.maxHp; // mantém o player vivo (bleed 100% mataria) → tanka os 600 ticks, gera esquivas
        // TODO inimigo vira Ladino (não só o mais próximo): garante que QUALQUER mordida esquivada venha de
        // um mob com onHit, pra a mutação ter o que "vazar" em qualquer tick de esquiva.
        for (const e of ents(sim)) if (e.kind === 'enemy') e.species = 'skeleton_rogue';
        const w = nearestWolf(sim);
        if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
        const expiryBefore = maxExpiry(p);
        sim.step();
        let missed = false, tookDamage = false;
        for (const ev of sim.recentEvents()) {
          if (seen.has(ev.seq)) continue;
          seen.add(ev.seq);
          if (ev.targetId !== pid) continue;
          if (ev.kind === 'miss') missed = true;
          else if (ev.kind === 'damage') tookDamage = true;
        }
        // Tick de esquiva PURA (esquivou, NENHUMA mordida conectou): nenhum onHit legítimo pôde rodar, então
        // nenhum dot é aplicado/refrescado → o maior expiresAt só pode ficar igual ou cair (expirar). A
        // mutação chamaria applyEnemyOnHit na esquiva e (chance 1) refrescaria o dot → expiresAt SOBE, e o
        // teste pega. (!tookDamage evita falso-positivo de um bite simultâneo que conectou.)
        if (missed && !tookDamage) {
          pureDodges++;
          expect(maxExpiry(player(sim))).toBeLessThanOrEqual(expiryBefore);
        }
      }
      expect(pureDodges).toBeGreaterThan(0); // o caminho de esquiva pura foi de fato exercido
    } finally {
      rogue.onHit!.chance = originalChance; // restaura o conteúdo compartilhado
    }
  });

  it('um cast de habilidade ESQUIVADO em PvP não aplica o debuff (slow/dot) do golpe', () => {
    // Protege o fix do Fix 1: applyCastEffects gateado em `landed`. strong_strike (slot 1) aplica slow+dot
    // SEM chance, então sob a mutação (gate só por hp>0) todo cast esquivado aplicaria o debuff — catch
    // determinístico. Isola o cast desligando o auto-ataque de A (swingTicks=0) e recarregando MP/HP.
    const sim = new Sim(3, /* spawnLocal */ false); // server-mode: entram via addPlayer
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    sim.sendCommandFor(a, { t: 'duel-challenge', name: 'B' }); sim.step();
    sim.sendCommandFor(b, { t: 'duel-accept' }); sim.step();
    // B veste couro (parry 15) — player de servidor: enche a bag e equipa por comando.
    for (const it of LEATHER5) {
      addToBag(entById(sim, b).bag, it, 'normal', 0, 1);
      sim.sendCommandFor(b, { t: 'equip', itemId: it, rarity: 'normal', plus: 0 });
      sim.step();
    }
    expect(entById(sim, b).parry).toBe(15);
    // B sai da cidade (fora da safe-zone o cast conecta/esquiva; dentro é santuário e o golpe é retido).
    sim.sendCommandFor(b, { t: 'move', dx: 1, dz: 1 });
    for (let i = 0; i < 600 && chebyshev(entById(sim, b).x, entById(sim, b).z) <= 35; i++) sim.step();
    sim.sendCommandFor(b, { t: 'stop' }); sim.step();
    const A = entById(sim, a);
    const B = entById(sim, b);
    A.swingTicks = 0; // desliga o auto-ataque de A → todo golpe em B é do CAST (miss ⇒ cast esquivado)
    const seen = new Set<number>();
    let pureCastDodges = 0;
    for (let i = 0; i < 1000; i++) {
      A.mp = A.maxMp; // MP cheio → A sempre pode castar (sujeito a GCD/cooldown)
      B.hp = B.maxHp; // HP cheio → B não morre, o duelo não acaba, B segue alvo válido
      sim.sendCommandFor(a, { t: 'move', dx: B.x - A.x, dz: B.z - A.z });
      sim.sendCommandFor(a, { t: 'set-target', id: b });
      sim.sendCommandFor(a, { t: 'use-ability', slot: 1 }); // strong_strike: slow + dot on hit (sem chance)
      const expiryBefore = maxExpiry(B);
      sim.step();
      let missed = false, tookDamage = false;
      for (const ev of sim.recentEvents()) {
        if (seen.has(ev.seq)) continue;
        seen.add(ev.seq);
        if (ev.targetId !== b) continue;
        if (ev.kind === 'miss') missed = true;
        else if (ev.kind === 'damage') tookDamage = true;
      }
      // Esquiva pura de B (esquivou o cast, nada conectou): nenhum debuff pôde ser aplicado/refrescado → o
      // maior expiresAt só fica igual ou cai. A mutação (applyCastEffects gateado só por hp>0) refrescaria
      // slow+dot aqui numa esquiva → expiresAt SOBE, e o teste pega (determinístico: strong_strike não tem chance).
      if (missed && !tookDamage) {
        pureCastDodges++;
        expect(maxExpiry(B)).toBeLessThanOrEqual(expiryBefore);
      }
    }
    expect(pureCastDodges).toBeGreaterThan(0); // uma esquiva de cast de fato ocorreu
  });

  it('um DoT (sangramento) NÃO é esquivável: cada tick conecta mesmo com parry alto', () => {
    const sim = new Sim(10);
    for (const it of LEATHER5) equip(sim, it); // couro (sem reqLevel) → parry 15
    const p = player(sim);
    expect(p.parry).toBe(15);
    // Aplica um sangramento direto (magnitude 5/tick) no player parado em segurança — a ÚNICA fonte de dano.
    p.effects.push({ kind: 'dot', expiresAt: sim.tick + 40, magnitude: 5, period: 1, nextAt: sim.tick + 1, source: 0 });
    const hpBefore = p.hp;
    const seen = new Set<number>();
    let misses = 0;
    for (let i = 0; i < 25; i++) {
      sim.step();
      for (const ev of sim.recentEvents()) {
        if (seen.has(ev.seq)) continue;
        seen.add(ev.seq);
        if (ev.kind === 'miss') misses++;
      }
    }
    expect(misses).toBe(0); // o DoT jamais gera uma esquiva (dodgeable=false)
    expect(player(sim).hp).toBeLessThan(hpBefore); // e o dano do sangramento de fato acontece
  });
});
