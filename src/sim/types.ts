import type { EntityKind } from '../world_api';

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
  // enemy wander state
  targetX: number;
  targetZ: number;
  repickAt: number;
}
