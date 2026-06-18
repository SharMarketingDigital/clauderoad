// The ONLY seam between game logic and presentation.
//
// Offline: `Sim` implements IWorld directly.
// Online (future): `ClientWorld` implements IWorld by mirroring server snapshots.
//
// RULE: src/render/ and src/ui/ depend on IWorld, never on Sim/ClientWorld
// concretely. To add a feature, extend IWorld first, then implement it in
// every world (offline Sim, and later the online ClientWorld).

export type EntityKind = 'player' | 'enemy';

export interface EntityView {
  readonly id: number;
  readonly kind: EntityKind;
  readonly name: string;
  readonly x: number; // world X (ground plane)
  readonly z: number; // world Z (ground plane); Y is up, ground at 0
  readonly facing: number; // radians
  readonly hp: number;
  readonly maxHp: number;
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
  | { t: 'set-target'; id: number | null }; // click a specific entity (null clears)

// Transient things that happened inside a tick, for presentation only (floating
// damage numbers, hit flashes, later: sounds). The sim generates these
// deterministically; render/ui READ them and draw — they never drive gameplay.
// `seq` is a monotonic id so a consumer can track what it has already drawn,
// and `x`/`z` snapshot the target's position so the effect still shows even if
// the target dies on the same tick.
export type SimEvent = {
  readonly seq: number;
  readonly tick: number;
  readonly kind: 'damage';
  readonly targetId: number;
  readonly amount: number;
  readonly x: number;
  readonly z: number;
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
  sendCommand(cmd: Command): void;
}
