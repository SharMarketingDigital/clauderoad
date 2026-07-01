// Data-as-code: ouro ancorado ao NÍVEL do personagem, fiel à levelgold.txt do Silkroad (uma faixa
// [piso, teto] por nível). No SRO a curva é quase-reta e DEVAGAR de propósito — o dinheiro fica sempre
// ATRÁS da curva de poder (HP/XP explodem, o ouro anda linear). Reproduzimos a FORMA (piso ~+3.6/nível,
// teto ~+7.4/nível, teto ≈ 2.1× o piso), dimensionada ao nosso LEVEL_CAP=10 (L1 28/59 … L10 ~60/126,
// batendo os marcos reais lidos do dado). Serve de RÉGUA de tuning da economia + do bônus de ouro ao subir
// de nível. Puro/determinístico (sem Rng) — só aritmética por nível, então entra no hash via e.gold.

// Piso de ouro-base por nível (o "chão" da faixa da levelgold do SRO).
export function goldFloor(level: number): number {
  return 28 + Math.round(3.6 * (Math.max(1, level) - 1));
}

// Teto de ouro-base por nível (o "topo" da faixa; ~2.1× o piso, como no SRO).
export function goldCeil(level: number): number {
  return 59 + Math.round(7.4 * (Math.max(1, level) - 1));
}

// Bônus de ouro concedido ao ALCANÇAR `level` (marco de progressão). Usamos o PISO da faixa — o mais
// conservador, mantendo o ouro "atrás da curva de poder" como o SRO. É uma ADIÇÃO nossa (o SRO não dá bônus
// por marco de nível; a levelgold é a faixa de ouro-por-atividade), justificada como um beat de recompensa.
export function levelUpGold(level: number): number {
  return goldFloor(level);
}
