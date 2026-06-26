import type { EntityKind, EquipSlot, Rarity, StatusKind, EnemyTierId } from '../world_api';

// One active status effect on an entity (see the sim's status system).
export interface StatusEffect {
  kind: StatusKind;
  expiresAt: number; // tick the effect ends (active while tick < expiresAt)
  magnitude: number; // slow: speed factor in (0,1]; dot: damage per application; else 0
  period: number; // dot: ticks between damage applications; else 0
  nextAt: number; // dot: next tick to apply damage; else 0
  source: number; // entity id that applied it (DoT kill credit), or 0
}

// One stack of items in a bag (the sim's internal shape; the view is
// ItemStackView in world_api.ts). Stacks key on item id, rarity AND enhancement
// (+N), so a +4 SUN sword is a separate stack from a +0 Normal one.
export interface ItemStack {
  itemId: string;
  rarity: Rarity;
  plus: number; // enhancement level (0..MAX_PLUS)
  qty: number;
}

// A specific equipped item instance (id + the rarity it rolled at + its +N + its
// current durability). Durability starts full on equip, drops on death (GDD B8), and
// is restored by repairing at the vendor; worn gear gives less of its stat bonus.
export interface EquippedItem {
  itemId: string;
  rarity: Rarity;
  plus: number;
  durability: number;
}

// Internal mutable entity. The sim owns these; the outside world only ever
// sees the read-only EntityView (see world_api.ts).
export interface Entity {
  id: number;
  kind: EntityKind;
  name: string;
  x: number;
  z: number;
  facing: number;
  hp: number;
  maxHp: number;
  // tab-target: id of the selected enemy, or null. Only the player uses this
  // today; enemies keep it null.
  targetId: number | null;
  // combat (melee auto-attack). `str`/`weaponDamage`/`maxHp`/`maxMp` are the
  // EFFECTIVE values (base + equipped gear), recomputed on equip/level-up; the
  // base* fields below are the unequipped baseline. Enemies carry zeros.
  str: number;
  weaponDamage: number;
  baseStr: number;
  baseWeaponDamage: number;
  baseMaxHp: number;
  baseMaxMp: number;
  // Defensive stats (K3). EFFECTIVE phyDef/magDef = base + equipped gear, recomputed in
  // recomputeStats just like str/maxHp. Combat does NOT read these yet (Gabriel's mitigate()
  // will). Enemies carry 0 -> take full damage (unchanged). base* are 0 today (no innate defense).
  phyDef: number;
  magDef: number;
  basePhyDef: number;
  baseMagDef: number;
  // Intelligence (spent attribute points). Drives max MP. No "effective" gear
  // bonus today, so the view's `int` equals this. Enemies carry 0.
  baseInt: number;
  swingTicks: number; // ticks between melee swings (0 = cannot auto-attack)
  nextSwingAt: number; // earliest tick the next swing may land
  // resources & abilities (player). Enemies carry zeros / empty.
  mp: number;
  maxMp: number;
  gcdUntil: number; // tick until which the global cooldown blocks any ability
  abilityReadyAt: Record<number, number>; // action-bar slot -> earliest usable tick
  // shared "potion cooldown": earliest tick a consumable may be used again.
  potionReadyAt: number;
  // GDD v0.5 (teleporte): cooldown for the FREE Return recall — earliest tick it may be used again
  // (0 = ready). Transient like potionReadyAt: NOT persisted (resets to ready on reload). Non-players 0.
  returnReadyAt: number;
  // player death: tick at which a downed player respawns (0 = alive). The spirit
  // can't act until then. Enemies always carry 0.
  deadUntil: number;
  // progression. The player gains xp/levels; enemies just carry a level.
  level: number;
  xp: number; // XP accumulated into the current level
  attrPoints: number; // unspent attribute points
  // skill ranks (GDD B4): SP is a second currency spent to raise an ability's rank
  // (stronger hit + longer effects). Enemies carry 0 / an empty map.
  sp: number; // unspent skill points
  skillRanks: Record<string, number>; // ability id -> current rank (absent = rank 1)
  // economy & inventory (player; enemies carry 0 / empty)
  gold: number;
  // GDD v0.5 (teleporte): the city the player is REGISTERED to — where Return recalls them and
  // where they respawn on death. A known city id (zones CITIES); the player defaults to 'town'
  // (central). Persistent per-player state (save.ts) and folded into the hash. Non-players carry
  // '' (unused), the same "N/A" marker as `species`.
  returnCity: string;
  // SPARSE/positional: fixed-length grid (length = BAG_SLOTS for players), holes are null so an
  // item stays at the slot the player dragged it to (loot refills the lowest hole in F-order).
  bag: (ItemStack | null)[];
  // K5: armazém/banco persistente do jogador (itens guardados na cidade). Vazio p/ inimigos/NPCs.
  // Mesmo modelo esparso da bag (holes = null); a view filtra os holes.
  storage: (ItemStack | null)[];
  equipment: Record<EquipSlot, EquippedItem | null>; // slot -> equipped item
  // a world boss (special enemy): much more HP, boss loot, distinct visuals,
  // and a separate spawn/respawn timer.
  boss: boolean;
  // a boss-summoned minion: ephemeral (when killed it does NOT enter the common
  // respawn queue, so summons don't permanently grow the wolf population).
  summoned: boolean;
  // the spawn-zone index (into zones SPAWN_ZONES) this mob belongs to, so a kill respawns
  // a replacement in the SAME ring (keeping each ring's level population stable). -1 for
  // players, the vendor NPC, bosses and summons (they aren't ring mobs).
  spawnZone: number;
  // enemy strength tier ('normal' for the player/NPCs/boss); scales HP/damage/
  // reward at spawn and drives the renderer's size/tint.
  tier: EnemyTierId;
  // enemy species id (a key in content/enemies.ts SPECIES_BY_ID), e.g. 'skeleton_minion'
  // | 'skeleton_rogue' | 'skeleton_warrior' | 'skeleton_mage'. Fixed by the spawn ring;
  // drives stats/loot/behavior and the renderer's model choice. '' for players/NPCs.
  species: string;
  // enemy AI: the leash anchor — where the CURRENT chase began. The enemy gives
  // up if led `leashRadius` from here. Players carry zeros (unused).
  homeX: number;
  homeZ: number;
  // active status effects (stun/slow/root/knockdown/dot). Empty when none.
  effects: StatusEffect[];
  // enemy wander state
  targetX: number;
  targetZ: number;
  repickAt: number;
}
