// Client entry point. Two modes, chosen by the URL:
//   • single-player (default)  — runs the offline Sim locally (unchanged).
//   • multiplayer  (?mp)       — connects to the authoritative server; the local Sim
//                                is NOT run, the client only sends intent + renders
//                                server snapshots via a network-backed IWorld.
//
// Note: performance.now() / Date.now() / Math.random() are fine HERE (the host). They
// are forbidden only inside src/sim/, which must stay deterministic.
import { Sim, DT } from './sim/sim';
import { Renderer } from './render/renderer';
import { Input } from './game/input';
import { Hud } from './ui/hud';
import { CombatText } from './ui/combat_text';
import { Recorder, ClipRecorder } from './ui/recorder';
import { ClientWorld, type NetStatus } from './net/client_world';
import { MpHud } from './ui/mp_hud';

const canvas = document.getElementById('game') as HTMLCanvasElement;

// Multiplayer is OPT-IN (?mp, or ?mp=ws://host:port). No flag => the offline game,
// completely unchanged. So the single-player experience can never break by accident.
const params = new URLSearchParams(location.search);
if (params.has('mp')) startOnline(resolveServerUrl(params.get('mp')), playerName(params));
else startOffline();

// ---------- single-player (offline) ----------
function startOffline(): void {
  const WORLD_SEED = 1337; // fixed seed -> the world is the same place every load
  const FCT_WORLD_Y = 2.2; // height (just above the head) where damage numbers pop

  const sim = new Sim(WORLD_SEED);
  const renderer = new Renderer(canvas);
  const input = new Input(canvas, renderer);
  const hud = new Hud();
  const combatText = new CombatText();
  new Recorder(canvas); // in-game ● REC button (captures the 3D canvas to .webm)
  // 🎬 Clipe: one-click auto-clip in three files (clean + with-HUD + vertical 9:16).
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

  // Turn new sim events into presentation: hit flash + damage number, level-up, etc.
  function drawCombatFeedback(): void {
    for (const ev of sim.recentEvents()) {
      if (ev.seq <= lastEventSeq) continue;
      lastEventSeq = ev.seq;
      if (ev.kind === 'damage') {
        renderer.flash(ev.targetId);
        const p = renderer.project(ev.x, FCT_WORLD_Y, ev.z);
        if (p.visible) {
          const incoming = ev.targetId === sim.localPlayerId();
          combatText.spawn(p.x, p.y, String(ev.amount), incoming ? 'hurt' : 'damage');
        }
      } else if (ev.kind === 'levelup') {
        renderer.flash(ev.targetId);
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
}

// ---------- multiplayer (online) ----------
function startOnline(url: string, name: string): void {
  const renderer = new Renderer(canvas);
  const input = new Input(canvas, renderer);
  const world = new ClientWorld(url, name); // a network-backed IWorld
  const mpHud = new MpHud();

  let last = performance.now() / 1000;
  function frame(): void {
    const now = performance.now() / 1000;
    let dt = now - last;
    last = now;
    if (dt > 0.25) dt = 0.25;

    input.apply(world); // WASD -> camera-relative direction -> move-intent to the server
    world.update(dt); // advance snapshot interpolation
    renderer.render(world); // local player = Knight, other players = capsules
    mpHud.update(world, renderer, statusLabel(world.status), world.playerCount());
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Server URL precedence: ?mp=<ws-url>  >  VITE_SERVER_URL (.env)  >  ws://<host>:8080.
function resolveServerUrl(arg: string | null): string {
  if (arg && /^wss?:\/\//.test(arg)) return arg;
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  if (env.VITE_SERVER_URL) return env.VITE_SERVER_URL;
  return `ws://${location.hostname || 'localhost'}:8080`;
}

function playerName(p: URLSearchParams): string {
  return p.get('name')?.trim() || `Jogador ${Math.floor(Math.random() * 900 + 100)}`;
}

function statusLabel(s: NetStatus): string {
  return s === 'online' ? 'conectado' : s === 'connecting' ? 'conectando…' : 'desconectado';
}
