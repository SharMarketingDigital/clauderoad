import type { EntityKind, EquipSlot, Rarity } from '../world_api';

// One stack of items in a bag (the sim's internal shape; the view is
// ItemStackView in world_api.ts). Stacks key on item id AND rarity, so a SUN
// sword and a Normal sword are separate stacks.
export interface ItemStack {
  itemId: string;
  rarity: Rarity;
  qty: number;
}

// A specific equipped item instance (id + the rarity it rolled at).
export interface EquippedItem {
  itemId: string;
  rarity: Rarity;
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
  // enemy wander state
  targetX: number;
  targetZ: number;
  repickAt: number;
}
