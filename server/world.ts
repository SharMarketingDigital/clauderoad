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
import { EQUIP_SLOTS } from '../src/sim/inventory';
import type { Command, PartyView, EntityView } from '../src/world_api';
import type { EntitySnap, NetEvent, SelfSnap, MatchingEntryView, MatchingRequestView } from '../src/net/protocol';
import type { PlayerSave } from '../src/sim/save';
import { Weather } from './weather';
import { MatchingRegistry } from './matching';
import { GuildRegistry, type Guild } from './guilds';

export class ServerWorld {
  private sim: Sim;
  private lastEventSeq = 0; // highest sim event seq already forwarded to clients
  // Party matching (LFM lobby): SERVER state, not the sim. Listings + pending join
  // requests; a listing self-expires after ~1h. The actual join is a sim command issued
  // on approval (party-admit), so the sim stays authoritative over membership.
  private matching = new MatchingRegistry(MATCHING_TTL_MS);
  // Guildas (GDD v0.5 §1): the social registry (roster + /g chat). SERVER state like matching — never
  // touches the deterministic sim (no gameplay coupling in this pass; warehouse/war/persistence deferred).
  private guilds = new GuildRegistry();

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
    // Clean up the lobby BEFORE the sim drops them: remove their listing (if they led one)
    // and any pending request they had. The per-tick reconcile is the backstop for the gap.
    const pv = this.sim.partyViewFor(id);
    if (pv && this.isLeader(pv, id)) this.matching.unregister(pv.id);
    this.matching.forgetPlayer(id);
    this.guilds.forgetPlayer(id); // Guildas: a disconnecting member leaves (owner-leave promotes/dissolves)
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
        if (VALID_SLOTS.has(cmd.slot)) {
          // optional drag target slot; the sim re-validates bounds + that the slot is empty
          const toBagSlot = typeof cmd.toBagSlot === 'number' && Number.isInteger(cmd.toBagSlot) ? cmd.toBagSlot : undefined;
          this.sim.sendCommandFor(id, { t: 'unequip', slot: cmd.slot, toBagSlot });
        }
        return;
      case 'move-item':
        // positional bag rearrange; the sim re-validates the indices + a non-empty source
        if (Number.isInteger(cmd.from) && Number.isInteger(cmd.to)) {
          this.sim.sendCommandFor(id, { t: 'move-item', from: cmd.from, to: cmd.to });
        }
        return;
      case 'enhance':
        if (VALID_SLOTS.has(cmd.slot)
          && (cmd.useProtection === undefined || typeof cmd.useProtection === 'boolean')) {
          // K4: forward useProtection — dropping it would silently disable protection
          // online (the K1 whitelist bug). The sim re-validates that a stone is held.
          this.sim.sendCommandFor(id, {
            t: 'enhance', slot: cmd.slot, useProtection: cmd.useProtection,
          });
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
      case 'select-class':
        // The sim resolves the class -> starter weapon and only applies it to a fresh
        // (unarmed) character, so this can't be abused to re-roll an equipped weapon.
        if (typeof cmd.classId === 'string' && cmd.classId.length > 0 && cmd.classId.length <= 32) {
          this.sim.sendCommandFor(id, { t: 'select-class', classId: cmd.classId });
        }
        return;
      // K5: warehouse deposit/withdraw — mirror sell's wire validation (without the explicit
      // case here the default branch silently drops these online — the K1 whitelist lesson).
      case 'deposit':
        if (validItemRef(cmd.itemId, cmd.rarity, cmd.plus)) {
          this.sim.sendCommandFor(id, { t: 'deposit', itemId: cmd.itemId, rarity: cmd.rarity, plus: cmd.plus });
        }
        return;
      case 'withdraw':
        if (validItemRef(cmd.itemId, cmd.rarity, cmd.plus)) {
          this.sim.sendCommandFor(id, { t: 'withdraw', itemId: cmd.itemId, rarity: cmd.rarity, plus: cmd.plus });
        }
        return;
      // Pets PET2 (GDD v0.5 §4): bag <-> transport pet's bag (the sim re-checks ownership + that a pet is out).
      case 'pet-deposit':
        if (validItemRef(cmd.itemId, cmd.rarity, cmd.plus)) {
          this.sim.sendCommandFor(id, { t: 'pet-deposit', itemId: cmd.itemId, rarity: cmd.rarity, plus: cmd.plus });
        }
        return;
      case 'pet-withdraw':
        if (validItemRef(cmd.itemId, cmd.rarity, cmd.plus)) {
          this.sim.sendCommandFor(id, { t: 'pet-withdraw', itemId: cmd.itemId, rarity: cmd.rarity, plus: cmd.plus });
        }
        return;
      // --- Layer 4: auto-play (each player toggles ITS OWN bot) ---
      case 'set-bot':
        if (typeof cmd.on === 'boolean') this.sim.sendCommandFor(id, { t: 'set-bot', on: cmd.on });
        return;
      // PK livre (GDD v0.5 §2): the held ALT/PK modifier. Validate the boolean and forward; the sim
      // gates the actual PvP eligibility (canAttack: PK flag + both outside a city safe-zone).
      case 'set-pk':
        if (typeof cmd.on === 'boolean') this.sim.sendCommandFor(id, { t: 'set-pk', on: cmd.on });
        return;
      // Pets (GDD v0.5 §4): summon/dismiss the owned pet. Validate the boolean and forward; the sim
      // checks the player actually owns a pet item before spawning the follower.
      case 'set-pet':
        if (typeof cmd.on === 'boolean') this.sim.sendCommandFor(id, { t: 'set-pet', on: cmd.on });
        return;
      // Stalls (GDD v0.5 §5): rebuild a CLEAN listings array from validated fields; the sim re-checks
      // ownership + a positive-int price. stall-buy validates the seller id + the item ref.
      case 'stall-open': {
        if (!Array.isArray(cmd.listings)) return;
        const listings = cmd.listings
          .filter((l) => l != null && validItemRef(l.itemId, l.rarity, l.plus) && Number.isInteger(l.price) && l.price > 0)
          .slice(0, 24)
          .map((l) => ({ itemId: l.itemId, rarity: l.rarity, plus: l.plus, price: l.price }));
        this.sim.sendCommandFor(id, { t: 'stall-open', listings });
        return;
      }
      case 'stall-close':
        this.sim.sendCommandFor(id, { t: 'stall-close' });
        return;
      case 'stall-buy':
        if (Number.isInteger(cmd.sellerId) && validItemRef(cmd.itemId, cmd.rarity, cmd.plus)) {
          this.sim.sendCommandFor(id, { t: 'stall-buy', sellerId: cmd.sellerId, itemId: cmd.itemId, rarity: cmd.rarity, plus: cmd.plus });
        }
        return;
      // --- Party / co-op (GDD B6): the sim validates leader/capacity/membership ---
      case 'party-create':
        if (PARTY_EXP.has(cmd.exp) && PARTY_LOOT.has(cmd.loot)) {
          this.sim.sendCommandFor(id, { t: 'party-create', exp: cmd.exp, loot: cmd.loot });
        }
        return;
      case 'party-invite':
        if (typeof cmd.name === 'string' && cmd.name.length > 0 && cmd.name.length <= 24) {
          this.sim.sendCommandFor(id, { t: 'party-invite', name: cmd.name });
        }
        return;
      case 'party-accept':
        this.sim.sendCommandFor(id, { t: 'party-accept' });
        return;
      case 'party-refuse':
        this.sim.sendCommandFor(id, { t: 'party-refuse' });
        return;
      case 'party-leave':
        this.sim.sendCommandFor(id, { t: 'party-leave' });
        return;
      case 'party-kick':
        if (Number.isInteger(cmd.id)) this.sim.sendCommandFor(id, { t: 'party-kick', id: cmd.id });
        return;
      // --- PvP duel (Tier 1): consensual 1v1; the sim validates the pairing/eligibility ---
      case 'duel-challenge':
        if (typeof cmd.name === 'string' && cmd.name.length > 0 && cmd.name.length <= 24) {
          this.sim.sendCommandFor(id, { t: 'duel-challenge', name: cmd.name });
        }
        return;
      case 'duel-accept':
        this.sim.sendCommandFor(id, { t: 'duel-accept' });
        return;
      case 'duel-decline':
        this.sim.sendCommandFor(id, { t: 'duel-decline' });
        return;
      // --- teleporte entre cidades (v0.5): viajar do NPC da cidade; a sim valida proximidade + gold + destino ---
      case 'teleport':
        if (typeof cmd.cityId === 'string' && cmd.cityId.length > 0 && cmd.cityId.length <= 32) {
          this.sim.sendCommandFor(id, { t: 'teleport', cityId: cmd.cityId });
        }
        return;
      // --- cadastrar cidade de retorno (v0.5 TP2): registra o hub onde o jogador está (sem args; a sim valida proximidade) ---
      case 'register-city':
        this.sim.sendCommandFor(id, { t: 'register-city' });
        return;
      // --- return/recall (v0.5 TP2): warp grátis pra cidade cadastrada de qualquer lugar; a sim valida cooldown + combate ---
      case 'return':
        this.sim.sendCommandFor(id, { t: 'return' });
        return;
      // --- pegar loot do chão (v0.5 loot físico LF-S2): a sim valida que é loot + o alcance + bolsa cheia ---
      case 'pickup':
        if (typeof cmd.lootId === 'number' && Number.isFinite(cmd.lootId)) {
          this.sim.sendCommandFor(id, { t: 'pickup', lootId: cmd.lootId });
        }
        return;
      // --- pegar TODO o loot no alcance (tecla G): a sim valida alcance/bolsa por item ---
      case 'pickup-nearby':
        this.sim.sendCommandFor(id, { t: 'pickup-nearby' });
        return;
      default:
        return; // unknown / unsupported command — ignored
    }
  }

  // Advance the shared world one fixed tick (players + mobs + combat), and the
  // time-of-day + weather clock by the same tick so it stays in lockstep. `now` (server
  // wall-clock, injected so tests can drive the matching expiry deterministically) only
  // reconciles the LOBBY — it never reaches the deterministic sim.
  step(now: number = Date.now()): void {
    this.sim.step();
    this.weather.step(DT);
    this.reconcileMatching(now);
  }

  // ---- Party matching (lobby) — SERVER-authoritative, OUTSIDE the sim ----
  // Leader lists their party as "looking for members". Title is sanitized; the levels are
  // clamped to non-negative ints (0 = no bound). Requires leading a not-yet-full party.
  registerMatching(id: number, title: unknown, minLevel: unknown, maxLevel: unknown, now: number): void {
    const pv = this.sim.partyViewFor(id);
    if (!pv || !this.isLeader(pv, id)) return; // must lead a party
    if (pv.members.length >= pv.maxMembers) return; // already full — nothing to advertise
    let lo = clampLevel(minLevel);
    let hi = clampLevel(maxLevel);
    if (hi > 0 && lo > hi) [lo, hi] = [hi, lo]; // an inverted range (e.g. 50–10) is surely a typo — normalize
    this.matching.register(pv.id, id, sanitizeTitle(title), lo, hi, now);
  }

  // Leader removes their party's listing.
  unregisterMatching(id: number): void {
    const pv = this.sim.partyViewFor(id);
    if (pv && this.isLeader(pv, id)) this.matching.unregister(pv.id);
  }

  // A player asks to join a listed party. Validated: requester is ungrouped + online, the
  // party is still listed + not full, and the requester meets the level restriction.
  requestJoin(id: number, partyId: unknown): void {
    if (!Number.isInteger(partyId)) return;
    const pid = partyId as number;
    if (this.sim.partyViewFor(id)) return; // already grouped -> can't request
    const me = this.entity(id);
    if (!me) return;
    const entry = this.matching.get(pid);
    if (!entry) return; // not listed
    const target = this.sim.partyViewFor(entry.leaderId);
    if (!target || target.id !== pid || target.members.length >= target.maxMembers) return; // gone / full
    if (entry.minLevel > 0 && me.level < entry.minLevel) return; // below the floor
    if (entry.maxLevel > 0 && me.level > entry.maxLevel) return; // above the cap
    this.matching.requestJoin(id, pid);
  }

  // The requester withdraws their own pending request.
  cancelJoinRequest(id: number): void {
    this.matching.cancelRequest(id);
  }

  // Leader approves a pending request -> issue the authoritative party-admit to the sim
  // (the membership change lands on the next tick). Re-validates leadership + capacity +
  // that the requester is still waiting and hasn't grouped elsewhere meanwhile.
  approveJoin(id: number, playerId: unknown): void {
    if (!Number.isInteger(playerId)) return;
    const pid = playerId as number;
    const pv = this.sim.partyViewFor(id);
    if (!pv || !this.isLeader(pv, id)) return; // only the leader approves
    if (!this.matching.hasRequest(pid, pv.id)) return; // no such request to my party
    this.matching.cancelRequest(pid); // consume it either way
    if (pv.members.length >= pv.maxMembers) return; // full now -> request just dropped
    if (this.sim.partyViewFor(pid)) return; // grouped meanwhile -> request just dropped
    this.sim.sendCommandFor(id, { t: 'party-admit', playerId: pid });
  }

  // Leader declines a pending request (drops it).
  denyJoin(id: number, playerId: unknown): void {
    if (!Number.isInteger(playerId)) return;
    const pid = playerId as number;
    const pv = this.sim.partyViewFor(id);
    if (pv && this.isLeader(pv, id) && this.matching.hasRequest(pid, pv.id)) this.matching.cancelRequest(pid);
  }

  // Self-clean the lobby each tick: expire stale listings, drop listings whose party
  // vanished / changed leader / filled up, and drop requests from players who left or
  // have since grouped. Cheap (the lists are tiny) and keeps the list always-truthful.
  private reconcileMatching(now: number): void {
    this.matching.expire(now);
    for (const e of this.matching.list()) {
      const pv = this.sim.partyViewFor(e.leaderId);
      const valid = pv && pv.id === e.partyId && this.isLeader(pv, e.leaderId) && pv.members.length < pv.maxMembers;
      if (!valid) this.matching.unregister(e.partyId);
    }
    for (const e of this.matching.list()) {
      for (const reqId of [...this.matching.requestersOf(e.partyId)]) {
        if (!this.entity(reqId) || this.sim.partyViewFor(reqId)) this.matching.cancelRequest(reqId);
      }
    }
  }

  // The public LFM list (same for everyone), joining the lobby metadata with the LIVE
  // party state from the sim (size / leader name / type).
  matchingList(): MatchingEntryView[] {
    const out: MatchingEntryView[] = [];
    for (const e of this.matching.list()) {
      const pv = this.sim.partyViewFor(e.leaderId);
      if (!pv || pv.id !== e.partyId) continue; // stale (reconcile removes it next tick)
      const leader = pv.members.find((m) => m.leader);
      out.push({
        partyId: e.partyId,
        leaderName: leader?.name ?? '',
        title: e.title,
        expMode: pv.expMode,
        members: pv.members.length,
        maxMembers: pv.maxMembers,
        minLevel: e.minLevel,
        maxLevel: e.maxLevel,
      });
    }
    return out;
  }

  // Pending join requests to `id`'s party (empty unless `id` is a leader with requests).
  requestsFor(id: number): MatchingRequestView[] {
    const pv = this.sim.partyViewFor(id);
    if (!pv || !this.isLeader(pv, id)) return [];
    const out: MatchingRequestView[] = [];
    for (const reqId of this.matching.requestersOf(pv.id)) {
      const e = this.entity(reqId);
      if (e) out.push({ playerId: reqId, name: e.name, level: e.level });
    }
    return out;
  }

  // The party id `id` has asked to join (awaiting approval), or null.
  myRequestPartyId(id: number): number | null {
    return this.matching.requestOf(id);
  }

  private isLeader(pv: PartyView, id: number): boolean {
    return pv.members.some((m) => m.id === id && m.leader);
  }
  private entity(id: number): EntityView | undefined {
    return this.sim.entities().find((e) => e.id === id);
  }

  // A player's OWN state (HUD + action bar). The server sends this to that one client
  // each snapshot — personal data never spams everyone. Combat HUD + bar for now;
  // inventory/shop join in a later layer.
  selfState(id: number): SelfSnap {
    const abilities = [...this.sim.abilitiesFor(id)];
    const inventory = this.sim.inventoryFor(id); // this player's own bag + gear (its loot)
    const shop = this.sim.shopFor(id); // the vendor view (inRange depends on this player)
    const storage = this.sim.storageFor(id); // K5: the player's warehouse view (inRange too)
    const stall = this.sim.stallFor(id); // GDD v0.5 (Stalls): the open stall this player is near, or null
    const petBag = this.sim.petBagFor(id); // GDD v0.5 (Pets PET2): the transport pet's portable bag view
    const teleporter = this.sim.teleporterFor(id); // TP3: city list + register/Return state for this player
    const e = this.sim.entities().find((v) => v.id === id);
    // Party state is the same for either branch (it survives a dead/missing entity view).
    const party = this.sim.partyViewFor(id);
    const invite = this.sim.inviteViewFor(id);
    // Party-matching lobby state: the shared LFM list (for the E window) + this player's
    // own request/leader-request state. Server state, joined with live sim party data.
    const matching = this.matchingList();
    const partyRequests = this.requestsFor(id);
    const myRequestPartyId = this.matching.requestOf(id);
    // PvP duel state (Tier 1) — authoritative in the sim; delivered to the owner like party/invite.
    const duel = this.sim.duelViewFor(id);
    const duelInvite = this.sim.duelInviteViewFor(id);
    if (!e) {
      return {
        targetId: null, hp: 0, maxHp: 0, mp: 0, maxMp: 0, level: 1, xp: 0, xpToNext: 1,
        attrPoints: 0, gold: 0, sp: 0, str: 0, int: 0, weaponDamage: 0, weaponPlus: 0,
        phyDef: 0, magDef: 0,
        botActive: false, petActive: false, abilities, inventory, shop, storage, petBag, stall, teleporter, party, invite,
        matching, partyRequests, myRequestPartyId, duel, duelInvite,
      };
    }
    return {
      targetId: this.sim.targetOf(id),
      hp: e.hp, maxHp: e.maxHp, mp: e.mp, maxMp: e.maxMp,
      level: e.level, xp: e.xp, xpToNext: e.xpToNext, attrPoints: e.attrPoints,
      gold: e.gold, sp: e.sp, str: e.str, int: e.int,
      weaponDamage: e.weaponDamage, weaponPlus: e.weaponPlus,
      phyDef: e.phyDef, magDef: e.magDef, // K6: defesa efetiva do jogador (e é o EntityView)
      botActive: this.sim.botActiveFor(id),
      petActive: this.sim.petActiveFor(id), // GDD v0.5 (Pets): summon/dismiss state for the HUD toggle
      abilities, inventory, shop, storage, petBag, stall, teleporter, party, invite,
      matching, partyRequests, myRequestPartyId, duel, duelInvite,
    };
  }

  // The shared world (players + mobs + the town NPC), plus the combat events the sim
  // produced SINCE the last snapshot (so every client draws each damage number / death
  // exactly once). Numbers are rounded to keep the message small.
  snapshot(): { entities: EntitySnap[]; events: NetEvent[]; time: number; rain: number } {
    const entities: EntitySnap[] = [];
    for (const e of this.sim.entities()) {
      const snap: EntitySnap = {
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
        mastery: e.mastery, // so each remote player renders with their class skin
      };
      // GDD v0.5 (loot físico): only loot entities carry their dropped contents, so a remote client sees
      // what's on the ground (name/rarity/+N/qty). Everyone else omits it to keep the snapshot lean.
      // e.loot is already the GroundLootView built by the sim's entity projection — copy it verbatim.
      if (e.loot) snap.loot = e.loot;
      // GDD v0.5 (PK livre): only PK-armed players carry the public flag (snapshot stays lean), so remote
      // clients can mark the dangerous player. e.pkActive is the EntityView's boolean.
      if (e.pkActive) snap.pk = true;
      if (e.stallOpen) snap.stallOpen = true; // GDD v0.5 (Stalls): only sellers carry the public flag
      entities.push(snap);
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

  // The player ids of everyone in `id`'s party (empty when solo) — used to route party
  // chat ('/p') only to group members. Read-only (does not mutate the sim).
  partyMemberIds(id: number): number[] {
    return this.sim.partyViewFor(id)?.members.map((m) => m.id) ?? [];
  }

  // ---- Guildas (GDD v0.5 §1) — SERVER-side social registry (roster + /g chat), validated here ----
  // Create a guild owned by `id`. Returns the created guild, or null (name in use / already in a guild).
  createGuild(id: number, name: unknown): Guild | null {
    if (typeof name !== 'string') return null;
    return this.guilds.create(id, sanitizeGuildName(name));
  }
  // Owner invites an ONLINE player BY NAME. Returns the invitee id + guild, or null (not owner / not found
  // / target already grouped). Name resolution mirrors the party invite-by-name (first online match).
  inviteToGuild(ownerId: number, name: unknown): { inviteeId: number; guild: Guild } | null {
    if (typeof name !== 'string') return null;
    const inviteeId = this.playerIdByName(name);
    if (inviteeId == null) return null;
    const guild = this.guilds.invite(ownerId, inviteeId);
    return guild ? { inviteeId, guild } : null;
  }
  acceptGuildInvite(id: number): Guild | null {
    return this.guilds.accept(id);
  }
  declineGuildInvite(id: number): void {
    this.guilds.decline(id);
  }
  leaveGuild(id: number): Guild | null {
    return this.guilds.leave(id);
  }
  kickFromGuild(ownerId: number, name: unknown): { targetId: number; guild: Guild } | null {
    if (typeof name !== 'string') return null;
    const targetId = this.playerIdByName(name);
    if (targetId == null) return null;
    const guild = this.guilds.kick(ownerId, targetId);
    return guild ? { targetId, guild } : null;
  }
  // The current guild of `id` (name + member ids), or null — for chat routing + feedback messages.
  guildOf(id: number): Guild | null {
    return this.guilds.guildOf(id);
  }
  // The player ids in `id`'s guild (empty when guildless) — routes /g chat, like partyMemberIds.
  guildMemberIds(id: number): number[] {
    return this.guilds.membersOf(id);
  }
  // Resolve an ONLINE player by name (first match wins — names aren't unique without auth, mirroring the
  // party/duel invite-by-name resolution). Returns its id, or null when no online player has that name.
  private playerIdByName(name: string): number | null {
    const n = name.trim();
    if (!n) return null;
    for (const e of this.sim.entities()) {
      if (e.kind === 'player' && e.name === n) return e.id;
    }
    return null;
  }
}

// Derived from the single EQUIP_SLOTS source (the full Silkroad set), so the server's
// input whitelist accepts every equip slot the sim knows — never a hand-written subset
// that silently drops 9 of 10 slots online (K1: was {'weapon','armor'}).
const VALID_SLOTS: ReadonlySet<string> = new Set(EQUIP_SLOTS);
const VALID_RARITIES: ReadonlySet<string> = new Set(['normal', 'sos', 'som', 'sun']);
const PARTY_EXP: ReadonlySet<string> = new Set(['each-get', 'auto-share']);
const PARTY_LOOT: ReadonlySet<string> = new Set(['distribution', 'auto-share']);

// Party-matching lobby tunables. A listing self-expires after ~1h (Silkroad); titles are
// bounded short text. Both are server-side (the lobby never touches the deterministic sim).
const MATCHING_TTL_MS = 60 * 60 * 1000; // ~1 hour
const MATCHING_TITLE_MAX = 40;

// A matching title from a client: a short, single-line, trimmed string (never trusted).
function sanitizeTitle(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  return raw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, MATCHING_TITLE_MAX);
}
// A guild name from a client: a short, single-line, trimmed string (never trusted). Empty names are
// rejected by the registry (create returns null), so a blank/garbage name simply can't form a guild.
function sanitizeGuildName(raw: string): string {
  return raw.replace(/[\r\n\t]+/g, ' ').trim().slice(0, 24);
}
// A level restriction from a client: a non-negative integer (0 = no bound), capped sane.
function clampLevel(raw: unknown): number {
  const n = Number(raw);
  if (!Number.isFinite(n)) return 0;
  const i = Math.floor(n);
  return i < 0 ? 0 : i > 999 ? 999 : i;
}

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
