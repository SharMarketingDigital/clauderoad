// The ONLY seam between game logic and presentation.
//
// Offline: `Sim` implements IWorld directly.
// Online (future): `ClientWorld` implements IWorld by mirroring server snapshots.
//
// RULE: src/render/ and src/ui/ depend on IWorld, never on Sim/ClientWorld
// concretely. To add a feature, extend IWorld first, then implement it in
// every world (offline Sim, and later the online ClientWorld).

export type EntityKind = 'player' | 'enemy' | 'npc' | 'loot' | 'pet'; // 'loot' = pickup-able ground item; 'pet' = a player's companion (GDD v0.5)

// Equipment slots a character can fill. Defined here (the seam) so both the
// sim's item content and the UI agree on the set.
export type EquipSlot =
  | 'weapon'
  | 'shield'
  | 'helmet'
  | 'chest'
  | 'hands'
  | 'legs'
  | 'feet'
  | 'necklace'
  | 'earring'
  | 'ring';

// Item rarity, common -> rarest (Silkroad-style lucky drops). Defined at the
// seam so content, sim, and UI agree; the UI maps these to colors.
export type Rarity = 'normal' | 'sos' | 'som' | 'sun';

// Weapon mastery ("class") ids. The equipped weapon picks the active mastery
// (its kit + passive + auto-attack reach); unarmed falls back to Sword. Defined
// at the seam so weapon content, the sim, and the UI agree on the set.
export type MasteryId = 'sword' | 'spear' | 'bow' | 'mage';

// How a hit is typed: 'physical' scales with Strength (sword/spear/bow), 'magical'
// with Intelligence (the Mago's staff). The type drives BOTH which attribute
// generates the damage and which defense reduces it (armor vs Int magic-resist).
// Defined at the seam so content (masteries/abilities), the sim's combat, and the
// UI agree on the set.
export type DamageType = 'physical' | 'magical';

// Enemy strength tier. Most mobs are 'normal'; tougher 'champion'/'elite' tiers
// spawn occasionally with more HP/damage/reward and a bigger, distinct look.
// Defined at the seam so enemy content, the sim, and the renderer agree.
export type EnemyTierId = 'normal' | 'champion' | 'elite';

// Sistema 3 (Magic Options / "azuis"): uma linha azul que um item carrega — o id do bônus + seu opt-level.
// Definida no SEAM porque faz parte da IDENTIDADE do item: o Command a carrega para referenciar a STACK certa
// (dois itens com azuis diferentes são itens distintos) e o ItemStackView a expõe. O catálogo (magnitudes/
// slots) e os helpers vivem em src/sim/content/magic_options.ts (que importa estes tipos daqui).
export type BlueId = 'str' | 'hp' | 'mp' | 'phyDef' | 'magDef' | 'crit';
export interface BlueLine {
  id: BlueId;
  level: number;
}

// Status effect kinds. Debuffs: stun/knockdown (can't act), root (can't move),
// slow (moves/attacks slower), dot (damage over time). Buffs: defense (the caster
// takes reduced incoming damage — Sword's Postura Defensiva), crit (raised crit
// chance — Spear's Fúria). Defined at the seam so the sim, content and renderer
// agree; render shows a marker by kind.
// berserk (Sistema 2 — Hwan): raises OUTGOING damage (the burst's damage axis; magnitude = the +fraction,
// e.g. 0.20 => ×1.20). Read by the sim's attackFactor and passed as compute()'s damageMult. Mirror of the
// 'defense' buff but on dealt damage; the piece the offense side was missing.
// haste (Sistema 2 — Hwan): raises ATTACK SPEED (the burst's speed axis; magnitude = the +fraction, e.g.
// 0.10 => ×1.10 faster). Read by the sim's hasteFactor and divides swingTicks in nextSwingAt (a factor >1,
// the natural extension of 'slow' which is <1). Applied together with 'berserk'/'crit' on a Hwan activation.
export type StatusKind = 'stun' | 'slow' | 'root' | 'knockdown' | 'dot' | 'defense' | 'crit' | 'berserk' | 'haste';

// GDD v0.5 (loot físico): the stack lying on the ground for a kind 'loot' entity, so render/UI can show
// what it is and the pickup knows the contents. Present only on loot entities; null/absent otherwise.
export interface GroundLootView {
  readonly itemId: string;
  readonly name: string;
  readonly rarity: Rarity;
  readonly plus: number;
  readonly qty: number;
}

export interface EntityView {
  readonly id: number;
  readonly kind: EntityKind;
  readonly name: string;
  readonly x: number; // world X (ground plane)
  readonly z: number; // world Z (ground plane); Y is up, ground at 0
  readonly facing: number; // radians
  readonly hp: number;
  readonly maxHp: number;
  readonly mp: number; // ability resource (0 for entities that don't cast)
  readonly maxMp: number;
  // progression (the player levels up; enemies just carry a level for display)
  readonly level: number;
  readonly xp: number; // XP into the CURRENT level
  readonly xpToNext: number; // XP needed to reach the next level
  readonly attrPoints: number; // unspent attribute points ("pontos disponíveis")
  readonly gold: number; // currency (0 for entities that don't carry gold)
  readonly sp: number; // skill points: the second currency, spent to rank up abilities (GDD B4)
  // EFFECTIVE combat stats (base + equipped gear). The character sheet shows
  // these and they drive damage, so equipping a weapon visibly raises them.
  readonly str: number;
  readonly int: number; // Intelligence (spent points); raises max MP
  readonly weaponDamage: number;
  readonly weaponPlus: number; // enhancement level of the equipped weapon (0 if none); drives the glow
  // Defensive stats (K3, surfaced by the character sheet / K6). EFFECTIVE phyDef/magDef = base +
  // equipped gear, recomputed like str/maxHp. Enemies carry 0 (full damage). Combat reads these
  // later (Gabriel's mitigate()); today they are display-only.
  readonly phyDef: number;
  readonly magDef: number;
  // Hit × Parry (Fase 3): esquiva efetiva do jogador (soma FLAT das armaduras, por grau). Diferente de
  // phyDef/magDef, o COMBATE já lê isto: antes da mitigação, o alvo pode esquivar o golpe inteiro. Mobs
  // carregam 0 (não esquivam). Exposto pela ficha (a par de phyDef/magDef).
  readonly parry: number;
  // Block (Fase 3, Fatia 2): chance efetiva (0..1) de o ESCUDO bloquear (amortecer) um golpe que conectou.
  // 0 sem escudo / para mobs. Exposto pela ficha como % (o par do parry: leve esquiva, pesado bloqueia).
  readonly blockRatio: number;
  // Sistema 2 (Berserk/Hwan): a barra de fúria como FRAÇÃO (0..1) — o HUD desenha o medidor e marca os
  // limiares de nível (33/66/100%). 0 para mobs. O buff ativo aparece em `statuses` ('berserk'/'haste').
  readonly berserkGauge: number;
  readonly boss: boolean; // a world boss — render draws it bigger / distinct
  readonly tier: EnemyTierId; // enemy strength tier ('normal' for the player/NPCs); render scales/tints by it
  readonly species: string; // enemy species id ('' for players/NPCs); the renderer picks the 3D model from it
  readonly hostile: boolean; // an enemy currently aggroed on the player (chasing or, for the rooted boss, biting in melee)
  readonly dead: boolean; // a downed player in the "spirit" state, awaiting respawn
  readonly statuses: ReadonlyArray<StatusKind>; // active status-effect kinds (for the on-target indicator)
  // The player's class skin selector: the active weapon mastery ('sword' when unarmed). The
  // renderer maps this to the per-class character model (Knight/Barbarian/Ranger/Mage). Players
  // carry their real mastery; enemies/NPCs report the default ('sword') and the renderer ignores it.
  readonly mastery: MasteryId;
  // GDD v0.5 (loot físico): the dropped stack for a kind 'loot' ground item; null/absent for everyone else.
  readonly loot?: GroundLootView | null;
  // GDD v0.5 (PK livre §2): true while this PLAYER has PK mode armed (holding ALT). PUBLIC — every client
  // sees it, so the renderer can mark a dangerous (PK) player for everyone. Absent/false for non-players.
  readonly pkActive?: boolean;
  // GDD v0.5 (Stalls §5): true while this player has a personal shop (barraca) open — public, so buyers
  // can find/target them. Absent/false for everyone else.
  readonly stallOpen?: boolean;
  // Sistema 15 (QoL — mounts): the mount id this PLAYER is riding (a MOUNTS key, e.g. 'horse'), or absent on
  // foot. Public so the renderer can draw the mount under any player. Absent for non-players.
  readonly mounted?: string;
}

// One stack in the player's bag, with the item's display name resolved.
// `equipSlot` is set when the item is equippable (so the UI knows a click on it
// should equip it, and into which slot). `rarity` drives the UI color/border;
// `rarityName` is its display label.
export interface ItemStackView {
  readonly itemId: string;
  readonly name: string;
  readonly qty: number;
  readonly rarity: Rarity;
  readonly rarityName: string;
  readonly plus: number; // enhancement level (+N); shown in the name
  readonly equipSlot?: EquipSlot;
  readonly consumable: boolean; // true => usable from the bag (a potion, etc.)
  readonly sellValue: number; // gold the vendor pays for ONE of this stack (rarity-scaled)
  // --- K2 degrees (equipáveis): grau, requisito de nível, e se o DONO atual pode equipar ---
  readonly degree?: number; // grau do item (>=1); ausente p/ itens sem grau / não-equipáveis
  readonly reqLevel?: number; // nível mínimo p/ equipar; ausente p/ não-equipáveis
  readonly canEquip?: boolean; // o dono cumpre o requisito? ausente => tratar como equipável (back-compat)
  // Sistema 3 (azuis): as linhas azuis deste item. A UI as mostra (tooltip) E as devolve NO COMANDO (equip/
  // sell/…) pra referenciar a STACK certa (a identidade inclui os azuis). Ausente/vazio => item sem azul.
  readonly blues?: readonly BlueLine[];
}

// One equipment slot's current contents (null fields when empty). `plus` is the
// enhancement level; the two chances are the next attempt's success odds without
// and with a Lucky Powder, so the UI can show whichever matches the toggle.
export interface EquipView {
  readonly slot: EquipSlot;
  readonly itemId: string | null;
  readonly name: string | null;
  readonly rarity: Rarity | null;
  readonly rarityName: string | null;
  readonly plus: number;
  readonly enhanceChance: number; // 0..1 (0 when empty or at the cap)
  // Durability (GDD B8 death penalty): current / max (0 for an empty slot), and the
  // gold to fully repair it at the vendor (0 when full or empty). Worn gear gives less
  // of its stat bonus until repaired.
  readonly durability: number;
  readonly maxDurability: number;
  readonly repairCost: number;
  // K4 alchemy risk readout: the chance THIS next attempt destroys the item (0 below
  // RISK_FLOOR, when empty, or at the cap), and how many "+" a non-breaking failure drops.
  readonly breakChance: number; // 0..1
  readonly dropOnFail: number; // levels lost on a failed (non-breaking) attempt; >= 1
  // Sistema 3 (azuis): as linhas azuis do item EQUIPADO (tooltip do slot). Só display — unequip referencia
  // pelo SLOT (inequívoco), não pela identidade, então não precisa dos azuis no comando. Ausente => sem azul.
  readonly blues?: readonly BlueLine[];
  // Sistema 3 (magic stones): o que a alquimia de atributo pode socar/subir NESTE item — uma linha por azul
  // elegível ao slot, com o nível atual (0 = ainda não socado), o teto neste item (grau×2) e a chance da
  // PRÓXIMA tentativa (0 se no teto ou sem espaço). A UI renderiza um botão por entrada (Pedra Astral).
  readonly socketable?: ReadonlyArray<{
    readonly id: BlueId;
    readonly name: string;
    readonly level: number;
    readonly cap: number;
    readonly chance: number; // 0..1 (a posse da pedra é checada pela UI, como o Elixir no "+N")
  }>;
}

// The player's bag + equipped slots, for the inventory window.
export interface InventoryView {
  readonly capacity: number;
  // DENSE list of the held stacks (no holes) — convenient for counts, the vendor sell list, and
  // the warehouse transfer list. `stacks.length` is the number of items held.
  readonly stacks: ReadonlyArray<ItemStackView>;
  // POSITIONAL view of the bag grid: length === capacity, with `null` for empty slots. `slots[i]`
  // is exactly what sits in grid cell `i`, so the inventory panel renders/drag-drops by position.
  readonly slots: ReadonlyArray<ItemStackView | null>;
  readonly equipment: ReadonlyArray<EquipView>;
  // Sistema 4 (Set items): os conjuntos ATIVOS (>=2 peças equipadas do mesmo set) + o bônus vigente, pra a
  // HUD mostrar "4/5 — Couro · +20 HP". Vazio quando nenhum set está ativo (byte-idêntico à view pré-set).
  readonly activeSets: ReadonlyArray<ActiveSetView>;
}

// Um conjunto ATIVO no snapshot: quantas peças equipadas (`pieces`) de quantas (`total`), + o bônus vigente
// (o maior limiar atingido). Só eixos defensivos (MVP). A HUD renderiza uma linha por entrada.
export interface ActiveSetView {
  readonly id: string;
  readonly name: string;
  readonly pieces: number; // peças equipadas deste set (>=2)
  readonly total: number; // total de peças do conjunto (denominador: 5 armadura / 3 acessório)
  readonly bonus: { readonly maxHp?: number; readonly phyDef?: number; readonly magDef?: number };
}

// Sistema 20 (trade-in): one recycling recipe as the HUD sees it — N input items -> M output items, with
// resolved names. Static (same for everyone); the HUD shows them in the shop and gates the button on the
// player actually holding the inputs (read from inventory()).
export interface RecipeView {
  readonly input: string;
  readonly inputName: string;
  readonly inputQty: number;
  readonly output: string;
  readonly outputName: string;
  readonly outputQty: number;
}

// One item the vendor sells (to BUY), with its resolved name and gold price.
export interface ShopEntryView {
  readonly itemId: string;
  readonly name: string;
  readonly price: number;
}

// The vendor's storefront, for the shop window. `inRange` is whether the local
// player is close enough to actually trade (the sim enforces this too).
export interface ShopView {
  readonly name: string;
  readonly stock: ReadonlyArray<ShopEntryView>;
  readonly inRange: boolean;
}

// GDD v0.5 (Stalls §5): one item a player's personal stall offers. `qty` is the seller's LIVE count.
export interface StallEntryView {
  readonly itemId: string;
  readonly name: string;
  readonly rarity: Rarity;
  readonly plus: number;
  readonly price: number; // gold the buyer pays for ONE
  readonly qty: number; // how many the seller currently holds
}

// GDD v0.5 (Stalls §5): the open stall the local buyer is in range of (or null). Delivered per-buyer like
// ShopView. The buyer clicks a line to buy; the sim moves the item + gold atomically (ST0).
export interface StallView {
  readonly sellerId: number;
  readonly sellerName: string;
  readonly entries: ReadonlyArray<StallEntryView>;
  readonly inRange: boolean;
}

// Global Marketplace — one item listed for sale, buyable from ANYWHERE (no proximity, unlike a stall).
// The item stays in the seller's bag until sold; `qty` is the seller's LIVE count. Same list for everyone.
export interface MarketListingView {
  readonly id: number; // the listing id (buy/cancel reference it)
  readonly sellerName: string; // the seller (may be OFFLINE — the item is escrowed in the listing)
  readonly itemId: string;
  readonly name: string;
  readonly rarity: Rarity;
  readonly plus: number;
  readonly price: number; // gold per unit
  readonly qty: number; // units still escrowed in the listing (self-removes at 0)
  readonly own: boolean; // true if the LOCAL player owns this listing (so the UI shows Cancel, not Buy)
  // Sistema 3 (azuis): as linhas azuis do item listado (o comprador vê o que compra; o item é entregue COM elas).
  readonly blues?: readonly BlueLine[];
}

// The global marketplace board — every active listing (same for everyone) + the VIEWER's own mailbox of
// sale proceeds (gold) + returned items waiting to be collected. Delivered per-client (like the matching
// list). Browse + buy from anywhere, even with the seller offline (the item is escrowed); a sale credits
// the seller's mailbox, which they collect on return.
export interface MarketView {
  readonly listings: ReadonlyArray<MarketListingView>;
  readonly mailboxGold: number; // proceeds waiting for the local player to collect
  readonly mailboxItems: number; // count of returned/unsold item units waiting in the mailbox
}

// The player's persistent warehouse (armazém/banco da cidade) — bag-like, stored at the town
// warehouse and saved with the character (K5). `inRange` is whether the local player is close
// enough to the warehouse NPC to deposit/withdraw (the sim enforces this too).
export interface StorageView {
  readonly name: string;
  readonly capacity: number;
  readonly stacks: ReadonlyArray<ItemStackView>;
  readonly inRange: boolean;
}

// GDD v0.5 (Pets PET2): the transport pet's portable bag — bag-like, carried by the pet. `available` is
// whether a pet is currently summoned (no NPC anchor — it travels with you).
export interface PetBagView {
  readonly name: string;
  readonly capacity: number;
  readonly stacks: ReadonlyArray<ItemStackView>;
  readonly available: boolean;
}

// One destination row in the teleporter menu (GDD v0.5 TP3). `cost` is the fixed gold for a one-way
// trip (0 for the city you're standing in); `current` marks that same city (can't travel to itself).
export interface TeleporterCityView {
  readonly id: string;
  readonly name: string;
  readonly cost: number;
  readonly current: boolean;
}

// The teleporter menu state for the local player (TP3). `inRange` = standing at a city teleporter (so
// register/teleport are allowed); `atCityId` is that city (for "register here"). `registeredCityId` is
// where Return + death respawn go. `returnReady`/`returnBlockedReason` drive the HUD's Return button.
export interface TeleporterView {
  readonly inRange: boolean;
  readonly atCityId: string | null;
  readonly registeredCityId: string;
  readonly cities: ReadonlyArray<TeleporterCityView>;
  readonly returnReady: boolean;
  readonly returnBlockedReason: string | null;
}

// Party (co-op group), Silkroad-style. The leader picks BOTH modes at creation:
//   exp:  'each-get'   — each member keeps the XP they earned (no range limit), +bonus
//                        by party size; capacity 4.
//         'auto-share' — each kill's XP is split (by level) among members IN RANGE;
//                        capacity 8.
//   loot: 'distribution' — the item goes to whoever picked it up (as solo).
//         'auto-share'   — the item goes to a random member in range.
// Defined at the seam so the sim, protocol and UI agree.
export type PartyExpMode = 'each-get' | 'auto-share';
export type PartyLootMode = 'distribution' | 'auto-share';

// One party member as the UI sees it (the server fills the live vitals so the frames
// don't need the shared entity snapshot). `id` still matches an entities() id for position.
export interface PartyMemberView {
  readonly id: number;
  readonly name: string;
  readonly leader: boolean;
  readonly hp: number;
  readonly maxHp: number;
  readonly mp: number;
  readonly maxMp: number;
  readonly level: number;
  readonly dead: boolean; // a downed (spirit) member — drawn dimmed
}

// The local player's party (members + modes), for the frames + party window.
export interface PartyView {
  readonly id: number;
  readonly expMode: PartyExpMode;
  readonly lootMode: PartyLootMode;
  readonly maxMembers: number; // 4 (each-get) or 8 (auto-share)
  readonly members: ReadonlyArray<PartyMemberView>; // includes the leader; join order
}

// A pending party invitation shown to the invited player (accept / refuse).
export interface PartyInviteView {
  readonly fromId: number;
  readonly fromName: string;
  readonly expMode: PartyExpMode;
  readonly lootMode: PartyLootMode;
}

// The local player's active duel (its opponent), or null when not dueling. UI draws a duel banner.
export interface DuelView {
  readonly opponentId: number;
  readonly opponentName: string;
}

// A pending duel challenge shown to the challenged player (accept / decline).
export interface DuelInviteView {
  readonly fromId: number;
  readonly fromName: string;
}

// Player intent / commands. The client streams these into the world.
// Offline they hit the local Sim; online they will be sent to the server.
//
// 'move'/'stop' are a CONTINUOUS intent (held until changed). The others are
// one-shot ACTIONS, applied exactly once inside a tick.
export type Command =
  | { t: 'move'; dx: number; dz: number } // desired direction in world space
  | { t: 'stop' }
  | { t: 'cycle-target' } // Tab: select the nearest enemy in front, then cycle
  | { t: 'set-target'; id: number | null } // click a specific entity (null clears)
  | { t: 'use-ability'; slot: number } // press an action-bar slot (1-based)
  | { t: 'equip'; itemId: string; rarity: Rarity; plus: number; blues?: BlueLine[] } // equip a specific bag stack (blues = identidade)
  | { t: 'unequip'; slot: EquipSlot; toBagSlot?: number } // move an equipped item back to the bag (optionally to a SPECIFIC bag slot index — drag placement)
  | { t: 'move-item'; from: number; to: number } // rearrange the bag: swap/move the stacks at two slot indices (positional inventory)
  | { t: 'enhance'; slot: EquipSlot; useProtection?: boolean } // alchemy "+N" attempt (useProtection: spend a Pedra de Proteção to guard against break / multi-drop)
  | { t: 'enhance-blue'; slot: EquipSlot; blueId: BlueId } // Sistema 3 (magic stones): soca/sobe a linha azul `blueId` no item EQUIPADO em `slot` (consome 1 Pedra Astral)
  | { t: 'repair'; slot: EquipSlot } // pay the vendor to restore an equipped item's durability (GDD B8)
  | { t: 'use-item'; itemId: string; rarity: Rarity; plus: number; blues?: BlueLine[] } // consume a bag stack (potion, etc.)
  | { t: 'spend-attr'; attr: 'str' | 'int' } // spend one attribute point on Strength or Intelligence
  | { t: 'rank-up'; slot: number } // spend SP to raise the rank of the ability in this action-bar slot
  | { t: 'buy'; itemId: string } // buy one of a vendor stock item (must be near the vendor)
  | { t: 'sell'; itemId: string; rarity: Rarity; plus: number; blues?: BlueLine[] } // sell one bag stack to the vendor
  // Sistema 20 (trade-in): redeem a recycling recipe by index (RECIPES) — trades N input items for M output
  // items at the alchemist. The sim validates proximity to the alchemist + holding the inputs + bag room.
  | { t: 'redeem'; recipe: number }
  | { t: 'select-class'; classId: string } // pick a starter class on entry — equips its weapon/kit when unarmed (GDD G1)
  | { t: 'deposit'; itemId: string; rarity: Rarity; plus: number; blues?: BlueLine[] } // K5: bank a whole bag stack (near the warehouse)
  | { t: 'withdraw'; itemId: string; rarity: Rarity; plus: number; blues?: BlueLine[] } // K5: take a whole stack back from the warehouse
  // --- Pets PET2 (GDD v0.5 §4): move whole stacks bag <-> the transport pet's portable bag (no NPC; the
  // pet must be summoned). The sim re-validates ownership + that a pet is out. ---
  | { t: 'pet-deposit'; itemId: string; rarity: Rarity; plus: number; blues?: BlueLine[] } // bag -> pet bag (blues = identidade)
  | { t: 'pet-withdraw'; itemId: string; rarity: Rarity; plus: number; blues?: BlueLine[] } // pet bag -> bag
  | { t: 'set-bot'; on: boolean } // toggle auto-play (the sim drives the player; manual input ignored)
  // Sistema 15 (QoL): auto-potion — set the HP and/or MP auto-pot thresholds as a fraction of the max
  // (0 = off; each optional so a control can set one axis alone). While > 0 and the bot is off, the sim
  // drinks a held Health/Mana Potion when the stat falls below the threshold (shared potion cooldown).
  | { t: 'set-auto-pot'; hpPct?: number; mpPct?: number }
  // --- party / co-op (GDD B6) ---
  | { t: 'party-create'; exp: PartyExpMode; loot: PartyLootMode } // form a party; you become leader
  | { t: 'party-invite'; name: string } // leader: invite an online player by name
  | { t: 'party-accept' } // accept your pending invite
  | { t: 'party-refuse' } // decline your pending invite
  | { t: 'party-leave' } // leave your party (a leaving leader promotes the next member, or it dissolves)
  | { t: 'party-kick'; id: number } // leader: remove a member by player id
  | { t: 'party-admit'; playerId: number } // leader admits a matching join-request (server-issued only; the
  // request/approval handshake lives in the server's matching lobby — the sim just does the membership change)
  // --- PvP duel (Tier 1; consensual 1v1) ---
  | { t: 'duel-challenge'; name: string } // challenge an online player to a duel by name
  | { t: 'duel-accept' } // accept your pending duel challenge (forms the pair)
  | { t: 'duel-decline' } // decline your pending duel challenge
  // --- teleporte entre cidades (GDD v0.5): viaja entre os hubs a partir do NPC no centro da cidade ---
  | { t: 'teleport'; cityId: string } // teleport to another city's centre (server validates proximity + gold + destination)
  // --- cadastrar cidade de retorno (GDD v0.5 TP2): register the city you're standing at as your Return/respawn hub ---
  | { t: 'register-city' } // no args — the sim registers whichever city teleporter you're at (free)
  // --- return/recall (GDD v0.5 TP2): free warp to your registered city from anywhere; sim gates cooldown + combat ---
  | { t: 'return' } // no args — recall to the player's registered Return city
  // --- pegar loot do chão (GDD v0.5 loot físico LF-S2): pick up a ground item by id (FFA; sim validates range) ---
  | { t: 'pickup'; lootId: number } // the ground-loot entity id to pick up into the bag
  // --- pegar TODO o loot no alcance de uma vez (tecla G; o "pegar sozinho" sem pet) ---
  | { t: 'pickup-nearby' } // no args — picks up every ground item within reach (FFA; sim validates range/bag)
  // --- PK livre (GDD v0.5 §2): hold ALT to flag free PvP. A HELD modifier (not a one-shot): the sim
  // stores it per-player and canAttack reads it every tick, so the continuous auto-swing keeps releasing
  // against players outside cities. Sent edge-triggered (on ALT down/up) — no consent/handshake. ---
  | { t: 'set-pk'; on: boolean } // ALT held/released -> PK mode on/off
  // --- Pets (GDD v0.5 §4): summon/dismiss the owned grab pet (a held-or-toggle companion). The sim
  // validates that the player actually OWNS a pet item before spawning the follower. ---
  | { t: 'set-pet'; on: boolean } // summon (true) / dismiss (false) the player's pet
  // Sistema 15 (QoL): mount/dismount the owned mount (on = mount, off = on foot). The sim validates the
  // player owns a mount token; mounting is refused in combat and auto-dismounts on entering it.
  | { t: 'set-mount'; on: boolean }
  // Sistema 2 (Berserk/Hwan): ativa o burst. Deriva o nível (1..3) do quão cheia está a barra e aplica um
  // buff multi-eixo temporário (dano/haste/crit), zerando a barra. Recusado (no-op) se a barra < 33%.
  | { t: 'activate-berserk' }
  // --- Stalls (GDD v0.5 §5): personal P2P shops. open lists bag items at owner-set prices; buy moves the
  // item + gold ATOMICALLY (the sim validates ownership/gold/room/proximity + anti-duplication). ---
  | { t: 'stall-open'; listings: ReadonlyArray<{ itemId: string; rarity: Rarity; plus: number; price: number }> }
  | { t: 'stall-close' }
  | { t: 'stall-buy'; sellerId: number; itemId: string; rarity: Rarity; plus: number } // buy ONE of a listed stack
  // --- Global Marketplace: list a bag item for sale GLOBALLY (buyable from anywhere), cancel a listing,
  // or buy one. The sim re-validates ownership/gold/room + moves item + gold atomically (anti-dup). ---
  | { t: 'market-list'; itemId: string; rarity: Rarity; plus: number; price: number; blues?: BlueLine[] }
  | { t: 'market-cancel'; listingId: number }
  | { t: 'market-buy'; listingId: number } // buy ONE unit of a listing
  | { t: 'market-collect' }; // collect your mailbox: sale proceeds (gold) + unsold/returned items

// One action-bar slot, as the HUD sees it. The sim owns cooldown/MP gating; the
// bar just draws icon + the sweeping cooldown and dims when not castable.
export interface AbilityView {
  readonly slot: number;
  readonly name: string;
  readonly icon: string;
  readonly mpCost: number;
  readonly ready: boolean; // off cooldown, off the global cooldown, and enough MP
  readonly cooldownRemaining: number; // seconds left on the ability's own cooldown
  readonly cooldownTotal: number; // seconds, for drawing the sweep fraction
  // Skill rank (GDD B4): current rank, the cap, and the SP cost to raise it one more
  // (0 when already at the cap). The skills panel shows these and gates the button.
  readonly rank: number;
  readonly maxRank: number;
  readonly rankCost: number;
  // Sistema 1 (destrave por nível): whether the player's level has reached this skill's unlock, and the
  // level it unlocks at. abilities()/passives() return the FULL kit (locked + unlocked); the HUD renders
  // only unlocked skills on the action bar (the bar grows) and previews the locked ones greyed in the
  // skills panel ("Destrava no nv X"). Everything on the bar is unlocked:true.
  readonly unlocked: boolean;
  readonly unlockLevel: number;
}

// Transient things that happened inside a tick, for presentation only (floating
// damage numbers, hit flashes, later: sounds). The sim generates these
// deterministically; render/ui READ them and draw — they never drive gameplay.
// `seq` is a monotonic id so a consumer can track what it has already drawn,
// and `x`/`z` snapshot the target's position so the effect still shows even if
// the target dies on the same tick.
export type SimEvent = {
  readonly seq: number;
  readonly tick: number;
  // 'damage': amount = hit dealt to targetId; `crit` = the hit was a critical (for a
  //   distinct, bigger pop). 'levelup': amount = new level.
  // 'miss': the target (a player) ESQUIVOU the incoming hit entirely (Hit × Parry) — amount = 0,
  //   x/z anchor a "Miss" pop over the target; no HP lost. Only players dodge (mobs have parry 0).
  // 'damage' + `blocked`: the target's SHIELD blocked the hit (Fatia 2) — the hit still landed but its
  //   damage was absorbed (reduced); `amount` is the ALREADY-reduced HP lost. Presentation flag only.
  // 'enhance-success'/'enhance-fail': amount = the item's new "+" level.
  // 'enhance-break': a failed high-"+" attempt destroyed the item; `text` = its name.
  // 'heal': amount = HP/MP restored to targetId (drawn as a green number).
  // 'death'/'respawn': the player went down / came back; `text` = the player name.
  // 'boss-spawn'/'boss-defeat'/'boss-summon': `text` = the boss name, for the announcement.
  // 'pk-kill': a player killed another in free PK; `text` = the full kill-feed line ("X derrotou Y").
  // targetId is the affected entity; x/z anchors the on-screen effect.
  readonly kind:
    | 'damage'
    | 'miss'
    // 'berserk': the local player ATIVOU o Hwan (Sistema 2) — amount = the burst level (1..3); x/z over the
    //   player for a "BERSERK N!" pop. No HP effect; the multi-axis buff is applied as statuses.
    | 'berserk'
    | 'levelup'
    | 'enhance-success'
    | 'enhance-fail'
    | 'enhance-break'
    | 'heal'
    | 'death'
    | 'respawn'
    | 'boss-spawn'
    | 'boss-defeat'
    | 'boss-summon'
    | 'pk-kill';
  readonly targetId: number;
  readonly amount: number;
  readonly x: number;
  readonly z: number;
  readonly text?: string; // optional label (e.g. a boss name for announcements)
  readonly crit?: boolean; // 'damage' only: the hit was a critical — presentation flag for a distinct number
  readonly blocked?: boolean; // 'damage' only: the target's shield blocked (softened) the hit — presentation flag
};

export interface IWorld {
  readonly tick: number;
  entities(): ReadonlyArray<EntityView>;
  localPlayerId(): number | null;
  // The local player's current target (an enemy id), or null if nothing is
  // selected. The sim owns this; render/ui only read it.
  localTargetId(): number | null;
  // Recent presentation events (last ~1s), oldest first. Read-only; consumers
  // de-dup by `seq`. The window is short, so a backgrounded tab just drops
  // stale cosmetic events — they never affect the simulation.
  recentEvents(): ReadonlyArray<SimEvent>;
  // The local player's action bar (icons + live cooldown/readiness) for the HUD.
  abilities(): ReadonlyArray<AbilityView>;
  // The local player's learnable PASSIVE skills (Sistema 2) — always-on, ranked with SP, never cast.
  // Separate from the action bar; the skills panel lists these with a rank-up button (no cast slot).
  passives(): ReadonlyArray<AbilityView>;
  // The local player's bag (resolved item names + capacity) for the HUD window.
  inventory(): InventoryView;
  // The vendor's storefront (stock + whether the player is in range) for the shop.
  shop(): ShopView;
  // Sistema 20 (trade-in): the recycling recipes (static list with resolved names) for the shop panel.
  recipes(): ReadonlyArray<RecipeView>;
  // The local player's warehouse (armazém) contents + whether in range to deposit/withdraw.
  storage(): StorageView;
  // GDD v0.5 (Pets PET2): the transport pet's portable bag (contents + whether a pet is summoned).
  petBag(): PetBagView;
  // The teleporter menu state for the local player (city list + cost, registered city, Return status).
  teleporter(): TeleporterView;
  // Whether auto-play (bot) mode is on (the sim is driving the player). UI reads
  // this for the indicator + to know manual input is being ignored.
  botActive(): boolean;
  // Sistema 15 (QoL): the local player's auto-pot HP/MP thresholds (fraction of the max; 0 = off). The HUD
  // reads them to show the toggle state and to send the next preset on a click.
  autoPotHpPct(): number;
  autoPotMpPct(): number;
  // GDD v0.5 (Pets): whether the local player currently has a pet summoned. UI reads it for the
  // summon/dismiss toggle state; input reads it to send the opposite on the toggle key.
  petActive(): boolean;
  // Sistema 15 (QoL — mounts): whether the local player is currently mounted. Input reads it to send the
  // opposite on the toggle key; UI can show the state.
  mountActive(): boolean;
  // GDD v0.5 (Stalls): the open stall the local player is in range of (to browse + buy), or null.
  stall(): StallView | null;
  // Global Marketplace: every active listing (the same board for everyone), to browse + buy from anywhere.
  market(): MarketView;
  // The local player's party (members + modes), or null when solo. UI draws the
  // party frames + window from this; online it mirrors the server's authoritative state.
  localParty(): PartyView | null;
  // A pending party invite for the local player (to accept/refuse), or null.
  localInvite(): PartyInviteView | null;
  // The local player's active duel opponent, or null when not dueling. UI draws the duel banner.
  localDuel(): DuelView | null;
  // A pending duel challenge for the local player (to accept/decline), or null.
  localDuelInvite(): DuelInviteView | null;
  sendCommand(cmd: Command): void;
}
