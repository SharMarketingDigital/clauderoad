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
import { makeCombatFeedback } from './ui/combat_feedback';
import { Recorder, ClipRecorder } from './ui/recorder';
import { ClientWorld, type NetStatus } from './net/client_world';
import { MpHud } from './ui/mp_hud';
import { ChatBox } from './ui/chat';

const canvas = document.getElementById('game') as HTMLCanvasElement;

// Multiplayer is OPT-IN (?mp, or ?mp=ws://host:port). No flag => the offline game,
// completely unchanged. So the single-player experience can never break by accident.
const params = new URLSearchParams(location.search);
if (params.has('mp')) startOnline(resolveServerUrl(params.get('mp')), playerName(params));
else startOffline();

// ---------- single-player (offline) ----------
function startOffline(): void {
  const WORLD_SEED = 1337; // fixed seed -> the world is the same place every load

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

  // Turn new sim events into presentation (hit flash + damage number, level-up, etc.).
  // The SAME helper runs in multiplayer, reading the networked world's events.
  const drawCombatFeedback = makeCombatFeedback(renderer, combatText, hud);

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
    drawCombatFeedback(sim); // after render: project with this frame's updated camera
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
  const hud = new Hud(); // the FULL personal HUD, driven by OUR `self` state from the server
  const mpHud = new MpHud(); // world-awareness overlay: connection status + names + mob HP bars
  const chat = new ChatBox((text) => world.sendChat(text)); // text chat (Enter to open)
  world.onChat = (line) => chat.add(line); // server-broadcast lines flow into the chat box
  const combatText = new CombatText();
  // SAME feedback as offline: the server streams combat events, we pop damage numbers,
  // flash the hit, and the Hud banners deaths/boss spawns — identically on every client.
  const drawCombatFeedback = makeCombatFeedback(renderer, combatText, hud);

  let last = performance.now() / 1000;
  function frame(): void {
    const now = performance.now() / 1000;
    let dt = now - last;
    last = now;
    if (dt > 0.25) dt = 0.25;

    input.apply(world); // WASD + Tab/click/1-9 -> intent to the server (it decides combat)
    world.update(dt); // advance snapshot interpolation
    renderer.render(world); // local player = Knight, other players = capsules, mobs = avatars
    drawCombatFeedback(world); // after render: damage numbers from the server's events
    hud.update(world); // personal HUD: hp/mp/xp/level + action bar cooldowns + target frame
    mpHud.update(world, renderer, statusLabel(world.status), world.playerCount());
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);
}

// Server URL precedence: ?mp=<ws-url>  >  VITE_SERVER_URL (env)  >  ws://<host>:8080.
// VITE_SERVER_URL is the production default (e.g. wss://api.meujogo.com on Vercel);
// both ws:// and wss:// (secure) are supported. Unset -> local-dev fallback.
function resolveServerUrl(arg: string | null): string {
  if (arg && /^wss?:\/\//.test(arg)) return arg; // explicit ?mp=ws(s)://host:port
  const fromEnv = import.meta.env.VITE_SERVER_URL; // inlined by Vite at build time
  if (fromEnv) return fromEnv;
  return `ws://${location.hostname || 'localhost'}:8080`;
}

function playerName(p: URLSearchParams): string {
  return p.get('name')?.trim() || `Jogador ${Math.floor(Math.random() * 900 + 100)}`;
}

function statusLabel(s: NetStatus): string {
  return s === 'online' ? 'conectado' : s === 'connecting' ? 'conectando…' : 'desconectado';
}
