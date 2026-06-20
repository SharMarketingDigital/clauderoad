// The ONE movement integration, shared by the offline Sim and the authoritative
// server — so a player walks identically in both. Pure & deterministic: no Rng, no
// clock, no DOM. Speed/dt/bounds are parameters so this module imports nothing (and
// can't perturb the sim's constants or create an import cycle).
//
// Given a position and a desired direction, returns the next position + facing, or
// null when there's no meaningful input (so the caller leaves the actor put).
export function applyMove(
  x: number,
  z: number,
  dx: number,
  dz: number,
  speed: number,
  dt: number,
  worldHalf: number,
): { x: number; z: number; facing: number } | null {
  const len = Math.hypot(dx, dz);
  if (len < 1e-4) return null;
  const nx = dx / len;
  const nz = dz / len;
  return {
    x: clamp(x + nx * speed * dt, -worldHalf, worldHalf),
    z: clamp(z + nz * speed * dt, -worldHalf, worldHalf),
    facing: Math.atan2(nx, nz),
  };
}

function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}
