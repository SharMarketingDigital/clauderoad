// Data-as-code item rarities, common -> rarest (Silkroad SOS/SOM/SUN flavor).
// `dropWeight` is the lucky-drop probability for the tier (sums to 1; the sim
// rolls it via Rng). `statMultiplier` scales an equipped item's bonuses, so a
// rarer version of the same item is stronger. Provisional — tune later.
import type { Rarity } from '../../world_api';

export interface RarityDef {
  id: Rarity;
  name: string;
  dropWeight: number;
  statMultiplier: number;
}

export const RARITIES: RarityDef[] = [
  { id: 'normal', name: 'Normal', dropWeight: 0.9, statMultiplier: 1.0 },
  { id: 'sos', name: 'SOS', dropWeight: 0.08, statMultiplier: 1.5 }, // uncommon
  { id: 'som', name: 'SOM', dropWeight: 0.018, statMultiplier: 2.0 }, // rare
  { id: 'sun', name: 'SUN', dropWeight: 0.002, statMultiplier: 3.0 }, // very rare
];
