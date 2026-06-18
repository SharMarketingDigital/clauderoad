<!-- Openrealm — project-root CLAUDE.md.
Keep this short and strictly repo-wide. Area-specific guidance lives in each
subdirectory's own CLAUDE.md (src/sim/, src/render/, server/, ...). Don't
duplicate it here. -->

# Openrealm

An open-world online RPG (inspired by WoW / Silkroad / Mir4 / Warframe),
driven by one deterministic TypeScript simulation core. Built by Gabriel &
Kevin in the spirit of World of Claudecraft. Single-player offline today;
2-player shared world next.

Stack: TypeScript (ESM, `strict`) · Three.js renderer · Vite + Vitest.
Planned for online play: `ws` WebSockets + Postgres. Keep dependencies tiny.

## Repo map

| Path | What it is |
|---|---|
| `src/sim/` | **Deterministic game core — the source of truth.** No DOM/Three deps; runs in the browser today and on the server later. |
| `src/sim/content/` | Data-as-code: classes, enemies (and later abilities, zones, items, quests). |
| `src/render/` | Three.js renderer. READS the world; never mutates it. |
| `src/game/` | Local input, camera, controls. |
| `src/ui/` | HUD (DOM, no framework) + styles. |
| `src/net/` | (Stub) Online client: will mirror server snapshots as `ClientWorld`. |
| `src/world_api.ts` | `IWorld` — the only seam render/ui depend on. |
| `src/main.ts` | Client entry; fixes the world seed; runs the fixed-timestep loop. |
| `server/` | (Stub) Authoritative game server: HTTP+WS, the shared Sim, Postgres. |
| `tests/` | Vitest suite. |
| `docs/design/` · `docs/prd/` | Design docs · one short PRD per feature. |

Most directories have their own `CLAUDE.md` — read it when you work there.

## Design & how we build (read these)

- **Design canônico (o quê):** `docs/design/GDD-Openrealm-v0.2.md`.
- **Mapa do planejamento (status de cada sistema):** `docs/design/00-indice-mestre-gdd.md`.
- **Referência de mecânicas:** `docs/design/REF-silkroad-sistemas-essenciais.md`.
- **Como construímos (loop + prompts):** `docs/EXECUCAO-E-PROMPTS.md`.
- **Setup do zero:** `docs/COMECANDO.md`.

## Commands

- `npm run dev` — Vite dev server on :5173.
- `npm test` — Vitest. While iterating: `npx vitest run tests/sim.test.ts`.
- `npm run typecheck` — `tsc --noEmit`.
- `npm run build` — typecheck + production build.

## Architecture (the load-bearing ideas)

- **One sim, many hosts.** The exact same `src/sim/` code runs the offline
  browser world today and the authoritative server tomorrow. Behavior must be
  identical everywhere — that is the whole point.
- **`IWorld` is the only seam.** `src/world_api.ts` defines `IWorld`; the
  offline `Sim` satisfies it, and the future online `ClientWorld` will too.
  `src/render/` and `src/ui/` talk ONLY to `IWorld`, never to `Sim` concretely.
  New feature -> extend `IWorld` first, then implement it in every world.
- **The server will be authoritative.** Clients stream movement intent +
  commands; the server runs the one shared `Sim` and returns snapshots. The
  client is a renderer; it never decides outcomes.

## Invariants — YOU MUST keep these

- **`src/sim/` has zero DOM/browser/Three.js imports** and never imports from
  `render/`, `ui/`, `game/`, or `net/`. It must run unchanged in Node and the
  browser.
- **Determinism.** Fixed **20 Hz** tick (`DT = 1/20`). All randomness goes
  through `Rng` (`src/sim/rng.ts`) — **never `Math.random`, `Date.now`, or
  `performance.now` in sim logic**. Same seed + same commands => same world.
  (`performance.now` is allowed in `src/main.ts`, the host loop, only.)
- **Ground gameplay numbers in a real reference RPG.** Don't invent balance
  values out of thin air; copy a known game's curves and tune from there.
- **Never commit `.env` or secrets.**

## Conventions

- ESM + TypeScript `strict` everywhere. 2-space indent.
- Keep the dependency set tiny. Don't add packages without a clear need.
- Commits: Conventional Commits with a scope — `feat(sim): ...`, `fix(render): ...`,
  `test(sim): ...`. Branches: `feature/<slug>`, `fix/<slug>`.

## Testing & verification

- Logic/unit: Vitest (`tests/`). Add or update a test when you change sim
  behavior. The determinism test must always pass.
- E2E/visual (later): scripts that drive a real browser to play the game.
