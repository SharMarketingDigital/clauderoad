# src/net/ — online client (stub for now)

When we go online, this folder holds `ClientWorld`, which implements `IWorld`
by mirroring authoritative server snapshots over a WebSocket. The renderer and
HUD won't change — they already talk to `IWorld`.

Plan:
- `ClientWorld implements IWorld`: holds the latest snapshot of entities;
  `sendCommand` sends the player's intent to the server instead of a local Sim.
- REST for auth/login; a WebSocket for the world stream (~20 Hz snapshots).
- Interpolate between snapshots for smooth movement.
