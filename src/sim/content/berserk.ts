// Sistema 2 (Berserk/Hwan) — dados da barra de fúria (data-as-code, sem lógica).
//
// A barra (`Entity.berserkGauge`, 0..BERSERK_MAX) enche por PARTICIPAÇÃO em combate — cada golpe DADO ou
// LEVADO adiciona uma fração — e DECAI fora de combate (o burst não se acumula parado). Quando cheia o
// bastante, ativa um burst temporário por NÍVEIS (a curva de níveis — dano/haste/crit/duração — chega na
// Fatia 3). Fiel ao Silkroad na estrutura (barra que enche lutando → ult sem custo de MP); os números são
// 🧠 dimensionados pro nosso teto (cap ~10, kit enxuto). Tunar por playtest.

export const BERSERK_MAX = 100; // a barra cheia
export const BERSERK_PER_HIT = 4; // sobe por golpe DADO ou LEVADO em combate (~13 trocas de golpe p/ encher)
export const BERSERK_DECAY = 20; // cai por SEGUNDO fora de combate (barra cheia esvazia em ~5 s após o lull do combate)

// A curva do burst, 3 níveis (comprimida dos 6 do Silkroad — corte consciente pro nosso teto de ~10). Ativar
// aplica um buff temporário MULTI-EIXO: dano de saída (damageMult, o eixo da Fatia 1), velocidade de ataque
// (haste), e chance de crit (reusa o buff 'crit' da Fúria). As magnitudes são o +FRAÇÃO (0.20 => ×1.20 /
// +8% crit). Curva 🧠 dimensionada mantendo "N3 ≈ 2× o impacto do N1". Corte: o bônus de HP/MP-máx do Hwan
// clássico + o eixo defesa (ficamos nos 3 eixos com gancho pronto). Tunar por playtest (o rebalance reusa isto).
export interface BerserkLevelDef {
  damageMult: number; // +fração de dano de saída (magnitude do status 'berserk')
  haste: number; // +fração de velocidade de ataque (magnitude do status 'haste')
  crit: number; // +chance de crit 0..1 (magnitude do status 'crit')
  durationSecs: number; // duração do burst
}
export const BERSERK_LEVELS: readonly BerserkLevelDef[] = [
  { damageMult: 0.20, haste: 0.10, crit: 0.08, durationSecs: 10 }, // nível 1 (fraco)  — ×1.20 / ×1.10 / +8%
  { damageMult: 0.45, haste: 0.18, crit: 0.14, durationSecs: 12 }, // nível 2 (médio)  — ×1.45 / ×1.18 / +14%
  { damageMult: 0.80, haste: 0.25, crit: 0.20, durationSecs: 15 }, // nível 3 (forte)  — ×1.80 / ×1.25 / +20%
];

// Deriva o NÍVEL (1..3) do quão cheia está a barra: >=100% -> 3, >=66% -> 2, >=33% -> 1; abaixo -> 0 (não
// ativa — dá pra gastar cedo num nível baixo ou "segurar" pra subir de degrau, fiel ao Silkroad).
export function berserkLevel(gauge: number): number {
  const frac = gauge / BERSERK_MAX;
  if (frac >= 1) return 3;
  if (frac >= 0.66) return 2;
  if (frac >= 0.33) return 1;
  return 0;
}
