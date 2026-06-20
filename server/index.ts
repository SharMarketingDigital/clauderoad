// Authoritative game server (presence + movement foundation). Accepts WebSocket
// connections, runs ONE shared world at a fixed tick (reusing src/sim/), and streams
// snapshots to everyone. The server decides all positions; clients only send intent.
//
// Config is via environment variables (nothing sensitive in code — see .env.example):
//   PORT         (default 8080)  — the WebSocket port
//   SNAPSHOT_HZ  (default 10)    — how many snapshots/sec we broadcast
import { WebSocketServer, WebSocket, type RawData } from 'ws';
import { DT } from '../src/sim/sim';
import type { ClientMessage, ServerMessage } from '../src/net/protocol';
import { ServerWorld } from './world';

const PORT = Number(process.env.PORT ?? 8080);
const SNAPSHOT_HZ = Number(process.env.SNAPSHOT_HZ ?? 10);

const world = new ServerWorld();
const clientIds = new Map<WebSocket, number>(); // socket -> its player id (set on join)

const wss = new WebSocketServer({ port: PORT });

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

console.log(
  `[server] openrealm listening on ws://localhost:${PORT} — tick ${Math.round(1 / DT)}Hz, snapshots ${SNAPSHOT_HZ}Hz`,
);
