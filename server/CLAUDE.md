# server/ — authoritative game server

Node.js + TypeScript WebSocket server. Runs ONE shared world and is the single
source of truth; clients only send intent and render snapshots.

## Files
- `index.ts` — entry: WebSocket server (`ws`), fixed-timestep tick + snapshot
  broadcast, env config (PORT, HOST, SNAPSHOT_HZ, WORLD_SEED). Run with `npm run server`.
- `world.ts` — `ServerWorld`: wraps the FULL `Sim` (`new Sim(seed, false)` — no local
  player; clients join via `addPlayer`). Players + MOBS + COMBAT all run here; builds
  the entity + combat-event snapshots.
- `tsconfig.json` — Node build (no DOM lib; `@types/node`). `npm run typecheck:server`.

## Rules (load-bearing)
- **The server is authoritative.** It accepts only INTENT (`join`, `move-intent`,
  `set-target`, `cycle-target`, `use-ability`) and decides every position AND every
  hit/death. Never trust a client value — sanitize input, never read a client-sent
  position or damage. (See `setIntent` clamping + the sim's range/cooldown gating.)
- **Reuse `src/sim/`, never fork it.** Movement comes from `src/sim/movement.ts`
  with the constants from `src/sim/sim.ts`, so online and offline behave identically.
  The sim is DOM-free, so it imports cleanly into Node.
- **Wire protocol lives in `src/net/protocol.ts`** — shared with the client, the one
  source of truth for message shapes. Don't define message types here.
- **No secrets in code.** Ports/URLs come from env (`.env`, gitignored; see
  `.env.example`).

## Scope today (shared mobs + combat)
Players join/move/leave AND share the same MOBS and COMBAT: the server simulates mob
spawn/AI/HP/death/respawn and resolves every hit, streaming entities + combat events so
two clients farm the same enemies and see the same fight. The snapshot carries players,
mobs and the town NPC. Still per-client-LOCAL (not synced yet): loot, XP/level, the
action-bar cooldowns, inventory and the shop — that's the next slice.

## Where it grows (the original plan)
Per-player loot + XP/inventory synced to each client; interest-scoped snapshots (don't
send every entity to everyone); Postgres for accounts (scrypt) + characters; rate-limited
auth; never ship dev/cheat commands.
