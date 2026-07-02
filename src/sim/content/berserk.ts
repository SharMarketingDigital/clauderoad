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
