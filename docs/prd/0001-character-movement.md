# PRD 0001 — Character movement (DONE)

**What:** A player character that moves around the world with WASD, with a
third-person orbit camera, running on the deterministic sim at 20 Hz.

**Why:** It's the smallest slice that proves the whole architecture end to end
(sim -> IWorld -> renderer + input + HUD) and gives us something to build on.

**Acceptance:**
- [x] WASD moves the character relative to the camera.
- [x] Mouse drag orbits the camera; scroll zooms.
- [x] Movement happens in the sim (fixed timestep), not in the renderer.
- [x] Determinism test passes (same seed + inputs => same world).

**Next PRD ideas:** target an enemy (0002), basic melee attack + damage (0003),
XP on kill (0004), then the 2-player server (0005).
