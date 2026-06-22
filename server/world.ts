// The authoritative shared world — ONE instance for everyone connected. It now runs
// the FULL deterministic sim (`src/sim/`): players, MOBS, and COMBAT all live here, so
// two clients farm the exact same enemies and see the exact same fight. The server is
// the single source of truth; clients send only INTENT and render the snapshots.
//
// Reuse, never fork: this wraps `Sim` (the same code the offline client runs) with
// `spawnLocal=false`, so there's no phantom local player — only the networked clients
// it adds on join. Movement, mob AI, damage, death and respawn are identical online
// and offline because it's literally the same simulation.
import { Sim, DT } from '../src/sim/sim';
import { MAX_PLUS } from '../src/sim/content/enhance';
import type { Command } from '../src/world_api';
import type { EntitySnap, NetEvent, SelfSnap } from '../src/net/protocol';
import type { PlayerSave } from '../src/sim/save';
import { Weather } from './weather';

export class ServerWorld {
  private sim: Sim;
  private lastEventSeq = 0; // highest sim event seq already forwarded to clients

  // Time-of-day + rain are authoritative here too (presentation state, not the sim), so
  // every client renders the SAME sky/weather. Advanced on the tick, sent in the snapshot.
  // `weather` defaults to a standard cycle (handy for tests); the server passes one
  // configured from env. It's advanced on the tick and included in the snapshot.
  constructor(seed: number, private readonly weather: Weather = new Weather(240, 120, 900, 300, 3600, 15)) {
    this.sim = new Sim(seed, /* spawnLocal */ false);
  }

  addPlayer(name: string): number {
    return this.sim.addPlayer(name);
  }

  removePlayer(id: number): void {
    this.sim.removePlayer(id);
  }

  // Persistence passthrough: the server orchestrates the DB; the Sim does the data work.
  // serialize is read-only; restore is defensive (it sanitizes the untrusted DB JSON).
  serializePlayer(id: number): PlayerSave | null {
    return this.sim.serializePlayer(id);
  }
  restorePlayer(id: number, raw: unknown): void {
    this.sim.restorePlayer(id, raw);
  }

  // A movement INTENT: sanitize to a finite, unit-ish DIRECTION (never a position) and
  // hand it to the sim as a held move/stop command. The sim integrates at the fixed
  // speed, so a tampered client can't teleport or speed-hack.
  setIntent(id: number, dx: number, dz: number): void {
    const fx = Number.isFinite(dx) ? clamp(dx, -1, 1) : 0;
    const fz = Number.isFinite(dz) ? clamp(dz, -1, 1) : 0;
    this.sim.sendCommandFor(id, fx === 0 && fz === 0 ? { t: 'stop' } : { t: 'move', dx: fx, dz: fz });
  }

  // A gameplay command from a client. This is the SECURITY BOUNDARY: we accept only a
  // whitelist (expanded layer by layer) and REBUILD a clean command from validated
  // fields — a raw untrusted object never reaches the sim. The Sim then validates the
  // rest (target must be a living enemy; range/cooldown/GCD/MP gate casts; etc.). The
  // client decides nothing — it only asks.
  command(id: number, cmd: Command): void {
    if (!cmd || typeof cmd !== 'object') return;
    switch (cmd.t) {
      // --- Layer 1: combat ---
      case 'set-target':
        if (cmd.id === null || Number.isInteger(cmd.id)) {
          this.sim.sendCommandFor(id, { t: 'set-target', id: cmd.id });
        }
        return;
      case 'cycle-target':
        this.sim.sendCommandFor(id, { t: 'cycle-target' });
        return;
      case 'use-ability':
        if (Number.isInteger(cmd.slot) && cmd.slot >= 1 && cmd.slot <= 9) {
          this.sim.sendCommandFor(id, { t: 'use-ability', slot: cmd.slot });
        }
        return;
      // --- Layer 2: personal progression (XP/level-up flow via `self`; spending here) ---
      case 'spend-attr':
        if (cmd.attr === 'str' || cmd.attr === 'int') {
          this.sim.sendCommandFor(id, { t: 'spend-attr', attr: cmd.attr });
        }
        return;
      case 'rank-up':
        if (Number.isInteger(cmd.slot) && cmd.slot >= 1 && cmd.slot <= 9) {
          this.sim.sendCommandFor(id, { t: 'rank-up', slot: cmd.slot });
        }
        return;
      // --- Layer 3: inventory + economy (the sim re-validates ownership/gold/range/cap) ---
      case 'equip':
        if (validItemRef(cmd.itemId, cmd.rarity, cmd.plus)) {
          this.sim.sendCommandFor(id, { t: 'equip', itemId: cmd.itemId, rarity: cmd.rarity, plus: cmd.plus });
        }
        return;
      case 'unequip':
        if (VALID_SLOTS.has(cmd.slot)) this.sim.sendCommandFor(id, { t: 'unequip', slot: cmd.slot });
        return;
      case 'enhance':
        if (VALID_SLOTS.has(cmd.slot) && typeof cmd.useLuckyPowder === 'boolean') {
          this.sim.sendCommandFor(id, { t: 'enhance', slot: cmd.slot, useLuckyPowder: cmd.useLuckyPowder });
        }
        return;
      case 'repair':
        if (VALID_SLOTS.has(cmd.slot)) this.sim.sendCommandFor(id, { t: 'repair', slot: cmd.slot });
        return;
      case 'use-item':
        if (validItemRef(cmd.itemId, cmd.rarity, cmd.plus)) {
          this.sim.sendCommandFor(id, { t: 'use-item', itemId: cmd.itemId, rarity: cmd.rarity, plus: cmd.plus });
        }
        return;
      case 'buy':
        if (typeof cmd.itemId === 'string' && cmd.itemId.length <= 64) {
          this.sim.sendCommandFor(id, { t: 'buy', itemId: cmd.itemId });
        }
        return;
      case 'sell':
        if (validItemRef(cmd.itemId, cmd.rarity, cmd.plus)) {
          this.sim.sendCommandFor(id, { t: 'sell', itemId: cmd.itemId, rarity: cmd.rarity, plus: cmd.plus });
        }
        return;
      // --- Layer 4: auto-play (each player toggles ITS OWN bot) ---
      case 'set-bot':
        if (typeof cmd.on === 'boolean') this.sim.sendCommandFor(id, { t: 'set-bot', on: cmd.on });
        return;
      default:
        return; // unknown / unsupported command — ignored
    }
  }

  // Advance the shared world one fixed tick (players + mobs + combat), and the
  // time-of-day + weather clock by the same tick so it stays in lockstep.
  step(): void {
    this.sim.step();
    this.weather.step(DT);
  }

  // A player's OWN state (HUD + action bar). The server sends this to that one client
  // each snapshot — personal data never spams everyone. Combat HUD + bar for now;
  // inventory/shop join in a later layer.
  selfState(id: number): SelfSnap {
    const abilities = [...this.sim.abilitiesFor(id)];
    const inventory = this.sim.inventoryFor(id); // this player's own bag + gear (its loot)
    const shop = this.sim.shopFor(id); // the vendor view (inRange depends on this player)
    const e = this.sim.entities().find((v) => v.id === id);
    if (!e) {
      return {
        targetId: null, hp: 0, maxHp: 0, mp: 0, maxMp: 0, level: 1, xp: 0, xpToNext: 1,
        attrPoints: 0, gold: 0, sp: 0, str: 0, int: 0, weaponDamage: 0, weaponPlus: 0,
        botActive: false, abilities, inventory, shop,
      };
    }
    return {
      targetId: this.sim.targetOf(id),
      hp: e.hp, maxHp: e.maxHp, mp: e.mp, maxMp: e.maxMp,
      level: e.level, xp: e.xp, xpToNext: e.xpToNext, attrPoints: e.attrPoints,
      gold: e.gold, sp: e.sp, str: e.str, int: e.int,
      weaponDamage: e.weaponDamage, weaponPlus: e.weaponPlus,
      botActive: this.sim.botActiveFor(id),
      abilities, inventory, shop,
    };
  }

  // The shared world (players + mobs + the town NPC), plus the combat events the sim
  // produced SINCE the last snapshot (so every client draws each damage number / death
  // exactly once). Numbers are rounded to keep the message small.
  snapshot(): { entities: EntitySnap[]; events: NetEvent[]; time: number; rain: number } {
    const entities: EntitySnap[] = [];
    for (const e of this.sim.entities()) {
      entities.push({
        id: e.id,
        kind: e.kind,
        name: e.name,
        x: round(e.x),
        z: round(e.z),
        facing: round(e.facing),
        hp: Math.round(e.hp),
        maxHp: Math.round(e.maxHp),
        tier: e.tier,
        boss: e.boss,
        species: e.species,
        hostile: e.hostile,
        dead: e.dead,
        weaponPlus: e.weaponPlus, // so OTHER players' weapon glow renders (not just the local one)
        statuses: [...e.statuses], // so stun/slow/bleed indicators show on every entity in MP
      });
    }
    const events: NetEvent[] = [];
    for (const ev of this.sim.recentEvents()) {
      if (ev.seq <= this.lastEventSeq) continue; // already sent (events are seq-ascending)
      this.lastEventSeq = ev.seq;
      events.push({
        seq: ev.seq,
        kind: ev.kind,
        targetId: ev.targetId,
        amount: ev.amount,
        x: round(ev.x),
        z: round(ev.z),
        text: ev.text,
      });
    }
    // Time-of-day + rain INTENSITY (0..1), both rounded — the same for every client, so
    // the world's sky/weather is synchronized. The client interpolates both between snapshots.
    return { entities, events, time: round(this.weather.timeOfDay), rain: round(this.weather.rainIntensity) };
  }

  playerCount(): number {
    return this.sim.players().length;
  }
}

const VALID_SLOTS: ReadonlySet<string> = new Set(['weapon', 'armor']);
const VALID_RARITIES: ReadonlySet<string> = new Set(['normal', 'sos', 'som', 'sun']);

// A bag/equip item reference from a client: a non-empty bounded item id, a real rarity,
// and a non-negative integer "+N". The sim STILL re-checks the player actually owns it
// (and gold/range/cap), so this only rejects obviously-malformed input at the boundary.
function validItemRef(itemId: unknown, rarity: unknown, plus: unknown): boolean {
  return (
    typeof itemId === 'string' && itemId.length > 0 && itemId.length <= 64 &&
    typeof rarity === 'string' && VALID_RARITIES.has(rarity) &&
    Number.isInteger(plus) && (plus as number) >= 0 && (plus as number) <= MAX_PLUS
  );
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

function round(v: number): number {
  return Math.round(v * 1000) / 1000; // 3 decimals is plenty for positions/radians
}
