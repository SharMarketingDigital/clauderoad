# src/render/ — Three.js renderer

Draws the world. It is a pure consumer of state.

Rules:
- **Read the world only through `IWorld`.** Never import `Sim`/`ClientWorld`
  concretely, and never mutate world state from here.
- Anything random here is **decoration only** (e.g. tree scatter) and must use
  a local PRNG — never the sim's `Rng`, and never affect gameplay.
- Keep heavy per-frame allocation out of `render()`; reuse meshes by entity id.
