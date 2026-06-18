# Contributing to Openrealm

Thanks for your interest! This project is built to grow with contributors.

## Getting started

```bash
npm install
npm run dev
npm test
```

## Before you write code

1. Read the root `CLAUDE.md` and the `CLAUDE.md` in the folder you'll touch.
   They are short and they are the rules of the house (they double as the guide
   for AI assistants working on the repo).
2. For anything non-trivial, drop a short spec in `docs/prd/` first
   (what + why + acceptance). It keeps everyone — humans and AI — aligned.

## The rules that matter most

- **Never break determinism.** `src/sim/` has no DOM/Three.js imports and no
  `Math.random` / `Date.now` / `performance.now`. All randomness goes through
  `Rng`. The determinism test must stay green.
- **Respect the `IWorld` seam.** `render/` and `ui/` talk only to `IWorld`. New
  gameplay feature => extend `IWorld`, implement it in the sim (and later the
  online world), then render it.
- **Keep dependencies tiny.** Open an issue before adding a package.
- **Add a test** when you change simulation behavior.

## Workflow

- Branch: `feature/<slug>` or `fix/<slug>`.
- Commits: Conventional Commits with a scope — `feat(sim): add melee swing`,
  `fix(render): clamp camera pitch`.
- Open a PR; make sure `npm run typecheck` and `npm test` pass.

## Assets

If you add art/audio, it must be license-clean (CC0 or compatible). Record the
source and license in `CREDITS.md` (create it when the first asset lands).
