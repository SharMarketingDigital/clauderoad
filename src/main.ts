// Client entry point. Wires the offline Sim to the renderer, input and HUD,
// and runs a FIXED-TIMESTEP loop so gameplay speed never depends on framerate.
//
// Note: performance.now() is fine HERE (the host loop). It is forbidden only
// inside src/sim/, which must stay deterministic.
import { Sim, DT } from './sim/sim';
import { Renderer } from './render/renderer';
import { Input } from './game/input';
import { Hud } from './ui/hud';

const WORLD_SEED = 1337; // fixed seed -> the world is the same place every load

const canvas = document.getElementById('game') as HTMLCanvasElement;
const sim = new Sim(WORLD_SEED);
const renderer = new Renderer(canvas);
const input = new Input(canvas, renderer);
const hud = new Hud();

let last = performance.now() / 1000;
let acc = 0;

function frame(): void {
  const now = performance.now() / 1000;
  let dt = now - last;
  last = now;
  if (dt > 0.25) dt = 0.25; // clamp after a tab-switch to avoid a catch-up spiral

  input.apply(sim);

  acc += dt;
  while (acc >= DT) {
    sim.step();
    acc -= DT;
  }

  renderer.render(sim);
  hud.update(sim);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
