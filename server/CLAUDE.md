# server/ — authoritative game server

Node.js + TypeScript WebSocket server. Runs ONE shared world and is the single
source of truth; clients only send intent and render snapshots.

## Files
- `index.ts` — entry: WebSocket server (`ws`), fixed-timestep tick + snapshot
  broadcast, env config (PORT, SNAPSHOT_HZ). Run with `npm run server`.
- `world.ts` — `ServerWorld`: the players + their movement.
- `tsconfig.json` — Node build (no DOM lib; `@types/node`). `npm run typecheck:server`.

## Rules (load-bearing)
- **The server is authoritative.** It accepts only INTENT (`join`, `move-intent`)
  and decides every position. Never trust a client value — sanitize input, never
  read a client-sent position. (See `setIntent` clamping in `world.ts`.)
- **Reuse `src/sim/`, never fork it.** Movement comes from `src/sim/movement.ts`
  with the constants from `src/sim/sim.ts`, so online and offline behave identically.
  The sim is DOM-free, so it imports cleanly into Node.
- **Wire protocol lives in `src/net/protocol.ts`** — shared with the client, the one
  source of truth for message shapes. Don't define message types here.
- **No secrets in code.** Ports/URLs come from env (`.env`, gitignored; see
  `.env.example`).

## Scope today (the foundation)
Presence + movement ONLY — players join, move, and leave; everyone sees everyone
move in real time. No combat/mobs/loot/inventory/chat sync yet.

## Where it grows (the original plan)
The full `Sim` (combat/loot/XP) becomes the shared world; clients stream more
command types; interest-scoped snapshots; Postgres for accounts (scrypt) +
characters; rate-limited auth; never ship dev/cheat commands.
