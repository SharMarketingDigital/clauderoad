import type { EntityKind, EquipSlot, Rarity } from '../world_api';

// One stack of items in a bag (the sim's internal shape; the view is
// ItemStackView in world_api.ts). Stacks key on item id, rarity AND enhancement
// (+N), so a +4 SUN sword is a separate stack from a +0 Normal one.
export interface ItemStack {
  itemId: string;
  rarity: Rarity;
  plus: number; // enhancement level (0..MAX_PLUS)
  qty: number;
}

// A specific equipped item instance (id + the rarity it rolled at + its +N).
export interface EquippedItem {
  itemId: string;
  rarity: Rarity;
  plus: number;
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
  swingTicks: number; // ticks between melee swings (0 = cannot auto-attack)
  nextSwingAt: number; // earliest tick the next swing may land
  // resources & abilities (player). Enemies carry zeros / empty.
  mp: number;
  maxMp: number;
  gcdUntil: number; // tick until which the global cooldown blocks any ability
  abilityReadyAt: Record<number, number>; // action-bar slot -> earliest usable tick
  // progression. The player gains xp/levels; enemies just carry a level.
  level: number;
  xp: number; // XP accumulated into the current level
  attrPoints: number; // unspent attribute points
  // economy & inventory (player; enemies carry 0 / empty)
  gold: number;
  bag: ItemStack[];
  equipment: Record<EquipSlot, EquippedItem | null>; // slot -> equipped item
  // a world boss (special enemy): much more HP, boss loot, distinct visuals,
  // and a separate spawn/respawn timer.
  boss: boolean;
  // a boss-summoned minion: ephemeral (when killed it does NOT enter the common
  // respawn queue, so summons don't permanently grow the wolf population).
  summoned: boolean;
  // enemy wander state
  targetX: number;
  targetZ: number;
  repickAt: number;
}
