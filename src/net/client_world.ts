// The online world: an IWorld backed by server snapshots instead of a local Sim.
// The renderer and HUD don't know the difference — they already talk to IWorld.
//
// It owns the WebSocket and sends only INTENT (never a position, a hit, loot or XP).
// It exposes:
//   • the SHARED world (players + mobs + NPC), interpolated between snapshots, and the
//     server's combat events — the same for everyone;
//   • the LOCAL player's PERSONAL state (HUD: hp/mp/xp/level, action bar, target, and
//     later bag/shop), streamed by the server to this client only.
// The server is authoritative for everything; this only mirrors and renders.
import type {
  IWorld, EntityView, Command, SimEvent, AbilityView, InventoryView, ShopView, StorageView, TeleporterView,
  PartyView, PartyInviteView, DuelView, DuelInviteView,
} from '../world_api';
import type {
  ClientMessage, ServerMessage, EntitySnap, SelfSnap, ChatLine, ChatChannel,
  MatchingEntryView, MatchingRequestView,
} from './protocol';

export type NetStatus = 'connecting' | 'online' | 'offline';

export class ClientWorld implements IWorld {
  readonly tick = 0; // not meaningful online; satisfies IWorld
  status: NetStatus = 'connecting';

  // Chat is a separate channel from the game world (IWorld) — the UI sets this callback
  // and we invoke it for each chat line the server broadcasts. Not part of IWorld.
  onChat: ((line: ChatLine) => void) | null = null;

  private ws: WebSocket;
  private myId: number | null = null;
  private self: SelfSnap | null = null; // this client's own HUD/bag state (from the server)
  private snapIntervalMs = 100; // updated from the server's snapshotHz on welcome
  // the two most recent snapshots, keyed by entity id, that we interpolate between
  private from = new Map<number, EntitySnap>();
  private to = new Map<number, EntitySnap>();
  private events: SimEvent[] = []; // combat events from the LATEST snapshot (drawn once, by seq)
  private nowMs = 0; // a local clock advanced by update(dt)
  private lastSnapMs = 0; // nowMs when `to` arrived
  // Server-driven day/night + rain (so everyone sees the same sky). Both `time` and the
  // rain INTENSITY (0..1) are interpolated between snapshots for a smooth, gradual sky.
  private fromTime = 0;
  private toTime = 0;
  private fromRain = 0;
  private toRain = 0;
  private hasWeather = false; // false until the first snapshot arrives

  constructor(url: string, private readonly name: string) {
    this.ws = new WebSocket(url);
    this.ws.onopen = () => {
      this.status = 'online';
      this.send({ t: 'join', name: this.name });
    };
    this.ws.onmessage = (e) => this.onMessage(e.data);
    this.ws.onclose = () => { this.status = 'offline'; };
    this.ws.onerror = () => { this.status = 'offline'; };
  }

  // Advance the interpolation clock. Call once per rendered frame.
  update(dt: number): void {
    this.nowMs += dt * 1000;
  }

  playerCount(): number {
    let n = 0;
    for (const e of this.to.values()) if (e.kind === 'player') n++;
    return n;
  }

  // The server-authoritative time-of-day (0..1) + rain INTENSITY (0..1), BOTH interpolated
  // between snapshots for a smooth, gradual sky. Null until the first snapshot. The renderer
  // feeds this into the day/night system in MP so every client shows the SAME sky/weather.
  // (Not part of IWorld — a concrete channel, like the chat — read via the MP loop, not the seam.)
  weather(): { time: number; rain: number } | null {
    if (!this.hasWeather) return null;
    const t = this.snapIntervalMs > 0 ? clamp01((this.nowMs - this.lastSnapMs) / this.snapIntervalMs) : 1;
    return { time: lerpTime(this.fromTime, this.toTime, t), rain: lerp(this.fromRain, this.toRain, t) };
  }

  // ---- IWorld ----
  localPlayerId(): number | null {
    return this.myId;
  }

  localTargetId(): number | null {
    return this.self ? this.self.targetId : null; // authoritative (the server picks it)
  }

  // Every entity (players, mobs, the town NPC) at its interpolated position. The LOCAL
  // player additionally gets its full personal stats merged in (mp/xp/level/…) so the
  // HUD shows the right values; other players carry only their public snapshot fields.
  entities(): ReadonlyArray<EntityView> {
    const t = this.snapIntervalMs > 0 ? clamp01((this.nowMs - this.lastSnapMs) / this.snapIntervalMs) : 1;
    const out: EntityView[] = [];
    for (const [id, cur] of this.to) {
      const prev = this.from.get(id) ?? cur; // a brand-new entity has no "from" -> sit still
      // SNAP a large one-shot jump (teleport / Return recall ~250 units) instead of sliding across the
      // map: when prev->cur far exceeds any per-snapshot walk, render at the destination immediately.
      const warped = (cur.x - prev.x) ** 2 + (cur.z - prev.z) ** 2 > TELEPORT_SNAP_DIST2;
      const x = warped ? cur.x : lerp(prev.x, cur.x, t);
      const z = warped ? cur.z : lerp(prev.z, cur.z, t);
      const facing = warped ? cur.facing : lerpAngle(prev.facing, cur.facing, t);
      const view = entityView(cur, x, z, facing);
      out.push(id === this.myId && this.self ? mergeSelf(view, this.self) : view);
    }
    return out;
  }

  // Combat events from the latest snapshot (drawn once, de-duped by `seq`).
  recentEvents(): ReadonlyArray<SimEvent> {
    return this.events;
  }

  // The local player's action bar, with live cooldown/MP/rank state from the server.
  abilities(): ReadonlyArray<AbilityView> {
    return this.self ? this.self.abilities : EMPTY_ABILITIES;
  }

  // The local player's bag/equipment and the vendor view — streamed in `self`.
  inventory(): InventoryView {
    return this.self ? this.self.inventory : EMPTY_INVENTORY;
  }

  shop(): ShopView {
    return this.self ? this.self.shop : EMPTY_SHOP;
  }

  storage(): StorageView {
    return this.self ? this.self.storage : EMPTY_STORAGE;
  }

  teleporter(): TeleporterView {
    return this.self ? this.self.teleporter : EMPTY_TELEPORTER;
  }

  botActive(): boolean {
    return this.self ? this.self.botActive : false;
  }

  // The local player's party + pending invite — mirrored from the server's `self` state.
  localParty(): PartyView | null {
    return this.self ? this.self.party : null;
  }
  localInvite(): PartyInviteView | null {
    return this.self ? this.self.invite : null;
  }
  // Duel state — mirrored from the server's authoritative `self` snapshot (A3 delivery).
  localDuel(): DuelView | null {
    return this.self ? this.self.duel : null;
  }
  localDuelInvite(): DuelInviteView | null {
    return this.self ? this.self.duelInvite : null;
  }

  // ---- party matching (lobby; concrete MP channel, like chat — not part of IWorld) ----
  // The shared LFM list, this player's pending join requests (leader), and the party it
  // has asked to join — all mirrored from the server's authoritative `self` state.
  matchingList(): MatchingEntryView[] {
    return this.self ? this.self.matching : [];
  }
  partyRequests(): MatchingRequestView[] {
    return this.self ? this.self.partyRequests : [];
  }
  myRequestPartyId(): number | null {
    return this.self ? this.self.myRequestPartyId : null;
  }
  // The local player's level — the matching UI uses it to grey out groups whose level
  // restriction this player doesn't meet (the server is still the authority on the join).
  localLevel(): number {
    return this.self ? this.self.level : 1;
  }

  // Matching intent (the server validates leadership / capacity / level limits / title).
  registerMatching(title: string, minLevel: number, maxLevel: number): void {
    this.send({ t: 'matching-register', title, minLevel, maxLevel });
  }
  unregisterMatching(): void {
    this.send({ t: 'matching-unregister' });
  }
  requestJoinMatching(partyId: number): void {
    this.send({ t: 'matching-request', partyId });
  }
  cancelMatchingRequest(): void {
    this.send({ t: 'matching-cancel' });
  }
  approveJoin(playerId: number): void {
    this.send({ t: 'matching-approve', playerId });
  }
  denyJoin(playerId: number): void {
    this.send({ t: 'matching-deny', playerId });
  }

  // The client only ever streams intent. Movement is a compact move-intent; every other
  // gameplay command is forwarded verbatim (the server whitelists + the sim validates).
  sendCommand(cmd: Command): void {
    if (cmd.t === 'move') this.send({ t: 'move-intent', dx: cmd.dx, dz: cmd.dz });
    else if (cmd.t === 'stop') this.send({ t: 'move-intent', dx: 0, dz: 0 });
    else this.send({ t: 'cmd', cmd });
  }

  // Send a chat message on a channel ('say' = everyone, 'party' = group only). Only the
  // text + channel are sent; the server attributes it to this connection's known name,
  // sanitizes, rate-limits, and routes it (broadcast for 'say', party members for 'party').
  sendChat(text: string, channel: ChatChannel = 'say'): void {
    this.send({ t: 'chat', text, channel });
  }

  // ---- internals ----
  private onMessage(data: unknown): void {
    if (typeof data !== 'string') return;
    let msg: ServerMessage;
    try {
      msg = JSON.parse(data);
    } catch {
      return;
    }
    if (msg.t === 'welcome') {
      this.myId = msg.id;
      if (msg.snapshotHz > 0) this.snapIntervalMs = 1000 / msg.snapshotHz;
    } else if (msg.t === 'snapshot') {
      this.from = this.to; // the previous snapshot becomes the interpolation source
      this.to = new Map(msg.entities.map((e) => [e.id, e]));
      this.lastSnapMs = this.nowMs;
      this.events = msg.events.map((ev) => ({ ...ev, tick: 0 })); // tick is irrelevant remotely
      this.fromTime = this.hasWeather ? this.toTime : msg.time; // 1st snapshot: no source -> sit still
      this.toTime = msg.time;
      this.fromRain = this.hasWeather ? this.toRain : msg.rain;
      this.toRain = msg.rain;
      this.hasWeather = true;
    } else if (msg.t === 'self') {
      this.self = msg.self; // our own HUD/bag state
    } else if (msg.t === 'chat') {
      this.onChat?.(msg.line); // hand the chat line to the UI
    }
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

// Build a render-ready EntityView from a snapshot entity. Position/orientation are the
// interpolated values; hp/tier/boss/hostile/dead are the authoritative snapshot values;
// the combat-stat fields are placeholders here (the LOCAL player overrides them from its
// personal `self` state via mergeSelf; other players don't need them to be drawn).
function entityView(s: EntitySnap, x: number, z: number, facing: number): EntityView {
  return {
    id: s.id, kind: s.kind, name: s.name,
    x, z, facing,
    hp: s.hp, maxHp: s.maxHp, mp: 0, maxMp: 0,
    level: 1, xp: 0, xpToNext: 1, attrPoints: 0,
    gold: 0, sp: 0, str: 0, int: 0, weaponDamage: 0, weaponPlus: s.weaponPlus,
    phyDef: 0, magDef: 0, // K6: placeholders (defesa de jogadores remotos não é exibida, igual str/int)
    boss: s.boss, tier: s.tier, species: s.species, hostile: s.hostile, dead: s.dead, statuses: s.statuses,
    mastery: s.mastery, // the remote player's class skin selector (from the snapshot)
  };
}

// Overlay the local player's personal stats onto its public view (position/name/etc.
// stay from the shared snapshot; the HUD-only numbers come from `self`).
function mergeSelf(v: EntityView, s: SelfSnap): EntityView {
  return {
    ...v,
    hp: s.hp, maxHp: s.maxHp, mp: s.mp, maxMp: s.maxMp,
    level: s.level, xp: s.xp, xpToNext: s.xpToNext, attrPoints: s.attrPoints,
    gold: s.gold, sp: s.sp, str: s.str, int: s.int,
    weaponDamage: s.weaponDamage, weaponPlus: s.weaponPlus,
    phyDef: s.phyDef, magDef: s.magDef, // K6: defesa autoritativa do jogador local (vence o placeholder de entityView)
  };
}

const EMPTY_ABILITIES: ReadonlyArray<AbilityView> = [];
const EMPTY_INVENTORY: InventoryView = { capacity: 0, stacks: [], slots: [], equipment: [] };
const EMPTY_SHOP: ShopView = { name: '', stock: [], inRange: false };
const EMPTY_STORAGE: StorageView = { name: '', capacity: 0, stacks: [], inRange: false }; // capacity 0 like EMPTY_INVENTORY; the panel reads capacity per-update
const EMPTY_TELEPORTER: TeleporterView = { inRange: false, atCityId: null, registeredCityId: 'town', cities: [], returnReady: false, returnBlockedReason: null };
// TP3: snap (don't lerp) an entity whose position jumped more than this between snapshots — a teleport
// or Return recall (~250 units) reads as a one-shot warp, not a glide across the map. Squared units;
// normal walking covers <1 unit per ~100ms snapshot, far below this, so it never trips on real movement.
const TELEPORT_SNAP_DIST2 = 50 * 50;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
function lerpAngle(a: number, b: number, t: number): number {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}
// Interpolate time-of-day on the 0..1 cycle. The clock only moves FORWARD, so a `to`
// that wrapped past midnight (b < a) is carried the short way forward, not backward.
function lerpTime(a: number, b: number, t: number): number {
  let d = b - a;
  if (d < -0.5) d += 1; // b wrapped 0.99 -> 0.01: go forward through midnight
  return ((a + d * t) % 1 + 1) % 1;
}
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
