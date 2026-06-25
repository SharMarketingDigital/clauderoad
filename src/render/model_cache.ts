// Shared loading policy for the player model "proxy" (one model, shown in many places: the world,
// the inventory paper-doll, and the head badge).
//
// WebGL keeps GPU resources (geometry/textures) PER CONTEXT, so each <canvas> (the world, the
// inventory viewer, the badge) is its own renderer and MUST upload its own copy of the mesh —
// that cannot be shared across canvases. What CAN be shared is the network fetch + file decode:
// enabling THREE.Cache makes every GLTFLoader reuse the already-fetched .glb/.bin/atlas by URL,
// so each model file downloads ONCE for the whole project and is only re-parsed per context.
//
// This module just flips that global flag (idempotent). Import it for its side effect, as early
// as possible (the client entry does), so the very first model load already populates the cache
// and every later surface reuses it.
import * as THREE from 'three';

THREE.Cache.enabled = true;
