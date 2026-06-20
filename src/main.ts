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
import { Recorder, ClipRecorder } from './ui/recorder';

const WORLD_SEED = 1337; // fixed seed -> the world is the same place every load
const FCT_WORLD_Y = 2.2; // height (just above the head) where damage numbers pop

const canvas = document.getElementById('game') as HTMLCanvasElement;
const sim = new Sim(WORLD_SEED);
const renderer = new Renderer(canvas);
const input = new Input(canvas, renderer);
const hud = new Hud();
const combatText = new CombatText();
new Recorder(canvas); // in-game ● REC button (captures the 3D canvas to .webm)
// 🎬 Clipe: one-click 15s auto-clip in two files (clean + with-HUD) for the "Dia N"
// evolution series. Decoupled via small hooks — it never imports Sim/Renderer directly.
new ClipRecorder(canvas, {
  isBotOn: () => sim.botActive(),
  setBot: (on) => sim.sendCommand({ t: 'set-bot', on }),
  getTarget: () => sim.localTargetId(),
  setTarget: (id) => sim.sendCommand({ t: 'set-target', id }),
  setClipTime: (t) => renderer.setClipTime(t),
  setClipCamera: (on) => renderer.setClipCamera(on),
});

let last = performance.now() / 1000;
let acc = 0;
let lastEventSeq = 0; // cursor: highest sim event seq already turned into visuals

// Turn new sim events into presentation: hit flash + damage number, or a
// level-up flash + banner.
function drawCombatFeedback(): void {
  for (const ev of sim.recentEvents()) {
    if (ev.seq <= lastEventSeq) continue;
    lastEventSeq = ev.seq;
    if (ev.kind === 'damage') {
      renderer.flash(ev.targetId);
      const p = renderer.project(ev.x, FCT_WORLD_Y, ev.z);
      // Damage TO the player reads red ('hurt'); damage we deal stays the default.
      if (p.visible) {
        const incoming = ev.targetId === sim.localPlayerId();
        combatText.spawn(p.x, p.y, String(ev.amount), incoming ? 'hurt' : 'damage');
      }
    } else if (ev.kind === 'levelup') {
      renderer.flash(ev.targetId); // flash the player
      const p = renderer.project(ev.x, FCT_WORLD_Y + 0.6, ev.z);
      if (p.visible) combatText.spawn(p.x, p.y, `NÍVEL ${ev.amount}!`, 'levelup');
    } else if (ev.kind === 'enhance-success') {
      renderer.flash(ev.targetId);
      const p = renderer.project(ev.x, FCT_WORLD_Y + 0.6, ev.z);
      if (p.visible) combatText.spawn(p.x, p.y, `Refino +${ev.amount}!`, 'levelup');
    } else if (ev.kind === 'enhance-fail') {
      const p = renderer.project(ev.x, FCT_WORLD_Y + 0.6, ev.z);
      if (p.visible) combatText.spawn(p.x, p.y, `Falhou (+${ev.amount})`, 'fail');
    } else if (ev.kind === 'heal') {
      renderer.flash(ev.targetId);
      const p = renderer.project(ev.x, FCT_WORLD_Y + 0.6, ev.z);
      if (p.visible) combatText.spawn(p.x, p.y, `+${ev.amount}`, 'heal');
    } else if (ev.kind === 'boss-spawn') {
      hud.announce(`Um chefe surgiu: ${ev.text ?? 'Chefe'}!`);
    } else if (ev.kind === 'boss-defeat') {
      hud.announce(`${ev.text ?? 'O chefe'} foi derrotado!`);
    } else if (ev.kind === 'boss-summon') {
      hud.announce(`${ev.text ?? 'O chefe'} chama a matilha!`);
    } else if (ev.kind === 'death') {
      hud.announce('Você morreu! Renascendo...');
    } else if (ev.kind === 'respawn') {
      hud.announce('Você renasceu.');
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

  renderer.render(sim);
  drawCombatFeedback(); // after render: project with this frame's updated camera
  hud.update(sim);
  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
