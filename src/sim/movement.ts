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

// Square city-wall collision (player only). The wall ring at Chebyshev distance `wallHalf` blocks
// crossing EXCEPT through a gate gap (|tangential coord| <= gateHalf) at each cardinal mid-point.
// When a step would cross a wall OUTSIDE its gate, the player slides along the wall toward that
// wall's gate centre instead — so moving toward a target beyond the wall naturally routes through
// the nearest gate. Pure & deterministic (no Rng/clock); the city geometry comes in as parameters.
export function slideThroughGates(
  px: number,
  pz: number,
  cx: number,
  cz: number,
  wallHalf: number,
  gateHalf: number,
): { x: number; z: number } {
  const gate = blockingGate(px, pz, cx, cz, wallHalf, gateHalf);
  if (!gate) return { x: cx, z: cz }; // move stays inside, or crosses within a gate — allowed as-is
  // Blocked: slide this step toward the blocked wall's gate centre instead of crossing the rampart.
  const dx = gate.x - px;
  const dz = gate.z - pz;
  const d = Math.hypot(dx, dz);
  const len = Math.hypot(cx - px, cz - pz);
  if (d < 1e-6 || len <= 0) return { x: px, z: pz };
  const k = Math.min(1, len / d);
  return { x: px + dx * k, z: pz + dz * k };
}

// The gate centre to slide toward when the segment (px,pz)->(cx,cz) would cross the wall ring
// OUTSIDE a gate; null when the move is allowed (stays inside, or crosses within a gate gap).
function blockingGate(
  px: number, pz: number, cx: number, cz: number, wallHalf: number, gateHalf: number,
): { x: number; z: number } | null {
  for (const w of [wallHalf, -wallHalf]) { // east / west walls (x = ±wallHalf); gate gap on z
    if ((px - w) * (cx - w) < 0) { // px and cx straddle the line x = w (a crossing)
      const zc = pz + ((w - px) / (cx - px)) * (cz - pz); // z at the crossing point
      // Block only when the crossing is on the actual wall SEGMENT (between the corners) and
      // outside the gate gap; |zc| > wallHalf is beyond the corner (no wall there), so it's free.
      if (Math.abs(zc) > gateHalf && Math.abs(zc) <= wallHalf) return { x: w, z: 0 };
    }
  }
  for (const w of [wallHalf, -wallHalf]) { // north / south walls (z = ±wallHalf); gate gap on x
    if ((pz - w) * (cz - w) < 0) {
      const xc = px + ((w - pz) / (cz - pz)) * (cx - px);
      if (Math.abs(xc) > gateHalf && Math.abs(xc) <= wallHalf) return { x: 0, z: w };
    }
  }
  return null;
}
