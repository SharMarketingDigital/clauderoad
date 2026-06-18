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
