// Authoritative game server. Accepts WebSocket connections, runs ONE shared Sim (players
// + mobs + combat) at a fixed tick (reusing src/sim/), syncs weather + chat, PERSISTS each
// character to Postgres, and streams snapshots to everyone. The server decides everything;
// clients only send intent.
//
// Config is via environment variables (nothing sensitive in code — see .env.example):
//   PORT             (default 8080)      — TCP port to listen on
//   HOST             (default 0.0.0.0)   — bind address (0.0.0.0 accepts external conns)
//   SNAPSHOT_HZ      (default 10)        — snapshots broadcast per second
//   DATABASE_URL     (optional)          — Postgres for character persistence. UNSET =>
//                                          in-memory (no save). A SECRET — never logged.
//   SAVE_INTERVAL_SECONDS       (30)     — how often connected characters are saved
//   CHAT_MAX_LEN     (default 200)       — max chat message length (chars)
//   CHAT_RATE_PER_SEC(default 3)         — anti-flood: max chat messages per player per second
//   WEATHER_DAY_SECONDS         (240)    — full day/night cycle length (seconds)
//   WEATHER_RAIN_MIN_SECONDS    (120)    — shortest shower; each shower is random in [MIN,MAX]
//   WEATHER_RAIN_MAX_SECONDS    (900)    — CAP on a shower (15 min)
//   WEATHER_CLEAR_MIN_SECONDS   (300)    — shortest dry spell; each is random in [MIN,MAX]
//   WEATHER_CLEAR_MAX_SECONDS   (3600)   — CAP on a dry spell (60 min)
//   WEATHER_RAIN_RAMP_SECONDS   (15)     — seconds rain takes to gradually arrive/clear
//   ALLOWED_ORIGINS  (default: empty)    — comma-separated list of allowed browser
//                                          Origins. Set in PRODUCTION (e.g. the Vercel
//                                          URL). When EMPTY we're in dev: only localhost
//                                          is allowed. Never wide-open in production.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { DT } from '../src/sim/sim';
import type { ClientMessage, ServerMessage, ChatLine, ChatChannel } from '../src/net/protocol';
import { ServerWorld } from './world';
import { ChatModerator } from './chat';
import { Weather } from './weather';
import { createStore, MemoryStore, type CharacterStore } from './store';
import { createGuildStore, MemoryGuildStore, type GuildStore } from './guild_store';
import { createMarketStore, MemoryMarketStore, type MarketStore } from './market_store';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const SNAPSHOT_HZ = Number(process.env.SNAPSHOT_HZ ?? 10);
const WORLD_SEED = Number(process.env.WORLD_SEED ?? 1337); // fixed -> the same mob layout every boot
const CHAT_MAX_LEN = Number(process.env.CHAT_MAX_LEN ?? 200);
const CHAT_RATE_PER_SEC = Number(process.env.CHAT_RATE_PER_SEC ?? 3);
// Weather (synchronized day/night + rain): full cycle length, plus the rain timing. Each
// shower and each dry spell draws a UNIFORM-RANDOM duration between a min and a CAP, so
// the weather is unpredictable but bounded: rain <= RAIN_MAX (default 15 min), dry <=
// CLEAR_MAX (default 60 min). RAMP is the gradual fade in/out. posNum: positive-finite or
// fall back to the default (a misconfigured WEATHER_* of 0 / "" / NaN must not reach the math).
const posNum = (raw: string | undefined, def: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? n : def;
};
const WEATHER_DAY_SECONDS = posNum(process.env.WEATHER_DAY_SECONDS, 240);
const WEATHER_RAIN_MIN_SECONDS = posNum(process.env.WEATHER_RAIN_MIN_SECONDS, 120); // shortest shower (~2 min)
const WEATHER_RAIN_MAX_SECONDS = posNum(process.env.WEATHER_RAIN_MAX_SECONDS, 900); // CAP on a shower (15 min)
const WEATHER_CLEAR_MIN_SECONDS = posNum(process.env.WEATHER_CLEAR_MIN_SECONDS, 300); // shortest dry spell (~5 min)
const WEATHER_CLEAR_MAX_SECONDS = posNum(process.env.WEATHER_CLEAR_MAX_SECONDS, 3600); // CAP on a dry spell (60 min)
const WEATHER_RAIN_RAMP_SECONDS = posNum(process.env.WEATHER_RAIN_RAMP_SECONDS, 15); // gradual fade in/out
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const weather = new Weather(
  WEATHER_DAY_SECONDS,
  WEATHER_RAIN_MIN_SECONDS, WEATHER_RAIN_MAX_SECONDS,
  WEATHER_CLEAR_MIN_SECONDS, WEATHER_CLEAR_MAX_SECONDS,
  WEATHER_RAIN_RAMP_SECONDS,
);
const world = new ServerWorld(WORLD_SEED, weather);
const chat = new ChatModerator(CHAT_MAX_LEN, CHAT_RATE_PER_SEC);
const SAVE_INTERVAL_SECONDS = posNum(process.env.SAVE_INTERVAL_SECONDS, 30);
// Character persistence. Starts as memory (no-op) and is replaced by the real store
// BEFORE we listen (see the bottom), so a returning player loads correctly.
let store: CharacterStore = new MemoryStore();
let guildStore: GuildStore = new MemoryGuildStore(); // durable guilds (Postgres or memory; loaded on boot)
let marketStore: MarketStore = new MemoryMarketStore(); // async marketplace blob (listings + mailbox; loaded on boot)
const clientIds = new Map<WebSocket, number>(); // socket -> its player id (set on join)
const clientNames = new Map<WebSocket, string>(); // socket -> its player name (server-known)
const joining = new Map<WebSocket, string>(); // socket -> lowercased name mid-join (awaiting the async DB load) — guards the gap + name race

// One HTTP server hosts BOTH the healthcheck (plain GET) and the WebSocket upgrade.
const httpServer = createServer(handleHttp);
const wss = new WebSocketServer({
  server: httpServer,
  verifyClient: (info: { origin: string; secure: boolean; req: IncomingMessage }) => originAllowed(info.origin),
});

function handleHttp(req: IncomingMessage, res: ServerResponse): void {
  if (req.method === 'GET' && (req.url === '/health' || req.url === '/healthz')) {
    res.writeHead(200, { 'content-type': 'text/plain' });
    res.end('ok'); // simple liveness probe — curl https://<server>/health -> "ok"
    return;
  }
  res.writeHead(404, { 'content-type': 'text/plain' });
  res.end('openrealm server');
}

// Anti-CSRF gate for browser clients. A browser ALWAYS sends Origin on a WS handshake;
// non-browser clients (CLI tools, the healthcheck) send none and are allowed (the Origin
// check only stops a malicious WEBSITE from hijacking a visitor's browser into our server).
function originAllowed(origin: string | undefined): boolean {
  if (!origin) return true;
  if (ALLOWED_ORIGINS.length > 0) return ALLOWED_ORIGINS.includes(origin); // production allowlist
  return /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(origin); // dev: localhost only
}

wss.on('connection', (ws) => {
  ws.on('message', (data) => void handleMessage(ws, data).catch((e) => console.error('[server] message error:', e)));
  ws.on('close', () => dropClient(ws));
  ws.on('error', () => dropClient(ws)); // a socket error -> treat like a disconnect
});

async function handleMessage(ws: WebSocket, data: RawData): Promise<void> {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    return; // ignore malformed input — never trust a client
  }
  if (msg.t === 'join') {
    if (clientIds.has(ws) || joining.has(ws)) return; // already joined / mid-join — ignore repeats
    const name = typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim().slice(0, 24) : 'Jogador';
    // Name-uniqueness guard: identity is by name (no auth yet), and the sim/mailbox/guild all key on
    // name.toLowerCase(). If that name is ALREADY online (joined or mid-join), refuse — otherwise two
    // clients would share one save (last-writer-wins erases progress), one marketplace mailbox, and one
    // guild membership. Case-insensitive, matching how the sim resolves identity.
    const lower = name.toLowerCase();
    const online =
      [...clientNames.values()].some((n) => n.toLowerCase() === lower) ||
      [...joining.values()].some((jn) => jn === lower);
    if (online) {
      send(ws, { t: 'rejected', reason: 'name-taken' }); // client shows "nome em uso" and does NOT reconnect
      return;
    }
    joining.set(ws, lower);
    // Load any saved character BEFORE spawning, so a returning player starts where it left off.
    const saved = await store.load(name);
    if (ws.readyState !== WebSocket.OPEN) { joining.delete(ws); return; } // disconnected while loading
    const id = world.addPlayer(name);
    if (saved != null) world.restorePlayer(id, saved); // restore is DEFENSIVE — the sim sanitizes it
    clientIds.set(ws, id);
    clientNames.set(ws, name);
    joining.delete(ws);
    send(ws, { t: 'welcome', id, snapshotHz: SNAPSHOT_HZ });
    broadcastChat({ from: '', text: `${name} entrou`, ts: Date.now(), system: true });
    if (saved == null) { const fresh = world.serializePlayer(id); if (fresh) void store.save(name, fresh); } // persist the new char
    console.log(`[server] ${name} joined as #${id} (${world.playerCount()} online) [${saved != null ? 'loaded' : 'new'}]`);
  } else if (msg.t === 'move-intent') {
    const id = clientIds.get(ws);
    if (id != null) world.setIntent(id, msg.dx, msg.dz);
  } else if (msg.t === 'cmd') {
    const id = clientIds.get(ws);
    if (id != null) world.command(id, msg.cmd); // server whitelists + the sim validates
  } else if (msg.t === 'chat') {
    handleChat(ws, msg.text, msg.channel);
  } else if (
    msg.t === 'matching-register' || msg.t === 'matching-unregister' || msg.t === 'matching-request' ||
    msg.t === 'matching-cancel' || msg.t === 'matching-approve' || msg.t === 'matching-deny'
  ) {
    handleMatching(ws, msg);
  } else if (
    msg.t === 'guild-create' || msg.t === 'guild-invite' || msg.t === 'guild-accept' ||
    msg.t === 'guild-decline' || msg.t === 'guild-leave' || msg.t === 'guild-kick'
  ) {
    handleGuild(ws, msg);
  }
}

// Party-matching lobby intent (LFM list). The server validates everything (leadership,
// capacity, level limits, sanitizes the title) inside ServerWorld; here we only resolve
// the connection to its player id. On approval the world issues a sim party-admit, so the
// membership change stays authoritative in the sim.
function handleMatching(
  ws: WebSocket,
  msg: Extract<ClientMessage, { t: `matching-${string}` }>,
): void {
  const id = clientIds.get(ws);
  if (id == null) return; // not joined yet
  switch (msg.t) {
    case 'matching-register': world.registerMatching(id, msg.title, msg.minLevel, msg.maxLevel, Date.now()); return;
    case 'matching-unregister': world.unregisterMatching(id); return;
    case 'matching-request': world.requestJoin(id, msg.partyId); return;
    case 'matching-cancel': world.cancelJoinRequest(id); return;
    case 'matching-approve': world.approveJoin(id, msg.playerId); return;
    case 'matching-deny': world.denyJoin(id, msg.playerId); return;
  }
}

// Guild formation intents (GDD v0.5 §1). The server validates everything in the GuildRegistry (owner,
// duplicate name, membership); here we resolve the connection to its id + server-known name and reply
// with system-chat feedback. There is no dedicated guild HUD — the social core is driven entirely by
// the /guild commands (parsed client-side into these messages) + /g chat.
function handleGuild(ws: WebSocket, msg: Extract<ClientMessage, { t: `guild-${string}` }>): void {
  const id = clientIds.get(ws);
  const name = clientNames.get(ws);
  if (id == null || name == null) return; // not joined yet
  switch (msg.t) {
    case 'guild-create': {
      const g = world.createGuild(id, msg.name);
      if (g) void guildStore.save(g); // durable: persist the new guild
      systemTo(id, g
        ? `Guilda "${g.name}" criada. /g pra conversar · /guild invite <nome> pra convidar.`
        : 'Não deu pra criar a guilda (nome em uso, vazio, ou você já está em uma).');
      return;
    }
    case 'guild-invite': {
      const r = world.inviteToGuild(id, msg.name);
      if (!r) { systemTo(id, 'Convite falhou (você não é o dono, ou o jogador não está online / já tem guilda).'); return; }
      systemTo(id, `Convite enviado para ${msg.name}.`);
      systemTo(r.inviteeId, `${name} te convidou para a guilda "${r.guild.name}". /guild accept pra entrar · /guild decline pra recusar.`);
      return;
    }
    case 'guild-accept': {
      const g = world.acceptGuildInvite(id);
      if (!g) { systemTo(id, 'Nenhum convite de guilda pendente.'); return; }
      void guildStore.save(g); // durable: persist the new member
      for (const m of world.guildMemberIds(id)) systemTo(m, `${name} entrou na guilda "${g.name}".`);
      return;
    }
    case 'guild-decline':
      world.declineGuildInvite(id);
      systemTo(id, 'Convite de guilda recusado.');
      return;
    case 'guild-leave': {
      const members = [...world.guildMemberIds(id)]; // COPY the roster BEFORE leaving (leaveGuild mutates the live array)
      const g = world.leaveGuild(id);
      if (!g) { systemTo(id, 'Você não está em uma guilda.'); return; }
      if (g.members.length === 0) void guildStore.remove(g.name); // dissolved (last member out)
      else void guildStore.save(g); // updated (member left / owner promoted)
      systemTo(id, `Você saiu da guilda "${g.name}".`);
      for (const m of members) if (m !== id) systemTo(m, `${name} saiu da guilda.`);
      return;
    }
    case 'guild-kick': {
      const r = world.kickFromGuild(id, msg.name);
      if (!r) { systemTo(id, 'Não deu pra remover (você não é o dono, ou o jogador não está na sua guilda).'); return; }
      void guildStore.save(r.guild); // durable: persist the roster change
      if (r.targetId != null) systemTo(r.targetId, `Você foi removido da guilda "${r.guild.name}".`); // notify if online
      for (const m of world.guildMemberIds(id)) systemTo(m, `${r.targetName} foi removido da guilda.`);
      systemTo(id, `${r.targetName} removido.`);
      return;
    }
  }
}

// Send a PRIVATE system chat line to one player by id (guild feedback). Resolves id -> socket.
function systemTo(id: number, text: string): void {
  for (const [ws, pid] of clientIds) {
    if (pid === id) {
      send(ws, { t: 'chat', line: { from: '', text, ts: Date.now(), system: true } });
      return;
    }
  }
}

// A chat message from a client. We trust ONLY the text (sanitized + rate-limited by the
// moderator); the sender name is whatever the server already knows for this connection.
// 'party' routes ONLY to the sender's party members (the server decides who they are);
// 'say' (default) broadcasts to everyone.
function handleChat(ws: WebSocket, rawText: unknown, channel: ChatChannel | undefined): void {
  const id = clientIds.get(ws);
  const name = clientNames.get(ws);
  if (id == null || name == null) return; // not joined yet
  const text = chat.accept(id, rawText, Date.now());
  if (text == null) return; // empty or over the rate limit -> drop
  if (channel === 'party') {
    const members = new Set(world.partyMemberIds(id));
    if (members.size === 0) {
      // not in a party -> a private system notice, only to the sender
      send(ws, { t: 'chat', line: { from: '', text: 'Você não está em um grupo.', ts: Date.now(), system: true } });
      return;
    }
    const line: ChatLine = { from: name, text, ts: Date.now(), channel: 'party' };
    const payload = JSON.stringify({ t: 'chat', line } satisfies ServerMessage);
    for (const [sock, sid] of clientIds) {
      if (members.has(sid) && sock.readyState === WebSocket.OPEN) sock.send(payload); // only group members
    }
    return;
  }
  if (channel === 'guild') {
    // Guildas (GDD v0.5 §1): /g routes ONLY to the sender's guild members (like /p for the party).
    const members = new Set(world.guildMemberIds(id));
    if (members.size === 0) {
      send(ws, { t: 'chat', line: { from: '', text: 'Você não está em uma guilda.', ts: Date.now(), system: true } });
      return;
    }
    const line: ChatLine = { from: name, text, ts: Date.now(), channel: 'guild' };
    const payload = JSON.stringify({ t: 'chat', line } satisfies ServerMessage);
    for (const [sock, sid] of clientIds) {
      if (members.has(sid) && sock.readyState === WebSocket.OPEN) sock.send(payload); // guild members only
    }
    return;
  }
  broadcastChat({ from: name, text, ts: Date.now() }); // 'say' (default) -> everyone
}

// Send a chat line to every connected client (player messages + system notices).
function broadcastChat(line: ChatLine): void {
  const payload = JSON.stringify({ t: 'chat', line } satisfies ServerMessage);
  for (const ws of clientIds.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}

function dropClient(ws: WebSocket): void {
  joining.delete(ws); // in case it disconnected mid-join
  const id = clientIds.get(ws);
  if (id == null) return;
  const name = clientNames.get(ws);
  // Persist the latest progress BEFORE the entity is removed (serialize needs it alive).
  const save = world.serializePlayer(id);
  if (name != null && save != null) void store.save(name, save);
  void marketStore.save(world.serializeMarket()); // persist the market too (this player may have listed/sold)
  world.removePlayer(id);
  clientIds.delete(ws);
  clientNames.delete(ws);
  chat.forget(id);
  if (name != null) broadcastChat({ from: '', text: `${name} saiu`, ts: Date.now(), system: true });
  console.log(`[server] #${id} left (${world.playerCount()} online)`);
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// Fixed-timestep simulation tick (the server is the clock).
setInterval(() => world.step(), DT * 1000);

// Snapshot broadcast. Two parts: the SHARED world + combat events (built ONCE and sent
// to everyone, so the fight is identical across clients), and each client's PERSONAL
// state (its own HUD/bag — sent only to its owner, so personal data never spams others).
setInterval(() => {
  if (clientIds.size === 0) return;
  const shared = JSON.stringify({ t: 'snapshot', ...world.snapshot() } satisfies ServerMessage);
  for (const [ws, id] of clientIds) {
    if (ws.readyState !== WebSocket.OPEN) continue;
    ws.send(shared);
    ws.send(JSON.stringify({ t: 'self', self: world.selfState(id) } satisfies ServerMessage));
  }
}, 1000 / SNAPSHOT_HZ);

// Periodically persist every connected character (in addition to on-disconnect), so a
// crash/kill loses at most SAVE_INTERVAL_SECONDS of progress. No-op in memory mode.
setInterval(() => {
  if (!store.ready || clientIds.size === 0) return;
  for (const [ws, id] of clientIds) {
    const name = clientNames.get(ws);
    const save = world.serializePlayer(id);
    if (name != null && save != null) void store.save(name, save);
  }
  void marketStore.save(world.serializeMarket()); // persist the marketplace (async sales survive a restart)
}, SAVE_INTERVAL_SECONDS * 1000);

// Connect the database (if any) BEFORE accepting players, so a returning player loads
// correctly. createStore falls back to in-memory if there's no DATABASE_URL or it can't
// connect — the server always starts. (Errors are handled inside createStore.)
void (async () => {
  store = await createStore(process.env.DATABASE_URL);
  // Durable guilds (GDD v0.5 §1): load the persisted guilds into the registry BEFORE accepting players,
  // so a returning member is already in their guild. Falls back to memory if there's no DB.
  guildStore = await createGuildStore(process.env.DATABASE_URL);
  world.loadGuilds(await guildStore.loadAll());
  // Async marketplace: load the persisted listings + mailbox BEFORE accepting players, so a sale that
  // happened while everyone was offline (and the escrowed items) survive the restart.
  marketStore = await createMarketStore(process.env.DATABASE_URL);
  const savedMarket = await marketStore.load();
  if (savedMarket != null) world.restoreMarket(savedMarket);
  httpServer.listen(PORT, HOST, () => {
    const mode = ALLOWED_ORIGINS.length > 0 ? `origins=[${ALLOWED_ORIGINS.join(', ')}]` : 'dev (localhost origins)';
    const persist = store.ready ? 'persistence ON (Postgres)' : 'persistence OFF (in-memory)';
    console.log(
      `[server] openrealm on ${HOST}:${PORT} — tick ${Math.round(1 / DT)}Hz, snapshots ${SNAPSHOT_HZ}Hz, ${mode}, ${persist}`,
    );
    console.log(`[server] health: GET http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/health`);
  });
})();
