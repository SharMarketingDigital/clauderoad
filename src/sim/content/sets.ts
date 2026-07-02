// Sistema 4 (Set items) — o catálogo data-as-code dos CONJUNTOS de armadura + o helper puro do bônus por
// contagem de peças. Fiel ao docs/silkroad-map/06 (refsetitemgroup: bônus em 2/3/4 peças de armadura),
// com o corte MVP combinado: só HP/def FLAT (defensivo). Parry/block/crit de set ficam pós-rebalance
// (Sistema 5) — o eixo OFENSIVO não entra aqui pra não mexer no teto que a rebalance vai calibrar.
//
// Como plugam: cada peça carrega `setId` (intrínseco à ItemDef, como `degree` — não toca save/hash). O
// recomputeStats conta os slots equipados por setId e aplica o MAIOR limiar atingido (2/3/4), somando o
// bônus FLAT nos acumuladores de HP/def. Derivado do equipamento (já hasheado) e sem Rng -> determinístico.

// O bônus de set — SÓ os eixos defensivos do MVP. NÃO escala por raridade/+N (é um bloco fixo do conjunto).
export interface SetStats {
  maxHp?: number;
  phyDef?: number;
  magDef?: number;
}

// Um degrau de bônus: ao atingir `pieces` peças do conjunto, aplica `stats` (CUMULATIVO — o degrau já traz
// o bônus total daquela contagem, então "o maior limiar atingido" nunca soma degraus em duplicidade).
export interface SetBonusTier {
  pieces: number; // limiar (2, 3, 4)
  stats: SetStats; // bônus TOTAL nesse limiar
}

export interface SetDef {
  id: string;
  name: string;
  bonuses: readonly SetBonusTier[]; // ORDENADO por `pieces` crescente (setBonusFor conta com isso)
}

// Os 3 conjuntos de armadura — um por grau, 5 peças (elmo/peito/mãos/pernas/pés; escudo NÃO entra, fiel ao
// SR onde arma/escudo estão no grupo mas não carregam o par de bônus). Magnitudes ANCORADAS nos stats das
// peças (~meia-a-uma peça extra no 4/4), escalando por grau (~×1.5, como o statMult 1.0/1.4/1.8 dos graus).
export const SETS: Record<string, SetDef> = {
  leather: {
    id: 'leather', name: 'Couro', // g1 (leather_cap/wolf_leather/leather_gloves/leather_pants/leather_boots)
    bonuses: [
      { pieces: 2, stats: { maxHp: 20 } },
      { pieces: 3, stats: { maxHp: 20, phyDef: 3 } },
      { pieces: 4, stats: { maxHp: 20, phyDef: 3, magDef: 3 } },
    ],
  },
  chain: {
    id: 'chain', name: 'Malha', // g2 (studded_cap/chain_vest/chain_gloves/chain_leggings/chain_boots)
    bonuses: [
      { pieces: 2, stats: { maxHp: 30 } },
      { pieces: 3, stats: { maxHp: 30, phyDef: 4 } },
      { pieces: 4, stats: { maxHp: 30, phyDef: 4, magDef: 4 } },
    ],
  },
  plate: {
    id: 'plate', name: 'Placas', // g3 (plate_helm/plate_armor/plate_gauntlets/plate_legs/plate_boots)
    bonuses: [
      { pieces: 2, stats: { maxHp: 45 } },
      { pieces: 3, stats: { maxHp: 45, phyDef: 6 } },
      { pieces: 4, stats: { maxHp: 45, phyDef: 6, magDef: 6 } },
    ],
  },
};

// O bônus aplicável a `count` peças equipadas de `setId`: o MAIOR degrau cujo limiar `pieces <= count`, ou
// null se o set é desconhecido ou está incompleto (count < o menor limiar). Puro/determinístico. Como
// `bonuses` está ordenado crescente, o último degrau que passa é o maior atingido (sem duplicar degraus).
export function setBonusFor(setId: string, count: number): SetStats | null {
  const def = SETS[setId];
  if (!def) return null;
  let best: SetStats | null = null;
  for (const tier of def.bonuses) {
    if (count >= tier.pieces) best = tier.stats;
  }
  return best;
}
