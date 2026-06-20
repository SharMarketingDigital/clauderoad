# src/net/ — online client

`ClientWorld` implements `IWorld` by mirroring authoritative server snapshots over a
WebSocket. The renderer and HUD don't change — they already talk to `IWorld`.

- `protocol.ts` — the wire protocol (shared with `server/`, the one source of truth for
  message shapes). Client sends INTENT (`join`, `move-intent`, `set-target`,
  `cycle-target`, `use-ability`); server sends `welcome` + `snapshot` (entities + combat
  events). Reuses `EntityKind`/`EnemyTierId`/`SimEvent` from `world_api` so types agree.
- `client_world.ts` — `ClientWorld implements IWorld`: holds the latest snapshot of ALL
  entities (players + mobs + NPC), INTERPOLATES positions between snapshots for smooth
  movement, exposes the server's combat events via `recentEvents()`, and PREDICTS target
  selection locally (the server validates + actually deals damage). `sendCommand` routes
  intent to the server instead of a local Sim.

Still to come: REST auth/login; per-player loot/XP/inventory sync; interest-scoped
snapshots so we don't stream every entity to everyone.
