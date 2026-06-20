// The wire protocol — the ONE source of truth for messages, shared by the client
// (src/net) and the authoritative server (server/). Both import these exact types, so
// they can never drift. Pure types only — no DOM, no Node, no runtime code.
//
// SECURITY MODEL: the server is authoritative. The client only ever sends INTENT
// (who it is, which way it wants to walk, which mob it wants to hit); the server
// decides every position, every hit, every death and streams snapshots back. Nothing
// position- or combat-sensitive is ever trusted from a client.
//
// This slice adds SHARED MOBS + COMBAT: the snapshot now carries the mobs (and the
// town NPC) alongside players, plus the combat events (damage/death/…) the server's
// sim produced, so both clients see the same fight. Loot/XP UI is the next slice.
import type { EntityKind, EnemyTierId, SimEvent } from '../world_api';

// ---- client -> server (INTENT only) ----
export type ClientMessage =
  | { t: 'join'; name: string } // sent once on connect; the server spawns a player
  | { t: 'move-intent'; dx: number; dz: number } // desired world-space direction ({0,0} = stop)
  | { t: 'set-target'; id: number | null } // select a mob to attack (an entity id; null clears)
  | { t: 'cycle-target' } // Tab: server picks the nearest enemy in front, then cycles
  | { t: 'use-ability'; slot: number }; // press an action-bar slot (the sim gates range/cooldown/cost)

// One entity's public state in a snapshot — players AND mobs AND the town NPC. The
// server owns all of it; the client only mirrors + interpolates. Kept compact (rounded
// numbers, no derived fields the client can recompute) to stay light on bandwidth.
export interface EntitySnap {
  id: number;
  kind: EntityKind; // 'player' | 'enemy' | 'npc'
  name: string;
  x: number;
  z: number;
  facing: number; // radians
  hp: number;
  maxHp: number;
  tier: EnemyTierId; // enemy strength tier ('normal' for players/NPCs); render scales/tints by it
  boss: boolean; // a world boss — render draws it bigger / distinct
  hostile: boolean; // an enemy currently aggroed (chasing/biting) — for the hostile tint
  dead: boolean; // a downed player in the "spirit" state
}

// A presentation event forwarded from the server's sim (floating damage numbers, hit
// flashes, deaths, level-ups…). Mirrors SimEvent minus `tick` (meaningless to a remote
// client); `seq` is monotonic so the client draws each exactly once.
export interface NetEvent {
  seq: number;
  kind: SimEvent['kind'];
  targetId: number;
  amount: number;
  x: number;
  z: number;
  text?: string;
}

// ---- server -> client ----
export type ServerMessage =
  | { t: 'welcome'; id: number; snapshotHz: number } // your player id + the snapshot rate (for interpolation)
  | { t: 'snapshot'; entities: EntitySnap[]; events: NetEvent[] }; // the shared world + new combat events
