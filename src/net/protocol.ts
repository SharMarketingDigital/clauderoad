// The wire protocol — the ONE source of truth for messages, shared by the client
// (src/net) and the authoritative server (server/). Both import these exact types, so
// they can never drift. Pure types only — no DOM, no Node, no runtime code.
//
// SECURITY MODEL: the server is authoritative. The client only ever sends INTENT
// (who it is, which way it wants to walk); the server decides every position and
// streams snapshots back. Nothing position-sensitive is ever trusted from a client.
//
// This first slice is presence + movement ONLY — no combat/loot/inventory/chat yet.

// ---- client -> server ----
export type ClientMessage =
  | { t: 'join'; name: string } // sent once on connect; the server spawns a player
  | { t: 'move-intent'; dx: number; dz: number }; // desired world-space direction ({0,0} = stop)

// One player's minimal public state in a snapshot (id, name, position, orientation).
export interface PlayerSnap {
  id: number;
  name: string;
  x: number;
  z: number;
  facing: number; // radians
}

// ---- server -> client ----
export type ServerMessage =
  | { t: 'welcome'; id: number; snapshotHz: number } // your player id + the snapshot rate (for interpolation)
  | { t: 'snapshot'; players: PlayerSnap[] }; // the full set of players in the shared world
