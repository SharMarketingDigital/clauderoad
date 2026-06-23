// The wire protocol — the ONE source of truth for messages, shared by the client
// (src/net) and the authoritative server (server/). Both import these exact types, so
// they can never drift. Pure types only — no DOM, no Node, no runtime code.
//
// SECURITY MODEL: the server is authoritative. The client only ever sends INTENT
// (who it is, which way it wants to walk, which command it wants to run). The server
// runs the one shared Sim, decides EVERY outcome — position, hit, loot, XP, gold — and
// streams back (a) the shared world + combat events to everyone and (b) each player's
// PERSONAL state (HUD, bag) to ITS OWNER ONLY. Nothing is ever trusted from a client.
import type {
  EntityKind, EnemyTierId, StatusKind, SimEvent, Command, AbilityView, InventoryView, ShopView,
  PartyView, PartyInviteView, PartyExpMode, MasteryId,
} from '../world_api';

// ---- client -> server (INTENT only) ----
// `cmd` forwards any gameplay Command (target, ability, equip, buy, …). The server
// whitelists which commands it accepts (so a layer's commands light up only when wired)
// and the Sim validates the rest (range, cooldown, MP, gold, ownership of the item, …).
export type ClientMessage =
  | { t: 'join'; name: string } // sent once on connect; the server spawns a player
  | { t: 'move-intent'; dx: number; dz: number } // desired world-space direction ({0,0} = stop)
  | { t: 'cmd'; cmd: Command } // any other gameplay intent (server-validated)
  | { t: 'chat'; text: string; channel?: ChatChannel } // a chat message the player typed (server sanitizes
  // the TEXT; the NAME is whatever the server already knows for this connection — never trusted). `channel`
  // 'party' routes only to the sender's party members; 'say' (default) broadcasts to everyone.
  // --- party matching (lobby; SERVER state, not the sim — see SelfSnap.matching) ---
  | { t: 'matching-register'; title: string; minLevel: number; maxLevel: number } // leader lists their party as LFM
  | { t: 'matching-unregister' } // leader removes their party from the list
  | { t: 'matching-request'; partyId: number } // ask to join a listed party (the leader then approves/denies)
  | { t: 'matching-cancel' } // withdraw your own pending join request
  | { t: 'matching-approve'; playerId: number } // leader: accept a pending join request (admits them to the sim party)
  | { t: 'matching-deny'; playerId: number }; // leader: decline a pending join request

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
  species: string; // enemy species id ('' for players/NPCs); the renderer picks the 3D model from it
  hostile: boolean; // an enemy currently aggroed (chasing/biting) — for the hostile tint
  dead: boolean; // a downed player in the "spirit" state
  weaponPlus: number; // enhancement level of the equipped weapon (0 if none) — drives the +N glow on EVERY entity
  statuses: StatusKind[]; // active status-effect kinds (stun/slow/root/bleed…) — for the on-entity indicator
  mastery: MasteryId; // the player's weapon mastery ('sword' for unarmed/enemies/NPCs) — picks the class skin
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

// One party registered in the PUBLIC matching list ("looking for members"). This is
// SERVER/lobby state (title, level limits, an ~1h expiry) — deliberately NOT in the
// deterministic sim. Everyone sees the same list; the live size/leader come from the sim.
export interface MatchingEntryView {
  partyId: number;
  leaderName: string;
  title: string;
  expMode: PartyExpMode; // the party's XP mode (fixed at creation) — shown so seekers know the type
  members: number; // current member count
  maxMembers: number; // 4 (each-get) or 8 (auto-share)
  minLevel: number; // join restriction; 0 = no minimum
  maxLevel: number; // join restriction; 0 = no maximum
}

// One pending join REQUEST to the local player's party, shown to the LEADER to approve or
// deny (the mirror of an invite). Personal — only the leader of the requested party sees it.
export interface MatchingRequestView {
  playerId: number;
  name: string;
  level: number;
}

// A player's OWN state — the part of the world only its owner needs (HUD + bag). The
// server sends this to that one client each snapshot, so personal data never spams
// everyone: combat HUD + action bar + the player's own bag/equipment + the vendor view.
export interface SelfSnap {
  targetId: number | null; // the player's selected target (authoritative)
  hp: number;
  maxHp: number;
  mp: number;
  maxMp: number;
  level: number;
  xp: number;
  xpToNext: number;
  attrPoints: number;
  gold: number;
  sp: number;
  str: number;
  int: number;
  weaponDamage: number;
  weaponPlus: number;
  botActive: boolean; // whether this player's auto-play is on
  abilities: AbilityView[]; // the action bar with live cooldown/MP/rank state
  inventory: InventoryView; // the player's bag + equipped gear (loot lands here)
  shop: ShopView; // the vendor storefront + whether this player is in range to trade
  party: PartyView | null; // the player's party (members + modes), or null when solo
  invite: PartyInviteView | null; // a pending party invite to accept/refuse, or null
  // --- party matching (lobby) ---
  matching: MatchingEntryView[]; // the public LFM list (same for everyone; for the E window)
  partyRequests: MatchingRequestView[]; // pending join requests to MY party (leader only; else empty)
  myRequestPartyId: number | null; // the party I've asked to join (awaiting approval), or null
}

// Which chat channel a message belongs to: 'say' (everyone) or 'party' (group only).
export type ChatChannel = 'say' | 'party';

// One chat line the server sends out. `from` is the sender's name AS THE SERVER KNOWS IT
// (never trusted from the client). `system` marks a server notice (e.g. join/leave),
// which the UI renders without a "name:" prefix. `channel` lets the UI tag party lines.
export interface ChatLine {
  from: string;
  text: string;
  ts: number; // server timestamp (ms since epoch)
  system?: boolean;
  channel?: ChatChannel; // 'party' lines render with a [Grupo] tag; absent/'say' = normal
}

// ---- server -> client ----
export type ServerMessage =
  | { t: 'welcome'; id: number; snapshotHz: number } // your player id + the snapshot rate (for interpolation)
  | { t: 'snapshot'; entities: EntitySnap[]; events: NetEvent[]; time: number; rain: number } // shared world + events + synchronized time-of-day (0..1) and rain INTENSITY (0..1)
  | { t: 'self'; self: SelfSnap } // YOUR personal HUD/bag state (sent only to you)
  | { t: 'chat'; line: ChatLine }; // a chat line, broadcast to everyone
