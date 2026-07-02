// Sistema 3 (Magic Options / "azuis") — o catálogo data-as-code + os helpers PUROS que o sim usa.
//
// Um item pode carregar LINHAS AZUIS extras (str/hp/def…), cada uma com um opt-level próprio. Diferente da
// raridade e do "+N" (multiplicadores escalares sobre os brancos), o azul é FLAT: a magnitude é perLevel ×
// level, direto (o opt-level JÁ é a magnitude, como no Silkroad). Cortes conscientes (ver docs/05): sem a
// matriz de ~72 resistências (fica 1 azul 'resist' genérico numa fatia futura), sem sets/avatares/3-job/
// mercado-de-stones; crit-azul + as magic stones (alquimia) vêm nas fatias seguintes.
import type { EquipSlot, Rarity } from '../../world_api';
import type { Rng } from '../rng';

// As linhas azuis que um item pode carregar. Cada uma vira +stat FLAT via recomputeStats. (crit/luck/resist
// entram em fatias futuras — a Fatia 1 é a fundação com os stats que já têm acumulador no recomputeStats.)
export type BlueId = 'str' | 'hp' | 'mp' | 'phyDef' | 'magDef';

// Uma linha azul rolada num item: qual azul + seu opt-level (1..maxLevel). Guardada no ItemStack/EquippedItem.
export interface BlueLine {
  id: BlueId;
  level: number;
}

export interface BlueDef {
  id: BlueId;
  name: string;
  perLevel: number; // magnitude por opt-level (o "fator" do ref data); FLAT, não escala por raridade/+N
  maxLevel: number; // teto de opt-level (também gated pelo grau do item no drop)
  slots: readonly EquipSlot[]; // onde o azul é válido (o análogo enxuto do refmagicoptgroup)
}

// Números 🧠 dimensionados (docs/05): STR/DEF fator 1, HP/MP em dezenas; teto de opt-level ~6 pro cap ~10.
// Tunar contra a curva de HP-de-mob × dano-g3 no rebalance (os azuis somam poder de gear).
const ARMOR: readonly EquipSlot[] = ['helmet', 'chest', 'hands', 'legs', 'feet', 'shield'];
const VITALS: readonly EquipSlot[] = ['chest', 'legs']; // HP/MP só em "mail/pants", como o SRO
const STR_SLOTS: readonly EquipSlot[] = ['helmet', 'chest', 'hands', 'legs', 'feet', 'shield', 'necklace', 'earring', 'ring'];

export const BLUES: Record<BlueId, BlueDef> = {
  str: { id: 'str', name: 'Força', perLevel: 1, maxLevel: 6, slots: STR_SLOTS },
  hp: { id: 'hp', name: 'Vida', perLevel: 8, maxLevel: 6, slots: VITALS },
  mp: { id: 'mp', name: 'Mana', perLevel: 6, maxLevel: 6, slots: VITALS },
  phyDef: { id: 'phyDef', name: 'Defesa Física', perLevel: 1, maxLevel: 6, slots: ARMOR },
  magDef: { id: 'magDef', name: 'Defesa Mágica', perLevel: 1, maxLevel: 6, slots: ARMOR },
};

export const MAX_BLUES = 3; // teto de linhas azuis por item (dimensionado ao cap ~10)

// A ordem estável de iteração do catálogo (Object.keys em ordem de inserção; fixada aqui pra o drop ser
// determinístico independentemente de mexidas futuras no literal acima).
const BLUE_ORDER: readonly BlueId[] = ['str', 'hp', 'mp', 'phyDef', 'magDef'];

// A magnitude FLAT de uma linha azul: perLevel × level (linear no opt-level, como o ref data).
export function blueAmount(b: BlueLine): number {
  return (BLUES[b.id]?.perLevel ?? 0) * b.level;
}

// ⭐ CHAVE DE STACK CANÔNICA — o ponto crítico do stacking-identity. Dois itens só empilham se tiverem
// EXATAMENTE os mesmos azuis (mesmos ids + levels). Ordem-independente (ordena as linhas) e vazio/undefined
// => "" (então itens SEM azul empilham como sempre — byte-idêntico ao mundo pré-azuis). Qualquer diferença
// nos azuis => chave diferente => stacks separados (nunca fundem itens distintos, nunca corrompem a bolsa).
export function bluesKey(blues?: readonly BlueLine[]): string {
  if (!blues || blues.length === 0) return '';
  return blues.map((b) => `${b.id}:${b.level}`).sort().join(',');
}

// Quantos azuis um item desse rarity rola no drop. NORMAL não saca RNG (retorna 0) — então um drop comum é
// byte-idêntico ao stream pré-azuis; só SoS+ sacam. SUN rola 2 ou 3 (1 saque). Fiel ao "0-2 campo / mais no SUN".
function blueCount(rng: Rng, rarity: Rarity): number {
  switch (rarity) {
    case 'sun': return 2 + Math.floor(rng.next() * 2); // 2 ou 3
    case 'som': return 2;
    case 'sos': return 1;
    default: return 0; // normal — NÃO saca RNG (drop comum byte-idêntico)
  }
}

// Rola as linhas azuis de um item no drop, DETERMINÍSTICO (só via o Rng passado). Escolhe N azuis DISTINTOS
// (sem id repetido) elegíveis pro slot; cada um com opt-level 1..min(maxLevel, grau×2) (o gate de progressão
// do ref data). N=0 (normal) => nenhum saque de RNG. Retorna [] se o slot não aceita nenhum azul (ex.: arma
// hoje — o azul de arma é crit, fatia futura).
export function rollBlues(rng: Rng, slot: EquipSlot, rarity: Rarity, degree: number): BlueLine[] {
  const n = Math.min(blueCount(rng, rarity), MAX_BLUES);
  if (n <= 0) return [];
  const pool = BLUE_ORDER.filter((id) => BLUES[id].slots.includes(slot));
  const out: BlueLine[] = [];
  for (let i = 0; i < n && pool.length > 0; i++) {
    const idx = Math.floor(rng.next() * pool.length);
    const id = pool.splice(idx, 1)[0]!; // remove p/ garantir DISTINTO (sem dois 'str' na mesma peça)
    const def = BLUES[id];
    const maxLvl = Math.min(def.maxLevel, Math.max(1, degree * 2));
    const level = 1 + Math.floor(rng.next() * maxLvl); // 1..maxLvl
    out.push({ id, level });
  }
  return out;
}

// Saneia os azuis vindos de um SAVE (possivelmente corrompido): mantém só linhas com id conhecido e level
// inteiro em [1, maxLevel]; corta duplicatas (mantém a 1ª) e o excesso além de MAX_BLUES. Nunca lança —
// entrada ruim vira [] (item sem azul), como o resto do save.ts. Retorna undefined se nada válido sobra.
export function sanitizeBlues(raw: unknown): BlueLine[] | undefined {
  if (!Array.isArray(raw)) return undefined;
  const out: BlueLine[] = [];
  const seen = new Set<BlueId>();
  for (const item of raw) {
    if (out.length >= MAX_BLUES) break;
    if (!item || typeof item !== 'object') continue;
    const id = (item as { id?: unknown }).id;
    const level = (item as { level?: unknown }).level;
    // hasOwnProperty (NÃO `id in BLUES`): o `in` anda pela cadeia de protótipo, então 'constructor'/'toString'/
    // '__proto__'/etc. passariam como id válido (→ BLUES[id].maxLevel undefined → level NaN → corrompe stacking/hash).
    if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(BLUES, id)) continue;
    if (typeof level !== 'number' || !Number.isInteger(level) || level < 1) continue;
    if (seen.has(id as BlueId)) continue;
    seen.add(id as BlueId);
    out.push({ id: id as BlueId, level: Math.min(level, BLUES[id as BlueId].maxLevel) });
  }
  return out.length > 0 ? out : undefined;
}
