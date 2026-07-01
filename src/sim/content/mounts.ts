// Data-as-code: montarias (Sistema 15 — QoL). Fiel aos ITEM_COS_T_* do Silkroad: o item é só um TOKEN de
// invocação; a "velocidade" é o único número que importa (no SRO vem de characterdata cols walk/run; nós
// guardamos UM speedMult relativo ao PLAYER_SPEED, já que nosso movimento tem uma velocidade só). A montaria
// é SÓ locomoção — DESMONTA ao entrar em combate (via combatUntil), como o vSRO clássico. speedMult na faixa
// clássica 1.3–1.7×. Puro/determinístico (só dado, sem lógica).
export interface MountDef {
  id: string;
  name: string;
  speedMult: number; // multiplicador da velocidade de movimento do player (1.0 = a pé)
  itemId: string; // o token de invocação no bag (comprado uma vez, permanente, como o pet)
  price: number; // preço na loja
}

export const MOUNTS: Record<string, MountDef> = {
  horse: { id: 'horse', name: 'Cavalo', speedMult: 1.5, itemId: 'mount_horse', price: 250 },
};

// O mount ativo de um player pelo id do TOKEN que ele possui (bag). Retorna undefined se o token é
// desconhecido. Usado no set-mount pra validar posse antes de montar.
export function mountByItem(itemId: string): MountDef | undefined {
  return Object.values(MOUNTS).find((m) => m.itemId === itemId);
}
