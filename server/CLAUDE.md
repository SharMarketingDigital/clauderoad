# server/ — authoritative game server (stub for now)

This is where 2-player (then N-player) lives. Milestone: after the offline
loop is fun.

Plan (mirrors World of Claudecraft):
- Node + `ws`. Runs ONE shared `Sim` from `src/sim/` (the same code the client
  runs offline) at 20 Hz.
- Clients connect over WebSocket and stream **commands** (movement intent,
  later abilities). The server applies them to the shared Sim.
- The server is **authoritative**: it decides all outcomes (combat, loot, XP)
  and broadcasts interest-scoped snapshots back to clients.
- Persistence with Postgres (`pg`): accounts (scrypt-hashed passwords) and
  characters (position/level/inventory). For 2-player you can start with a
  single process and one realm.
- Rate-limit auth endpoints. Never enable dev/cheat commands in production.

Smallest first step for 2 players: a server that holds one Sim, accepts two
WebSocket clients, applies their move commands, and broadcasts entity
positions ~20x/sec. Everything else builds on that.
