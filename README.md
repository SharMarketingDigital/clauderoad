# Openrealm

An open-world online RPG — built by **Gabriel & Kevin**, in the spirit of
[World of Claudecraft](https://github.com/levy-street/world-of-claudecraft).
Inspired by WoW, Silkroad, Mir4 and Warframe. Open source, made to grow over
time and welcome contributors.

> Status: **early foundation.** Today it's a single-player offline slice — a
> character you can run around a 3D open world with a deterministic simulation
> running underneath. The architecture is already laid out so that 2-player
> (Gabriel + Kevin in one shared world) is the next milestone, not a rewrite.

## Run it

Requires Node.js 18+.

```bash
npm install
npm run dev          # open http://localhost:5173
npm test             # run the determinism test
npm run typecheck    # strict TypeScript check
```

Controls: **WASD** to move, **drag the mouse** to orbit the camera, **scroll**
to zoom.

## Why it's built this way

The thing that lets an AI (and a small team) build a big game without it
collapsing into mush isn't the model — it's a disciplined structure. Three ideas
carry everything:

1. **One sim, many hosts.** A single deterministic core (`src/sim/`) is the
   source of truth. The same code runs the offline world today and the
   authoritative multiplayer server later. It has zero DOM/Three.js imports, so
   it runs identically in the browser and in Node.
2. **`IWorld` is the only seam.** Rendering and UI depend on the `IWorld`
   interface (`src/world_api.ts`), never on the concrete simulation. To add a
   feature you extend `IWorld`, then implement it in each world. This is also
   what lets two people work in parallel without colliding.
3. **Hard invariants + automated tests.** Determinism (fixed 20 Hz tick, all
   randomness through a seeded `Rng`, never `Math.random`/`Date.now`), and a
   test suite that proves it. See `CLAUDE.md`.

## Project layout

```
src/sim/        deterministic game core (source of truth) — no DOM/Three
  content/      data-as-code: classes, enemies, (later) abilities/zones/items
src/render/     Three.js renderer (reads the world, never mutates it)
src/game/       input + camera
src/ui/         HUD (plain DOM) + styles
src/net/        (stub) online client — future ClientWorld
src/world_api.ts  IWorld — the seam render/ui depend on
server/         (stub) authoritative server — where 2-player will live
tests/          Vitest suite (determinism today)
docs/design/    design docs    docs/prd/  one short spec per feature
CLAUDE.md       repo-wide rules (+ one CLAUDE.md per folder)
```

## Roadmap

- **M0 — Foundation (done):** runnable offline world, deterministic sim, camera, HUD.
- **M1 — Core loop:** target/attack an enemy, deal damage, gain XP. One real class.
- **M2 — 2-player:** authoritative `server/` running the shared Sim; Gabriel & Kevin in one world over WebSocket.
- **M3 — Depth:** more classes, items, ~10 quests, NPCs, a small zone with purpose.
- **M4 — Persistence & deploy:** Postgres for accounts/characters; Docker + a host with HTTPS; first public playable.

See `CONTRIBUTING.md` to get involved.

## License

MIT — see `LICENSE`.
