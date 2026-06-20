// Authoritative game server (presence + movement foundation). Accepts WebSocket
// connections, runs ONE shared world at a fixed tick (reusing src/sim/), and streams
// snapshots to everyone. The server decides all positions; clients only send intent.
//
// Config is via environment variables (nothing sensitive in code — see .env.example):
//   PORT             (default 8080)      — TCP port to listen on
//   HOST             (default 0.0.0.0)   — bind address (0.0.0.0 accepts external conns)
//   SNAPSHOT_HZ      (default 10)        — snapshots broadcast per second
//   ALLOWED_ORIGINS  (default: empty)    — comma-separated list of allowed browser
//                                          Origins. Set in PRODUCTION (e.g. the Vercel
//                                          URL). When EMPTY we're in dev: only localhost
//                                          is allowed. Never wide-open in production.
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { DT } from '../src/sim/sim';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';
import { ServerWorld } from './world';

const PORT = Number(process.env.PORT ?? 8080);
const HOST = process.env.HOST ?? '0.0.0.0';
const SNAPSHOT_HZ = Number(process.env.SNAPSHOT_HZ ?? 10);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? '')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

const world = new ServerWorld();
const clientIds = new Map<WebSocket, number>(); // socket -> its player id (set on join)

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
  ws.on('message', (data) => handleMessage(ws, data));
  ws.on('close', () => dropClient(ws));
  ws.on('error', () => dropClient(ws)); // a socket error -> treat like a disconnect
});

function handleMessage(ws: WebSocket, data: RawData): void {
  let msg: ClientMessage;
  try {
    msg = JSON.parse(data.toString());
  } catch {
    return; // ignore malformed input — never trust a client
  }
  if (msg.t === 'join') {
    if (clientIds.has(ws)) return; // already joined; ignore a repeat
    const name = typeof msg.name === 'string' && msg.name.trim() ? msg.name.trim().slice(0, 24) : 'Jogador';
    const id = world.addPlayer(name);
    clientIds.set(ws, id);
    send(ws, { t: 'welcome', id, snapshotHz: SNAPSHOT_HZ });
    console.log(`[server] ${name} joined as #${id} (${world.playerCount()} online)`);
  } else if (msg.t === 'move-intent') {
    const id = clientIds.get(ws);
    if (id != null) world.setIntent(id, msg.dx, msg.dz);
  }
}

function dropClient(ws: WebSocket): void {
  const id = clientIds.get(ws);
  if (id == null) return;
  world.removePlayer(id);
  clientIds.delete(ws);
  console.log(`[server] #${id} left (${world.playerCount()} online)`);
}

function send(ws: WebSocket, msg: ServerMessage): void {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

// Fixed-timestep simulation tick (the server is the clock).
setInterval(() => world.step(), DT * 1000);

// Snapshot broadcast — one shared message to every connected client.
setInterval(() => {
  if (clientIds.size === 0) return;
  const payload = JSON.stringify({ t: 'snapshot', players: world.snapshot() } satisfies ServerMessage);
  for (const ws of clientIds.keys()) {
    if (ws.readyState === WebSocket.OPEN) ws.send(payload);
  }
}, 1000 / SNAPSHOT_HZ);

httpServer.listen(PORT, HOST, () => {
  const mode = ALLOWED_ORIGINS.length > 0 ? `origins=[${ALLOWED_ORIGINS.join(', ')}]` : 'dev (localhost origins)';
  console.log(
    `[server] openrealm on ${HOST}:${PORT} — tick ${Math.round(1 / DT)}Hz, snapshots ${SNAPSHOT_HZ}Hz, ${mode}`,
  );
  console.log(`[server] health: GET http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}/health`);
});
