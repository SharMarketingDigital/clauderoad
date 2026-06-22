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
  IWorld, EntityView, Command, SimEvent, AbilityView, InventoryView, ShopView,
} from '../world_api';
import type { ClientMessage, ServerMessage, EntitySnap, SelfSnap, ChatLine } from './protocol';

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
  // Server-driven day/night + rain (so everyone sees the same sky). `time` is
  // interpolated between snapshots; raining is the latest (the renderer eases the fade).
  private fromTime = 0;
  private toTime = 0;
  private raining = false;
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

  // The server-authoritative time-of-day (0..1, interpolated between snapshots) + rain
  // flag. Null until the first snapshot. The renderer feeds this into the day/night
  // system in MP so every client shows the SAME sky/weather. (Not part of IWorld — a
  // concrete channel, like the chat — so render reads it via the MP loop, not the seam.)
  weather(): { time: number; raining: boolean } | null {
    if (!this.hasWeather) return null;
    const t = this.snapIntervalMs > 0 ? clamp01((this.nowMs - this.lastSnapMs) / this.snapIntervalMs) : 1;
    return { time: lerpTime(this.fromTime, this.toTime, t), raining: this.raining };
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
      const view = entityView(cur, lerp(prev.x, cur.x, t), lerp(prev.z, cur.z, t), lerpAngle(prev.facing, cur.facing, t));
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

  botActive(): boolean {
    return this.self ? this.self.botActive : false;
  }

  // The client only ever streams intent. Movement is a compact move-intent; every other
  // gameplay command is forwarded verbatim (the server whitelists + the sim validates).
  sendCommand(cmd: Command): void {
    if (cmd.t === 'move') this.send({ t: 'move-intent', dx: cmd.dx, dz: cmd.dz });
    else if (cmd.t === 'stop') this.send({ t: 'move-intent', dx: 0, dz: 0 });
    else this.send({ t: 'cmd', cmd });
  }

  // Send a chat message. Only the text is sent; the server attributes it to this
  // connection's known name, sanitizes, rate-limits, and rebroadcasts to everyone.
  sendChat(text: string): void {
    this.send({ t: 'chat', text });
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
      this.raining = msg.raining;
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
    gold: 0, sp: 0, str: 0, int: 0, weaponDamage: 0, weaponPlus: 0,
    boss: s.boss, tier: s.tier, hostile: s.hostile, dead: s.dead, statuses: [],
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
  };
}

const EMPTY_ABILITIES: ReadonlyArray<AbilityView> = [];
const EMPTY_INVENTORY: InventoryView = { capacity: 0, stacks: [], equipment: [] };
const EMPTY_SHOP: ShopView = { name: '', stock: [], inRange: false };

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
