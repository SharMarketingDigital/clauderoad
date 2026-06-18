// Client entry point. Wires the offline Sim to the renderer, input and HUD,
// and runs a FIXED-TIMESTEP loop so gameplay speed never depends on framerate.
//
// Note: performance.now() is fine HERE (the host loop). It is forbidden only
// inside src/sim/, which must stay deterministic.
import { Sim, DT } from './sim/sim';
import { Renderer } from './render/renderer';
import { Input } from './game/input';
import { Hud } from './ui/hud';
import { CombatText } from './ui/combat_text';

const WORLD_SEED = 1337; // fixed seed -> the world is the same place every load
const FCT_WORLD_Y = 2.2; // height (just above the head) where damage numbers pop

const canvas = document.getElementById('game') as HTMLCanvasElement;
const sim = new Sim(WORLD_SEED);
const renderer = new Renderer(canvas);
const input = new Input(canvas, renderer);
const hud = new Hud();
const combatText = new CombatText();

let last = performance.now() / 1000;
let acc = 0;
let lastEventSeq = 0; // cursor: highest sim event seq already turned into visuals

// Turn new sim events into presentation: flash the hit model + pop a number.
function drawCombatFeedback(): void {
  for (const ev of sim.recentEvents()) {
    if (ev.seq <= lastEventSeq) continue;
    lastEventSeq = ev.seq;
    if (ev.kind === 'damage') {
      renderer.flash(ev.targetId);
      const p = renderer.project(ev.x, FCT_WORLD_Y, ev.z);
      if (p.visible) combatText.spawn(p.x, p.y, ev.amount);
    }
  }
}

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

  drawCombatFeedback();
  renderer.render(sim);
  hud.update(sim);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
