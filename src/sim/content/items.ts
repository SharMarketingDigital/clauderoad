// Data-as-code item definitions. The bag stores item ids; the UI resolves names
// through ITEMS via IWorld. Equippable items carry a `slot` and `stats` that the
// sim sums onto the character while equipped (see recomputeStats in sim.ts).
import type { EquipSlot, MasteryId } from '../../world_api';

// Flat bonuses an equipped item grants. Provisional numbers — tune later.
export interface ItemStats {
  weaponDamage?: number;
  str?: number;
  maxHp?: number;
  maxMp?: number;
  // Defensive stats (K3). Physical/magical defense granted while equipped; the sim scales
  // them by rarity, "+N" and durability and folds them onto Entity.phyDef/magDef in
  // recomputeStats, exactly like the offensive stats above. Combat does NOT read them yet —
  // Gabriel's mitigate() will (physical hit reduced by phyDef; magical by the Int magic-resist
  // PLUS magDef). Silkroad: every armor piece carries both. Provisional integers — tune later.
  phyDef?: number;
  magDef?: number;
}

// What a consumable restores when used from the bag. The use/heal path is fully
// generic, so a new consumable's EFFECT is just another ITEMS entry (e.g. a Mana
// Potion: consumable: { healMp: N }) with no sim changes. (To make it actually
// DROP, add it to a content drop table too — still data-as-code.)
export interface ConsumableEffect {
  healHp?: number; // restore up to this much HP (clamped to maxHp)
  healMp?: number; // restore up to this much MP (clamped to maxMp) — for a future Mana Potion
  // Sistema 2 (respec, fiel ao "reset scope 1828" do Silkroad): usar devolve TODO o SP gasto acima do
  // rank 1 e zera os ranks de skill. Maestria = arma equipada, então NÃO há reset de maestria (corte
  // consciente). Não cura; ignora o cooldown de poção; recusa (sem consumir) se nada foi investido.
  resetSkills?: boolean;
  // Sistema 15 (QoL): recall como item consumível (fiel aos ITEM_ETC_SCROLL_RETURN_* / REVERSE do Silkroad).
  // 'registered' = teleporta pra CIDADE de retorno registrada (como o Return grátis, mas o item é o custo,
  // sem o cooldown de 120s). 'lastSpot' (Fatia 2) = volta ao ponto de campo anterior. Bloqueado em combate
  // (não é botão de fuga); instantâneo (sem warm-up — corte consciente).
  recall?: 'registered' | 'lastSpot';
}

export interface ItemDef {
  id: string;
  name: string;
  slot?: EquipSlot; // present => equippable (into this slot)
  mastery?: MasteryId; // weapons only: which mastery (kit + passive) this weapon activates
  stats?: ItemStats; // bonuses applied while equipped
  consumable?: ConsumableEffect; // present => usable from the bag for this effect
  value?: number; // base gold value; the vendor pays this (rarity-scaled) on a sale
  // --- K2 degrees (graus por faixa de nível) — campos INTRÍNSECOS à definição do item ---
  degree?: number; // grau do equipamento (1..N); ausente => grau 1 (linha base legada)
  reqLevel?: number; // nível mínimo p/ EQUIPAR; ausente => derivado do grau (degrees.ts), senão 0
  // Sistema Fase 3 (Hit × Parry, Fatia 2 — Block): chance (0..1) de BLOQUEAR um golpe que conectou —
  // exclusiva de ESCUDOS (SRO: Block Ratio %, cols 74–78 do escudo). Intrínseca ao item (como degree), FLAT:
  // NÃO escala por raridade/+N/durabilidade. Ausente/0 => sem block. O par do parry: leve esquiva, pesado bloqueia.
  blockRatio?: number;
  // Sistema 4 (Set items): a que CONJUNTO esta peça pertence (id em content/sets.ts). Intrínseco à def (como
  // degree) — não toca save/hash. N peças do mesmo setId equipadas -> o bônus de conjunto (2/3/4). Só armadura.
  setId?: string;
}

export const ITEMS: Record<string, ItemDef> = {
  // consumable: heals ~40% of the 120-HP starter, à la a WoW Classic minor healing potion
  health_potion: { id: 'health_potion', name: 'Poção de Vida', consumable: { healHp: 50 }, value: 10 },
  // mana counterpart (Silkroad-style): the caster's burst refill, alongside the slow out-of-combat
  // MP regen. Same generic consume path (healMp), shared potion cooldown — no sim changes needed.
  mana_potion: { id: 'mana_potion', name: 'Poção de Mana', consumable: { healMp: 50 }, value: 10 },
  // crude leather "armor" — common drop, gives a little HP
  wolf_leather: { id: 'wolf_leather', name: 'Couro de Lobo', slot: 'chest', stats: { maxHp: 20, phyDef: 2, magDef: 1 }, setId: 'leather', value: 8 },
  // K1 added the rest of the Silkroad armor set + shield + accessories (str/maxHp/maxMp).
  // K3 then added phyDef/magDef to the PROTECTIVE pieces (helmet/chest/hands/legs/feet/shield);
  // accessories & weapons carry no defense, à la Silkroad. Per-piece weight chest>legs>helmet>
  // hands~feet; the shield is balanced. Provisional integers on the wolf_leather scale — tune later.
  leather_cap: { id: 'leather_cap', name: 'Gorro de Couro', slot: 'helmet', stats: { maxHp: 12, phyDef: 1, magDef: 1 }, setId: 'leather', value: 6 },
  leather_gloves: { id: 'leather_gloves', name: 'Luvas de Couro', slot: 'hands', stats: { maxHp: 8, phyDef: 1, magDef: 1 }, setId: 'leather', value: 5 },
  leather_pants: { id: 'leather_pants', name: 'Calças de Couro', slot: 'legs', stats: { maxHp: 14, phyDef: 2, magDef: 1 }, setId: 'leather', value: 7 },
  leather_boots: { id: 'leather_boots', name: 'Botas de Couro', slot: 'feet', stats: { maxHp: 8, phyDef: 1, magDef: 1 }, setId: 'leather', value: 5 },
  wooden_shield: { id: 'wooden_shield', name: 'Escudo de Madeira', slot: 'shield', blockRatio: 0.10, stats: { maxHp: 18, phyDef: 2, magDef: 2 }, value: 10 },
  copper_necklace: { id: 'copper_necklace', name: 'Colar de Cobre', slot: 'necklace', stats: { maxMp: 12 }, value: 12 },
  copper_earring: { id: 'copper_earring', name: 'Brinco de Cobre', slot: 'earring', stats: { str: 1 }, value: 12 },
  copper_ring: { id: 'copper_ring', name: 'Anel de Cobre', slot: 'ring', stats: { str: 1 }, value: 12 },
  // the starter weapon upgrade: a big chunk of weapon damage over bare fists
  old_sword: { id: 'old_sword', name: 'Espada Velha', slot: 'weapon', mastery: 'sword', stats: { weaponDamage: 10 }, value: 30 },
  // a reach weapon: switches the character to the Lança mastery (area + crit kit)
  iron_spear: { id: 'iron_spear', name: 'Lança de Ferro', slot: 'weapon', mastery: 'spear', stats: { weaponDamage: 12 }, value: 45 },
  // a ranged weapon: switches to the Arco mastery (shoot from afar, kite, crit)
  short_bow: { id: 'short_bow', name: 'Arco Curto', slot: 'weapon', mastery: 'bow', stats: { weaponDamage: 8 }, value: 50 },
  // a magical weapon: switches to the Mago mastery (ranged MAGICAL damage scaling with Int)
  apprentice_staff: { id: 'apprentice_staff', name: 'Cajado de Aprendiz', slot: 'weapon', mastery: 'mage', stats: { weaponDamage: 9 }, value: 55 },
  // --- K2 degrees: armas de 2º/3º grau por maestria (D1 = a arma base acima). Os stats já
  // vêm "baked" = base.weaponDamage * DEGREES[grau].statMult (1.4 / 1.8), arredondado; o sim
  // nunca lê statMult em runtime (degrees.ts). reqLevel vem da faixa do grau (D2=4, D3=8) e o
  // equipar é gated por nível (ver Sim.equip). Só ARMAS nesta leva (slot 'weapon' não colide
  // com a expansão de slots do K1; armadura defensiva é escopo do K3).
  // Espada (base old_sword, wd 10)
  iron_sword:     { id: 'iron_sword',     name: 'Espada de Ferro (2º Grau)',      slot: 'weapon', mastery: 'sword', degree: 2, reqLevel: 4, stats: { weaponDamage: 14 }, value: 60 },
  steel_sword:    { id: 'steel_sword',    name: 'Espada de Aço (3º Grau)',        slot: 'weapon', mastery: 'sword', degree: 3, reqLevel: 8, stats: { weaponDamage: 18 }, value: 110 },
  // Lança (base iron_spear, wd 12)
  steel_spear:    { id: 'steel_spear',    name: 'Lança de Aço (2º Grau)',         slot: 'weapon', mastery: 'spear', degree: 2, reqLevel: 4, stats: { weaponDamage: 17 }, value: 90 },
  halberd:        { id: 'halberd',        name: 'Alabarda (3º Grau)',             slot: 'weapon', mastery: 'spear', degree: 3, reqLevel: 8, stats: { weaponDamage: 22 }, value: 160 },
  // Arco (base short_bow, wd 8)
  hunters_bow:    { id: 'hunters_bow',    name: 'Arco de Caçador (2º Grau)',      slot: 'weapon', mastery: 'bow',   degree: 2, reqLevel: 4, stats: { weaponDamage: 11 }, value: 100 },
  composite_bow:  { id: 'composite_bow',  name: 'Arco Composto (3º Grau)',        slot: 'weapon', mastery: 'bow',   degree: 3, reqLevel: 8, stats: { weaponDamage: 14 }, value: 175 },
  // Cajado / Mago (base apprentice_staff, wd 9) — dano mágico escala com Int + weaponDamage
  adept_staff:    { id: 'adept_staff',    name: 'Cajado de Adepto (2º Grau)',     slot: 'weapon', mastery: 'mage',  degree: 2, reqLevel: 4, stats: { weaponDamage: 13 }, value: 110 },
  sorcerer_staff: { id: 'sorcerer_staff', name: 'Cajado de Feiticeiro (3º Grau)', slot: 'weapon', mastery: 'mage',  degree: 3, reqLevel: 8, stats: { weaponDamage: 16 }, value: 190 },
  // --- Sistema 3 (gear-por-mob): escada de ARMADURA + ACESSÓRIO de 2º/3º grau, espelhando a escada de
  // armas acima. Stats baked = round(base × DEGREES[grau].statMult) (1.4 / 1.8); o sim nunca lê statMult
  // em runtime (degrees.ts). reqLevel pela faixa do grau (D2=4, D3=8); equipar é gated por nível.
  // Material: couro(g1) → malha(g2) → placas(g3); cobre(g1) → prata(g2) → ouro(g3). NOTA: brinco/anel
  // sobem str 1→2→3 (não round(1×1.4)=1), senão o g2 sairia idêntico ao g1 mas com reqLevel maior = item
  // dominado. Armadura defensiva e colar seguem round(base×statMult) (ladderiam bem nos números maiores).
  // helmet (base leather_cap: maxHp 12 / phyDef 1 / magDef 1)
  studded_cap:     { id: 'studded_cap',     name: 'Elmo Rebitado (2º Grau)',      slot: 'helmet',   degree: 2, reqLevel: 4, stats: { maxHp: 17, phyDef: 1, magDef: 1 }, setId: 'chain', value: 12 },
  plate_helm:      { id: 'plate_helm',      name: 'Elmo de Placas (3º Grau)',     slot: 'helmet',   degree: 3, reqLevel: 8, stats: { maxHp: 22, phyDef: 2, magDef: 2 }, setId: 'plate', value: 21 },
  // chest (base wolf_leather: maxHp 20 / phyDef 2 / magDef 1)
  chain_vest:      { id: 'chain_vest',      name: 'Cota de Malha (2º Grau)',      slot: 'chest',    degree: 2, reqLevel: 4, stats: { maxHp: 28, phyDef: 3, magDef: 1 }, setId: 'chain', value: 16 },
  plate_armor:     { id: 'plate_armor',     name: 'Armadura de Placas (3º Grau)', slot: 'chest',    degree: 3, reqLevel: 8, stats: { maxHp: 36, phyDef: 4, magDef: 2 }, setId: 'plate', value: 28 },
  // hands (base leather_gloves: maxHp 8 / phyDef 1 / magDef 1)
  chain_gloves:    { id: 'chain_gloves',    name: 'Manoplas de Malha (2º Grau)',  slot: 'hands',    degree: 2, reqLevel: 4, stats: { maxHp: 11, phyDef: 1, magDef: 1 }, setId: 'chain', value: 10 },
  plate_gauntlets: { id: 'plate_gauntlets', name: 'Manoplas de Placas (3º Grau)', slot: 'hands',    degree: 3, reqLevel: 8, stats: { maxHp: 14, phyDef: 2, magDef: 2 }, setId: 'plate', value: 18 },
  // legs (base leather_pants: maxHp 14 / phyDef 2 / magDef 1)
  chain_leggings:  { id: 'chain_leggings',  name: 'Grevas de Malha (2º Grau)',    slot: 'legs',     degree: 2, reqLevel: 4, stats: { maxHp: 20, phyDef: 3, magDef: 1 }, setId: 'chain', value: 14 },
  plate_legs:      { id: 'plate_legs',      name: 'Grevas de Placas (3º Grau)',   slot: 'legs',     degree: 3, reqLevel: 8, stats: { maxHp: 25, phyDef: 4, magDef: 2 }, setId: 'plate', value: 25 },
  // feet (base leather_boots: maxHp 8 / phyDef 1 / magDef 1)
  chain_boots:     { id: 'chain_boots',     name: 'Botas de Malha (2º Grau)',     slot: 'feet',     degree: 2, reqLevel: 4, stats: { maxHp: 11, phyDef: 1, magDef: 1 }, setId: 'chain', value: 10 },
  plate_boots:     { id: 'plate_boots',     name: 'Botas de Placas (3º Grau)',    slot: 'feet',     degree: 3, reqLevel: 8, stats: { maxHp: 14, phyDef: 2, magDef: 2 }, setId: 'plate', value: 18 },
  // shield (base wooden_shield: maxHp 18 / phyDef 2 / magDef 2)
  iron_shield:     { id: 'iron_shield',     name: 'Escudo de Ferro (2º Grau)',    slot: 'shield',   degree: 2, reqLevel: 4, blockRatio: 0.15, stats: { maxHp: 25, phyDef: 3, magDef: 3 }, value: 20 },
  tower_shield:    { id: 'tower_shield',    name: 'Escudo Torre (3º Grau)',       slot: 'shield',   degree: 3, reqLevel: 8, blockRatio: 0.20, stats: { maxHp: 32, phyDef: 4, magDef: 4 }, value: 35 },
  // necklace (base copper_necklace: maxMp 12)
  silver_necklace: { id: 'silver_necklace', name: 'Colar de Prata (2º Grau)',     slot: 'necklace', degree: 2, reqLevel: 4, stats: { maxMp: 17 }, value: 24 },
  gold_necklace:   { id: 'gold_necklace',   name: 'Colar de Ouro (3º Grau)',      slot: 'necklace', degree: 3, reqLevel: 8, stats: { maxMp: 22 }, value: 42 },
  // earring (base copper_earring: str 1) — str 1→2→3 (ver nota acima)
  silver_earring:  { id: 'silver_earring',  name: 'Brinco de Prata (2º Grau)',    slot: 'earring',  degree: 2, reqLevel: 4, stats: { str: 2 }, value: 24 },
  gold_earring:    { id: 'gold_earring',    name: 'Brinco de Ouro (3º Grau)',     slot: 'earring',  degree: 3, reqLevel: 8, stats: { str: 3 }, value: 42 },
  // ring (base copper_ring: str 1) — str 1→2→3
  silver_ring:     { id: 'silver_ring',     name: 'Anel de Prata (2º Grau)',      slot: 'ring',     degree: 2, reqLevel: 4, stats: { str: 2 }, value: 24 },
  gold_ring:       { id: 'gold_ring',       name: 'Anel de Ouro (3º Grau)',       slot: 'ring',     degree: 3, reqLevel: 8, stats: { str: 3 }, value: 42 },
  // alchemy materials (no rarity; consumed to attempt a "+N" upgrade)
  elixir_weapon: { id: 'elixir_weapon', name: 'Elixir de Arma', value: 15 },
  elixir_armor: { id: 'elixir_armor', name: 'Elixir de Armadura', value: 15 },
  // K4: alchemy safety net — held + the enhance "useProtection" flag prevents a break and
  // caps the drop to the floor. A plain material (the flag drives it, not an item field), à
  // la the elixirs (no consumable effect).
  protect_stone: { id: 'protect_stone', name: 'Pedra de Proteção', value: 30 },
  // Sistema 3 (magic stones): a Pedra Astral — soca/sobe UMA linha azul num item equipado (a alquimia de
  // atributo). Material simples (o comando enhance-blue a consome), à la os elixires; sem efeito consumable.
  magic_stone: { id: 'magic_stone', name: 'Pedra Astral', value: 30 },
  // Sistema 2 (respec): o pergaminho de reinício de perícias — consumível vendido pelo alquimista. Usar
  // devolve todo o SP investido e zera os ranks, pra re-alocar a build. Análogo fiel ao item de reset do
  // Silkroad (escopo 1828). Preço na loja (vendor.ts) é o "custo" do respec.
  skill_reset: { id: 'skill_reset', name: 'Pergaminho de Reinício', consumable: { resetSkills: true }, value: 60 },
  // Sistema 15 (QoL): pergaminho de retorno — recall à cidade registrada, consumível. Barato (o Return
  // grátis já existe com cooldown; o scroll troca o cooldown pelo custo do item). Vendido pelo boticário.
  return_scroll: { id: 'return_scroll', name: 'Pergaminho de Retorno', consumable: { recall: 'registered' }, value: 15 },
  // Sistema 15 (QoL): pergaminho de reverso — volta ao ponto de campo anterior (antes do último recall à
  // cidade). Útil pra voltar ao grind depois de dar um pulo na cidade. Consumível, vendido pelo boticário.
  reverse_scroll: { id: 'reverse_scroll', name: 'Pergaminho de Reverso', consumable: { recall: 'lastSpot' }, value: 15 },
  // GDD v0.5 (Pets): the grab pet — a PERMANENT companion bought from the vendor. Holding the item IS
  // owning the pet; summoning it (tecla P) spawns a follower that auto-collects ground loot. Not
  // equippable/consumable — a plain ownership token kept in the bag (like a Silkroad pet card).
  pet_grab: { id: 'pet_grab', name: 'Coletor (Pet)', value: 60 },
  // Sistema 15 (QoL): token de invocação da montaria — comprado uma vez (permanente, como o pet_grab).
  // Segurá-lo = possuir o cavalo; montar/desmontar com a tecla. Não equipável/consumível (a stat de
  // velocidade vive em content/mounts.ts). Corte consciente: sem HP/duração/aluguel no MVP.
  mount_horse: { id: 'mount_horse', name: 'Cavalo (Montaria)', value: 60 },
};

// Shared cooldown between consumable uses (seconds) — classic "potion sickness",
// so they can't be spammed. The Sim converts this to ticks.
export const POTION_COOLDOWN_SECS = 5;
