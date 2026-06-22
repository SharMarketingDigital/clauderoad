# server/ — authoritative game server

Node.js + TypeScript WebSocket server. Runs ONE shared world and is the single
source of truth; clients only send intent and render snapshots.

## Files
- `index.ts` — entry: WebSocket server (`ws`), fixed-timestep tick + snapshot broadcast,
  env config, and character load/save orchestration. Run with `npm run server`.
- `world.ts` — `ServerWorld`: wraps the FULL `Sim` (`new Sim(seed, false)` — no local
  player; clients join via `addPlayer`). Players + MOBS + COMBAT + per-player progression
  run here; builds the shared snapshot + each player's personal `self` state; (de)serializes
  characters for persistence.
- `chat.ts` — `ChatModerator`: sanitize + per-player anti-flood for text chat.
- `weather.ts` — `Weather`: server-owned day/night clock + random-but-capped gradual rain,
  broadcast so every client shares one sky.
- `store.ts` — `CharacterStore`: Postgres persistence (via `DATABASE_URL`), or an in-memory
  no-op when there's no DB. Saves/loads each character by name; error-safe.
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

## Scope today
The full PvE runs server-authoritative for every player: shared mobs + combat, plus each
player's own progression (XP/level/attributes/SP/ranks), inventory/loot/equip/alchemy,
vendor economy, death penalty, and an opt-in auto-play bot — streamed back as a shared
world snapshot + a per-owner personal `self` state. Plus text chat, a synchronized
day/night + weather cycle, and CHARACTER PERSISTENCE to Postgres (keyed by join name).

## Persistence (`store.ts` + the sim's serialize/restore)
- Connects via `DATABASE_URL` (a SECRET — read from env, NEVER logged). No `DATABASE_URL`
  => in-memory mode (no save), so local dev needs no database.
- Auto-creates `characters` (name TEXT PK, state JSONB). Loads on join, saves periodically
  + on disconnect. Keyed by the join NAME — no login yet (testing only).
- DB errors degrade gracefully (logged, never crash the game). The Sim's `restorePlayer`
  SANITIZES the loaded JSON (`src/sim/save.ts`), so a corrupt row can't break the sim. The
  serialize/restore are DATA-ONLY — they don't touch gameplay/RNG, so determinism is intact.

## Where it grows
Real accounts/auth (login, hashed passwords) instead of name-as-key; interest-scoped
snapshots (don't send every entity to everyone); never ship dev/cheat commands.
