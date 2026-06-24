// Graus de equipamento (degrees) — GDD v0.3 §K2 (frente Kevin: itens & inventário).
//
// Um "grau" é uma FAIXA de poder do equipamento atrelada a uma faixa de nível: cada grau
// é mais forte que o anterior e exige um nível mínimo para EQUIPAR. O grau é INTRÍNSECO à
// DEFINIÇÃO do item (ITEMS em ./items), nunca à instância equipada (EquippedItem) nem ao
// stack salvo — então o save, o hash determinístico e a serialização NÃO mudam por causa
// dos graus.
//
// reqLevel ANCORADO nas faixas de zona reais (src/sim/zones.ts: levels 1/2/4/10). Silkroad
// usa ~8-10 níveis por grau (REF-silkroad §5: "1° a 11°+"); aqui a curva é COMPRIMIDA ao
// cap atual de nível 10. NÃO colocamos o grau-topo no cap (deixamos headroom): D3 fica em
// reqLevel 8, abaixo de ring10 (nível 10). Mais graus dependem da expansão de zonas/cap do
// Gabriel (GDD §1.1) — não é decisão livre desta frente.
//
// statMult é METADADO DE AUTORIA APENAS: já vem pré-calculado (baked) no campo `stats` de
// cada item com grau. O SIM NUNCA lê statMult em runtime — recomputeStats e botGearScore
// leem ITEMS[id].stats verbatim. Por isso nenhum Rng/clock entra aqui e o determinismo é
// preservado. O teto COMBINADO (degree × rarity × +N) foi acordado com o Gabriel (dono de
// combate): com statMult máx 1.8, o pior caso de uma arma D3/SUN/+10 fica ~106 de
// weaponDamage (≈1.8× o teto atual ~58), dentro da curva de HP de mob (levelHpMult).
//
// NOTA (gate é action-only): meetsLevelReq é checado na AÇÃO de equipar (ver Sim.equip),
// nunca no restore do save — um item já equipado num save não é revalidado/removido no
// load. Endurecer isso (Leva futura) tocaria save.ts; fora do escopo do K2.
import type { ItemDef } from './items';

export interface DegreeDef {
  degree: number; // 1..N (1 = a linha base, itens legados sem `degree`)
  name: string; // rótulo de exibição ("1º Grau")
  reqLevel: number; // nível mínimo para equipar um item deste grau
  statMult: number; // AUTORIA APENAS: fator já aplicado aos `stats` do item (o sim nunca lê)
}

// Os graus da Leva 1. reqLevel 1/4/8 (pisos de ring1/ring4 e abaixo do cap=10);
// statMult 1.0/1.4/1.8 (teto 1.8 acordado com o combate).
export const DEGREES: readonly DegreeDef[] = [
  { degree: 1, name: '1º Grau', reqLevel: 1, statMult: 1.0 },
  { degree: 2, name: '2º Grau', reqLevel: 4, statMult: 1.4 },
  { degree: 3, name: '3º Grau', reqLevel: 8, statMult: 1.8 },
];

// O grau de um item (default 1 = linha base, para itens legados sem `degree`).
export function degreeOf(def: ItemDef): number {
  return def.degree ?? 1;
}

// Procura a definição de um grau pelo número (undefined se não existir).
export function degreeDef(degree: number): DegreeDef | undefined {
  return DEGREES.find((d) => d.degree === degree);
}

// O nível mínimo para EQUIPAR um item. Preferimos o reqLevel explícito; senão derivamos da
// faixa do grau do item; itens sem grau/reqLevel (legados) => 0 (sem requisito de nível).
export function equipLevelReq(def: ItemDef): number {
  if (def.reqLevel != null) return def.reqLevel;
  if (def.degree != null) return degreeDef(def.degree)?.reqLevel ?? 0;
  return 0;
}

// O personagem (de nível `level`) cumpre o requisito para equipar este item? Comparação
// PURA — sem Rng/clock — então é determinística e inerte para itens legados (req 0).
export function meetsLevelReq(def: ItemDef, level: number): boolean {
  return level >= equipLevelReq(def);
}
