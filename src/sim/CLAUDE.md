# src/sim/ — deterministic game core

This is the source of truth. The offline client and (later) the authoritative
server both run this exact code.

Rules:
- **No imports from `render/`, `ui/`, `game/`, `net/`, or any DOM/Three.js/
  browser API.** Importing `../world_api` (the `IWorld` contract) is fine.
- **All randomness through `Rng`** (`rng.ts`). Never `Math.random`, `Date.now`,
  `performance.now`. The tick is a fixed `DT = 1/20`.
- Content (classes, enemies, later abilities/zones/items/quests) is
  **data-as-code** under `content/` — plain typed objects, no logic.
- When you add behavior, add/extend a test in `tests/`.
