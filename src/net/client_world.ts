// The online world: an IWorld backed by server snapshots instead of a local Sim.
// The renderer and HUD don't know the difference — they already talk to IWorld.
//
// It owns the WebSocket, sends the player's INTENT (never a position), and exposes
// the latest server state, INTERPOLATED between the last two snapshots so movement
// looks smooth at any framerate. The server is authoritative; this only renders.
import type {
  IWorld, EntityView, Command, SimEvent, AbilityView, InventoryView, ShopView,
} from '../world_api';
import type { ClientMessage, ServerMessage, PlayerSnap } from './protocol';

export type NetStatus = 'connecting' | 'online' | 'offline';

export class ClientWorld implements IWorld {
  readonly tick = 0; // not meaningful online; satisfies IWorld
  status: NetStatus = 'connecting';

  private ws: WebSocket;
  private myId: number | null = null;
  private snapIntervalMs = 100; // updated from the server's snapshotHz on welcome
  // the two most recent snapshots, keyed by player id, that we interpolate between
  private from = new Map<number, PlayerSnap>();
  private to = new Map<number, PlayerSnap>();
  private nowMs = 0; // a local clock advanced by update(dt)
  private lastSnapMs = 0; // nowMs when `to` arrived

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
    return this.to.size;
  }

  // ---- IWorld ----
  localPlayerId(): number | null {
    return this.myId;
  }

  localTargetId(): number | null {
    return null; // no targeting in the presence foundation
  }

  // Every player, at its interpolated position. The renderer draws these (the local
  // one as the Knight, others as capsules — see desiredRoot).
  entities(): ReadonlyArray<EntityView> {
    const t = this.snapIntervalMs > 0 ? clamp01((this.nowMs - this.lastSnapMs) / this.snapIntervalMs) : 1;
    const out: EntityView[] = [];
    for (const [id, cur] of this.to) {
      const prev = this.from.get(id) ?? cur; // a brand-new player has no "from" -> sit still
      out.push(
        playerView(id, cur.name, lerp(prev.x, cur.x, t), lerp(prev.z, cur.z, t), lerpAngle(prev.facing, cur.facing, t)),
      );
    }
    return out;
  }

  recentEvents(): ReadonlyArray<SimEvent> {
    return EMPTY_EVENTS;
  }

  abilities(): ReadonlyArray<AbilityView> {
    return EMPTY_ABILITIES;
  }

  inventory(): InventoryView {
    return EMPTY_INVENTORY;
  }

  shop(): ShopView {
    return EMPTY_SHOP;
  }

  botActive(): boolean {
    return false;
  }

  // The client only ever streams intent. Movement becomes a move-intent; everything
  // else (target/abilities/etc.) is ignored in this presence-only slice.
  sendCommand(cmd: Command): void {
    if (cmd.t === 'move') this.send({ t: 'move-intent', dx: cmd.dx, dz: cmd.dz });
    else if (cmd.t === 'stop') this.send({ t: 'move-intent', dx: 0, dz: 0 });
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
      this.to = new Map(msg.players.map((p) => [p.id, p]));
      this.lastSnapMs = this.nowMs;
    }
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

// A presence player rendered from a snapshot: real position/orientation, everything
// combat-related left at harmless defaults (no combat is synced in this slice).
function playerView(id: number, name: string, x: number, z: number, facing: number): EntityView {
  return {
    id, kind: 'player', name,
    x, z, facing,
    hp: 100, maxHp: 100, mp: 0, maxMp: 0,
    level: 1, xp: 0, xpToNext: 1, attrPoints: 0,
    gold: 0, sp: 0, str: 0, int: 0, weaponDamage: 0, weaponPlus: 0,
    boss: false, tier: 'normal', hostile: false, dead: false, statuses: [],
  };
}

const EMPTY_EVENTS: ReadonlyArray<SimEvent> = [];
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
function clamp01(v: number): number {
  return v < 0 ? 0 : v > 1 ? 1 : v;
}
