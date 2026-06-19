// The ONLY seam between game logic and presentation.
//
// Offline: `Sim` implements IWorld directly.
// Online (future): `ClientWorld` implements IWorld by mirroring server snapshots.
//
// RULE: src/render/ and src/ui/ depend on IWorld, never on Sim/ClientWorld
// concretely. To add a feature, extend IWorld first, then implement it in
// every world (offline Sim, and later the online ClientWorld).

export type EntityKind = 'player' | 'enemy';

// Equipment slots a character can fill. Defined here (the seam) so both the
// sim's item content and the UI agree on the set.
export type EquipSlot = 'weapon' | 'armor';

// Item rarity, common -> rarest (Silkroad-style lucky drops). Defined at the
// seam so content, sim, and UI agree; the UI maps these to colors.
export type Rarity = 'normal' | 'sos' | 'som' | 'sun';

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
  // EFFECTIVE combat stats (base + equipped gear). The character sheet shows
  // these and they drive damage, so equipping a weapon visibly raises them.
  readonly str: number;
  readonly weaponDamage: number;
  readonly weaponPlus: number; // enhancement level of the equipped weapon (0 if none); drives the glow
  readonly boss: boolean; // a world boss — render draws it bigger / distinct
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
  readonly enhanceChance: number; // 0..1, no powder (0 when empty or at the cap)
  readonly enhanceChanceLucky: number; // 0..1, with a Lucky Powder
}

// The player's bag + equipped slots, for the inventory window.
export interface InventoryView {
  readonly capacity: number;
  readonly stacks: ReadonlyArray<ItemStackView>;
  readonly equipment: ReadonlyArray<EquipView>;
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
  | { t: 'unequip'; slot: EquipSlot } // move an equipped item back to the bag
  | { t: 'enhance'; slot: EquipSlot; useLuckyPowder: boolean }; // alchemy "+N" attempt

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
  // 'boss-spawn'/'boss-defeat': `text` = the boss name, for the announcement.
  // targetId is the affected entity; x/z anchors the on-screen effect.
  readonly kind: 'damage' | 'levelup' | 'enhance-success' | 'enhance-fail' | 'boss-spawn' | 'boss-defeat';
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
  sendCommand(cmd: Command): void;
}
