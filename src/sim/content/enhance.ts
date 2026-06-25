// Data-as-code tuning for alchemy "+N" enhancement (Silkroad-style, but GENTLE
// per the GDD). The roll/calc logic lives in sim.ts; these are just numbers.
export const MAX_PLUS = 10; // hard cap

// Success chance for an attempt from `plus` -> plus+1 (index = current plus,
// 0..9). Easy through +3, then steadily harder toward the cap. Provisional —
// kinder than real Silkroad (which is brutal on purpose). Tune later.
export const ENHANCE_SUCCESS = [0.95, 0.92, 0.88, 0.72, 0.58, 0.46, 0.36, 0.27, 0.19, 0.12];

export const LUCKY_POWDER_BONUS = 0.15; // additive success chance from a Lucky Powder
export const ENHANCE_CHANCE_CAP = 0.95; // a Lucky Powder can't push a roll above this

// Each "+" adds this fraction of the (rarity-scaled) stat. +10 => +100%.
export const ENHANCE_STAT_PER_PLUS = 0.1;

// ---- K4: alquimia com risco real (provisional; tune later) ----
// At/above RISK_FLOOR a FAILED attempt can BREAK the item or drop multiple "+"; below it a
// failure stays the gentle -1, so early game and the low-"+" tests are unchanged.
export const RISK_FLOOR = 4;
// Break chance ON A FAILURE, index = current plus (0..9); 0 below RISK_FLOOR. Rises toward
// the cap — Silkroad's late brutality, but kinder and tunable.
export const BREAK_CHANCE = [0, 0, 0, 0, 0.05, 0.1, 0.18, 0.28, 0.4, 0.55];
// "+" levels lost ON A FAILURE that does NOT break, index = current plus (0..9).
export const DROP_ON_FAIL = [1, 1, 1, 1, 1, 2, 2, 3, 3, 4];
// A Pedra de Proteção caps a failure's drop to this and prevents the break (the "piso").
export const PROTECT_DROP_CAP = 1;
// The alchemy protection material's item id (its ITEMS entry lives in content/items.ts).
export const PROTECT_STONE_ID = 'protect_stone';
