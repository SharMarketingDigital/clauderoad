// Armazém / banco da cidade (GDD §K5) — frente KEVIN. Lógica PURA de mover stacks entre a
// bolsa do jogador e o seu armazém persistente. Sem Rng/clock/DOM (puro, como inventory.ts;
// a pureza é auto-aplicada pelo guard estático em tests/sim.test.ts que globa src/sim/**).
//
// O armazém é POR JOGADOR: os itens vivem em Entity.storage e persistem em PlayerSave. O NPC
// do armazém na cidade é só o PONTO DE INTERAÇÃO (proximidade) — os itens são do jogador,
// não do NPC.
import type { ItemStack } from './types';
import type { Rarity } from '../world_api';
import { BAG_SLOTS, STORAGE_SLOTS, PETBAG_SLOTS, addToBag, removeFromBag } from './inventory';

// O NPC do armazém: um spot fixo na cidade, distinto do mercador em (10,6). (10,18) deixa as
// duas zonas de interação (raio 4 cada) MUTUAMENTE EXCLUSIVAS — distância 12 > 4+4 — então o
// jogador nunca está nas duas ao mesmo tempo.
export const WAREHOUSE_NAME = 'Armazém';
export const WAREHOUSE_SPAWN_X = 10;
export const WAREHOUSE_SPAWN_Z = 18;
export const WAREHOUSE_INTERACT_RANGE = 4; // unidades de mundo; precisa estar perto p/ usar
// Id de entidade RESERVADO para o NPC do armazém — fora da sequência de this.nextId, p/ que
// adicionar esse NPC NÃO desloque os ids que o addPlayer usa para posicionar jogadores em rede
// (manteria o mundo do servidor byte-idêntico). 1e9 está muito acima de qualquer nextId real.
export const WAREHOUSE_ENTITY_ID = 1_000_000_000;

// `arr` aceitaria (itemId,rarity,plus)? true se já há um stack CASÁVEL (cresce a qty) OU se há
// slot livre. ESPELHA exatamente addToBag (inventory.ts): um stack casável cresce mesmo com o
// array cheio, então checar-antes nunca rejeita um movimento que addToBag aceitaria.
export function canAccept(arr: (ItemStack | null)[], itemId: string, rarity: Rarity, plus: number, maxSlots: number): boolean {
  const matchable = arr.some((s) => s != null && s.itemId === itemId && s.rarity === rarity && s.plus === plus);
  // Há espaço se a lista ainda pode crescer (armazém compacto) OU se existe um hole (bag esparsa).
  const hasRoom = arr.length < maxSlots || arr.some((s) => s == null);
  return matchable || hasRoom;
}

// Move o STACK INTEIRO (a qty atual) da bolsa para o armazém. Put-back NÃO-destrutivo: se o
// armazém não aceitar, retorna false SEM tocar a bolsa (preserva ordem de inserção → preserva
// o hash numa recusa). Determinístico (puro).
export function depositStack(bag: (ItemStack | null)[], storage: (ItemStack | null)[], itemId: string, rarity: Rarity, plus: number): boolean {
  const stack = bag.find((s) => s != null && s.itemId === itemId && s.rarity === rarity && s.plus === plus);
  if (!stack) return false; // não possui esse stack
  if (!canAccept(storage, itemId, rarity, plus, STORAGE_SLOTS)) return false; // armazém cheio
  const qty = stack.qty;
  removeFromBag(bag, itemId, rarity, plus, qty);
  addToBag(storage, itemId, rarity, plus, qty, STORAGE_SLOTS);
  return true;
}

// Move o STACK INTEIRO do armazém para a bolsa. Espelho de depositStack (capacidade da bolsa).
export function withdrawStack(storage: (ItemStack | null)[], bag: (ItemStack | null)[], itemId: string, rarity: Rarity, plus: number): boolean {
  const stack = storage.find((s) => s != null && s.itemId === itemId && s.rarity === rarity && s.plus === plus);
  if (!stack) return false;
  if (!canAccept(bag, itemId, rarity, plus, BAG_SLOTS)) return false; // bolsa cheia
  const qty = stack.qty;
  removeFromBag(storage, itemId, rarity, plus, qty);
  addToBag(bag, itemId, rarity, plus, qty, BAG_SLOTS);
  return true;
}

// GDD v0.5 (Pets PET2): the TRANSPORT pet's portable bag — the SAME non-destructive two-array transfer as
// the warehouse, but capped at PETBAG_SLOTS and with NO NPC near-check (it travels with you while the pet
// is summoned). Pure/deterministic, like depositStack/withdrawStack.
export function depositToPet(bag: (ItemStack | null)[], petBag: (ItemStack | null)[], itemId: string, rarity: Rarity, plus: number): boolean {
  const stack = bag.find((s) => s != null && s.itemId === itemId && s.rarity === rarity && s.plus === plus);
  if (!stack) return false;
  if (!canAccept(petBag, itemId, rarity, plus, PETBAG_SLOTS)) return false; // pet bag full
  const qty = stack.qty;
  removeFromBag(bag, itemId, rarity, plus, qty);
  addToBag(petBag, itemId, rarity, plus, qty, PETBAG_SLOTS);
  return true;
}

export function withdrawFromPet(petBag: (ItemStack | null)[], bag: (ItemStack | null)[], itemId: string, rarity: Rarity, plus: number): boolean {
  const stack = petBag.find((s) => s != null && s.itemId === itemId && s.rarity === rarity && s.plus === plus);
  if (!stack) return false;
  if (!canAccept(bag, itemId, rarity, plus, BAG_SLOTS)) return false; // bag full
  const qty = stack.qty;
  removeFromBag(petBag, itemId, rarity, plus, qty);
  addToBag(bag, itemId, rarity, plus, qty, BAG_SLOTS);
  return true;
}
