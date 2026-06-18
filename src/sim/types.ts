import type { EntityKind } from '../world_api';

// One stack of items in a bag (the sim's internal shape; the view is
// ItemStackView in world_api.ts).
export interface ItemStack {
  itemId: string;
  qty: number;
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
  // combat (melee auto-attack). Enemies don't attack yet, so they carry zeros.
  str: number;
  weaponDamage: number;
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
  // enemy wander state
  targetX: number;
  targetZ: number;
  repickAt: number;
}
