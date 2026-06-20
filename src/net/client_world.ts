// The online world: an IWorld backed by server snapshots instead of a local Sim.
// The renderer and HUD don't know the difference — they already talk to IWorld.
//
// It owns the WebSocket, sends the player's INTENT (never a position or a damage
// number), and exposes the latest server state, INTERPOLATED between the last two
// snapshots so movement looks smooth at any framerate. The server is authoritative
// for everything — positions, mobs, AND combat; this only mirrors and renders.
//
// This slice mirrors SHARED MOBS + COMBAT: the snapshot carries players, mobs and the
// town NPC; combat events (damage/death/…) flow through too, so the renderer pops the
// same damage numbers both clients see. Target selection is PREDICTED locally (snappy
// UI) and confirmed by the server, which is the only thing that actually deals damage.
import type {
  IWorld, EntityView, Command, SimEvent, AbilityView, InventoryView, ShopView,
} from '../world_api';
import type { ClientMessage, ServerMessage, EntitySnap } from './protocol';

export type NetStatus = 'connecting' | 'online' | 'offline';

export class ClientWorld implements IWorld {
  readonly tick = 0; // not meaningful online; satisfies IWorld
  status: NetStatus = 'connecting';

  private ws: WebSocket;
  private myId: number | null = null;
  private myTarget: number | null = null; // locally-predicted selection (the server validates)
  private snapIntervalMs = 100; // updated from the server's snapshotHz on welcome
  // the two most recent snapshots, keyed by entity id, that we interpolate between
  private from = new Map<number, EntitySnap>();
  private to = new Map<number, EntitySnap>();
  private events: SimEvent[] = []; // combat events from the LATEST snapshot (drawn once, by seq)
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
    let n = 0;
    for (const e of this.to.values()) if (e.kind === 'player') n++;
    return n;
  }

  // ---- IWorld ----
  localPlayerId(): number | null {
    return this.myId;
  }

  localTargetId(): number | null {
    return this.myTarget;
  }

  // Every entity (players, mobs, the town NPC) at its interpolated position. The
  // renderer draws these straight from IWorld — local player as the Knight, others as
  // capsules, enemies as their avatars, all tinted/scaled by tier/hostile as usual.
  entities(): ReadonlyArray<EntityView> {
    const t = this.snapIntervalMs > 0 ? clamp01((this.nowMs - this.lastSnapMs) / this.snapIntervalMs) : 1;
    const out: EntityView[] = [];
    for (const [id, cur] of this.to) {
      const prev = this.from.get(id) ?? cur; // a brand-new entity has no "from" -> sit still
      out.push(entityView(cur, lerp(prev.x, cur.x, t), lerp(prev.z, cur.z, t), lerpAngle(prev.facing, cur.facing, t)));
    }
    return out;
  }

  // Combat events from the latest snapshot. The host's feedback loop reads these every
  // frame and de-dups by `seq`, so each damage number / death is drawn exactly once.
  recentEvents(): ReadonlyArray<SimEvent> {
    return this.events;
  }

  // No action bar / inventory / shop synced in this slice (loot/XP is the next one).
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

  // The client only ever streams intent. Movement -> move-intent; target selection is
  // predicted locally + sent; ability presses are sent (the SERVER decides the hit).
  // Inventory/loot commands are ignored until that slice ships.
  sendCommand(cmd: Command): void {
    switch (cmd.t) {
      case 'move': this.send({ t: 'move-intent', dx: cmd.dx, dz: cmd.dz }); break;
      case 'stop': this.send({ t: 'move-intent', dx: 0, dz: 0 }); break;
      case 'set-target': this.selectTarget(cmd.id); break;
      case 'cycle-target': this.cycleTargetLocal(); break;
      case 'use-ability': this.send({ t: 'use-ability', slot: cmd.slot }); break;
      default: break; // equip/buy/enhance/sell/etc. — next slice
    }
  }

  // ---- internals ----
  // Predict the selection so the ring/target-frame react instantly; the server gets the
  // same intent and confirms it by auto-attacking that mob (it ignores invalid ids).
  private selectTarget(id: number | null): void {
    this.myTarget = id;
    this.send({ t: 'set-target', id });
  }

  // Tab-cycle among living mobs by distance to us (nearest first, then outward). Done
  // locally from the mirrored world so the UI is instant; the chosen id is sent on.
  private cycleTargetLocal(): void {
    const me = this.myId != null ? this.to.get(this.myId) : undefined;
    if (!me) return;
    const enemies: EntitySnap[] = [];
    for (const e of this.to.values()) if (e.kind === 'enemy' && e.hp > 0) enemies.push(e);
    if (enemies.length === 0) { this.selectTarget(null); return; }
    enemies.sort((a, b) => dist2(me, a) - dist2(me, b));
    const idx = enemies.findIndex((e) => e.id === this.myTarget);
    this.selectTarget(enemies[(idx + 1) % enemies.length].id); // idx -1 -> nearest; else the next one out
  }

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
      // New combat events (tick is irrelevant to a remote client). Drawn once by seq.
      this.events = msg.events.map((ev) => ({ ...ev, tick: 0 }));
      // Drop a target that died or vanished, so the frame matches the live world.
      if (this.myTarget != null) {
        const t = this.to.get(this.myTarget);
        if (!t || t.kind !== 'enemy' || t.hp <= 0) this.myTarget = null;
      }
    }
  }

  private send(msg: ClientMessage): void {
    if (this.ws.readyState === WebSocket.OPEN) this.ws.send(JSON.stringify(msg));
  }
}

// Build a render-ready EntityView from a snapshot entity. Position/orientation are the
// interpolated values; hp/tier/boss/hostile/dead are the authoritative snapshot values;
// everything combat-stat-related (str, mp, xp, …) is left at harmless defaults — none
// of it is synced in this slice and the renderer doesn't need it to draw the entity.
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

const EMPTY_ABILITIES: ReadonlyArray<AbilityView> = [];
const EMPTY_INVENTORY: InventoryView = { capacity: 0, stacks: [], equipment: [] };
const EMPTY_SHOP: ShopView = { name: '', stock: [], inRange: false };

function dist2(a: EntitySnap, b: EntitySnap): number {
  const dx = a.x - b.x;
  const dz = a.z - b.z;
  return dx * dx + dz * dz;
}
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
