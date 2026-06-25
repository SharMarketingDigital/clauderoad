// PvP duel state (Tier 1, fatia A1 — handshake consensual 1v1; SEM dano, isso é a A2). Espelha
// party.ts: um pequeno módulo de dados que o sim determinístico possui. Um duelo é um par simétrico
// de jogadores com um id estável, pra hashear/iterar deterministicamente (como as parties por id).
// Os dois ids são guardados com `a < b` (a forma canônica do par), então a ordem do par nunca
// depende de quem desafiou.
export interface Duel {
  readonly id: number;
  readonly a: number; // o menor dos dois ids de jogador
  readonly b: number; // o maior dos dois ids de jogador
}
