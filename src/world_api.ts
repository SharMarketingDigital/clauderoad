// The ONLY seam between game logic and presentation.
//
// Offline: `Sim` implements IWorld directly.
// Online (future): `ClientWorld` implements IWorld by mirroring server snapshots.
//
// RULE: src/render/ and src/ui/ depend on IWorld, never on Sim/ClientWorld
// concretely. To add a feature, extend IWorld first, then implement it in
// every world (offline Sim, and later the online ClientWorld).

export type EntityKind = 'player' | 'enemy' | 'npc';

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

// Status effect kinds. Debuffs: stun/knockdown (can't act), root (can't move),
// slow (moves/attacks slower), dot (damage over time). Buffs: defense (the caster
// takes reduced incoming damage — Sword's Postura Defensiva), crit (raised crit
// chance — Spear's Fúria). Defined at the seam so the sim, content and renderer
// agree; render shows a marker by kind.
export type StatusKind = 'stun' | 'slow' | 'root' | 'knockdown' | 'dot' | 'defense' | 'crit';

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

// The player's persistent warehouse (armazém/banco da cidade) — bag-like, stored at the town
// warehouse and saved with the character (K5). `inRange` is whether the local player is close
// enough to the warehouse NPC to deposit/withdraw (the sim enforces this too).
export interface StorageView {
  readonly name: string;
  readonly capacity: number;
  readonly stacks: ReadonlyArray<ItemStackView>;
  readonly inRange: boolean;
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
  | { t: 'equip'; itemId: string; rarity: Rarity; plus: number } // equip a specific bag stack
  | { t: 'unequip'; slot: EquipSlot; toBagSlot?: number } // move an equipped item back to the bag (optionally to a SPECIFIC bag slot index — drag placement)
  | { t: 'move-item'; from: number; to: number } // rearrange the bag: swap/move the stacks at two slot indices (positional inventory)
  | { t: 'enhance'; slot: EquipSlot; useProtection?: boolean } // alchemy "+N" attempt (useProtection: spend a Pedra de Proteção to guard against break / multi-drop)
  | { t: 'repair'; slot: EquipSlot } // pay the vendor to restore an equipped item's durability (GDD B8)
  | { t: 'use-item'; itemId: string; rarity: Rarity; plus: number } // consume a bag stack (potion, etc.)
  | { t: 'spend-attr'; attr: 'str' | 'int' } // spend one attribute point on Strength or Intelligence
  | { t: 'rank-up'; slot: number } // spend SP to raise the rank of the ability in this action-bar slot
  | { t: 'buy'; itemId: string } // buy one of a vendor stock item (must be near the vendor)
  | { t: 'sell'; itemId: string; rarity: Rarity; plus: number } // sell one bag stack to the vendor
  | { t: 'select-class'; classId: string } // pick a starter class on entry — equips its weapon/kit when unarmed (GDD G1)
  | { t: 'deposit'; itemId: string; rarity: Rarity; plus: number } // K5: bank a whole bag stack (near the warehouse)
  | { t: 'withdraw'; itemId: string; rarity: Rarity; plus: number } // K5: take a whole stack back from the warehouse
  | { t: 'set-bot'; on: boolean } // toggle auto-play (the sim drives the player; manual input ignored)
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
  | { t: 'return' }; // no args — recall to the player's registered Return city

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
  // 'damage': amount = hit dealt to targetId. 'levelup': amount = new level.
  // 'enhance-success'/'enhance-fail': amount = the item's new "+" level.
  // 'enhance-break': a failed high-"+" attempt destroyed the item; `text` = its name.
  // 'heal': amount = HP/MP restored to targetId (drawn as a green number).
  // 'death'/'respawn': the player went down / came back; `text` = the player name.
  // 'boss-spawn'/'boss-defeat'/'boss-summon': `text` = the boss name, for the announcement.
  // targetId is the affected entity; x/z anchors the on-screen effect.
  readonly kind:
    | 'damage'
    | 'levelup'
    | 'enhance-success'
    | 'enhance-fail'
    | 'enhance-break'
    | 'heal'
    | 'death'
    | 'respawn'
    | 'boss-spawn'
    | 'boss-defeat'
    | 'boss-summon';
  readonly targetId: number;
  readonly amount: number;
  readonly x: number;
  readonly z: number;
  readonly text?: string; // optional label (e.g. a boss name for announcements)
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
  // The local player's bag (resolved item names + capacity) for the HUD window.
  inventory(): InventoryView;
  // The vendor's storefront (stock + whether the player is in range) for the shop.
  shop(): ShopView;
  // The local player's warehouse (armazém) contents + whether in range to deposit/withdraw.
  storage(): StorageView;
  // The teleporter menu state for the local player (city list + cost, registered city, Return status).
  teleporter(): TeleporterView;
  // Whether auto-play (bot) mode is on (the sim is driving the player). UI reads
  // this for the indicator + to know manual input is being ignored.
  botActive(): boolean;
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
