// Client entry point. The game is ONLINE-ONLY: the default (and the player's only path) is
// multiplayer — connect to the authoritative server, the local Sim is NOT run, the client only
// sends intent + renders server snapshots via a network-backed IWorld. Two modes, chosen by URL:
//   • multiplayer (DEFAULT, no params) — connects to the server (VITE_SERVER_URL in production).
//   • single-player (?sp)              — DEV ESCAPE HATCH: runs the offline Sim locally (no server),
//                                        for offline/sim testing. Not a path normal players take.
//
// Note: performance.now() / Date.now() / Math.random() are fine HERE (the host). They
// are forbidden only inside src/sim/, which must stay deterministic.
import './render/model_cache'; // enable THREE.Cache at startup -> each player-model file downloads ONCE (proxy)
import { Sim, DT } from './sim/sim';
import { Renderer } from './render/renderer';
import { Input } from './game/input';
import { Hud } from './ui/hud';
import { WorldMap } from './ui/map';
import { ClassSelect } from './ui/class_select';
import { CombatText } from './ui/combat_text';
import { makeCombatFeedback } from './ui/combat_feedback';
import { Recorder, ClipRecorder } from './ui/recorder';
import { ClientWorld, type NetStatus } from './net/client_world';
import { MpHud } from './ui/mp_hud';
import { PartyHud } from './ui/party_hud';
import { DuelHud } from './ui/duel_hud';
import { PkHud } from './ui/pk_hud';
import { TeleporterHud } from './ui/teleporter_hud';
import { PartyMatching } from './ui/party_matching';
import { ChatBox } from './ui/chat';
import { MusicPlayer } from './ui/audio';
import { SettingsMenu } from './ui/settings_menu';
import { EscMenu } from './ui/esc_menu';
import { NameSelect, normalizeName, isValidName } from './ui/name_select';
import { installTheme } from './ui/theme';

const canvas = document.getElementById('game') as HTMLCanvasElement;

// Skin the whole UI with the "stone" medieval theme BEFORE any screen/HUD is built, so the very
// first screen the player sees is already themed (no flash). Global palette = basic; specific
// panels (e.g. the shop) opt into other palettes later. `?ui=legacy` is an instant rollback.
// Host-side, pure presentation — never touches the sim.
installTheme('basic');

// ONLINE-ONLY: multiplayer is the DEFAULT and the only path for players — no `?mp` needed. `?sp`
// is a hidden dev-only escape hatch that runs the offline Sim locally (no server) for testing;
// `?mp=<ws-url>` stays an OPTIONAL override to aim at a specific server (dev), never required.
const params = new URLSearchParams(location.search);
// Character creation (GDD v0.4 §1.3): resolve the player NAME *before* the world is
// built — online it's baked into the `join` handshake, offline (?sp) into the local player's
// spawn. `?name=` stays a shortcut: present + valid skips the screen; absent shows it.
withChosenName((name) => {
  // Default => ONLINE (server URL from VITE_SERVER_URL in prod, ws://localhost:8080 in dev, or an
  // explicit ?mp=<ws-url> override). `?sp` => the offline Sim, for dev/offline testing only.
  if (params.has('sp')) startOffline(name);
  else startOnline(resolveServerUrl(params.get('mp')), name);
});

// ---------- single-player (offline) — DEV ONLY, reached via ?sp (never a normal player path) ----------
function startOffline(name: string): void {
  const WORLD_SEED = 1337; // fixed seed -> the world is the same place every load

  const sim = new Sim(WORLD_SEED, true, name); // local player spawns with the chosen name
  const renderer = new Renderer(canvas);
  const input = new Input(canvas, renderer);
  const hud = new Hud();
  const map = new WorldMap(); // world map (tecla M) — zones + player position, SP and MP
  const teleporterHud = new TeleporterHud(sim); // GDD v0.5 TP3: hub menu (click the NPC) + Return button
  const music = new MusicPlayer(); // background music (cosmetic, reads IWorld; never touches the sim)
  new SettingsMenu(music); // settings (abre no Backspace / via menu Esc); self-driven
  new EscMenu(); // menu central (Esc): lista todos os painéis + atalhos; self-driven, no per-frame update
  // Class selection on entry (G1): pick a starter class -> the sim equips its weapon/kit.
  // The pick is the first user gesture, so it also unlocks audio (browser autoplay policy).
  new ClassSelect((classId) => {
    sim.sendCommand({ t: 'select-class', classId });
    music.unlock();
  });
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

    renderer.render(sim, null, acc / DT); // O1: pass the interpolation fraction (residual acc) to smooth 20Hz motion
    drawCombatFeedback(sim); // after render: project with this frame's updated camera
    hud.update(sim);
    map.update(sim);
    teleporterHud.update(sim, input); // TP3: hub menu (on teleporter-NPC click) + Return button state
    music.update(sim, dt); // crossfade city/combat/exploration by the player's context
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
  const map = new WorldMap(); // world map (tecla M) — same module as SP, reads IWorld
  const music = new MusicPlayer(); // background music (cosmetic, reads IWorld; same module as SP)
  new SettingsMenu(music); // settings (abre no Backspace / via menu Esc); self-driven
  new EscMenu(); // menu central (Esc): lista todos os painéis + atalhos; self-driven, no per-frame update
  // Class selection on entry (G1): pick a starter class -> the server equips its weapon/kit.
  // The pick is the first user gesture, so it also unlocks audio (browser autoplay policy).
  new ClassSelect((classId) => {
    world.sendCommand({ t: 'select-class', classId });
    music.unlock();
  });
  const mpHud = new MpHud(); // world-awareness overlay: connection status + names + mob HP bars
  const partyHud = new PartyHud(world); // co-op: party frames + create/invite/leave + invite popup
  const duelHud = new DuelHud(world); // PvP: active-duel banner + incoming-challenge popup (A3)
  const pkHud = new PkHud(); // PvP: free-PK warning (GDD v0.5 §2) — "zona PvP" / "PK armado" near the top
  const teleporterHud = new TeleporterHud(world); // GDD v0.5 TP3: hub menu (click the NPC) + Return button
  const partyMatching = new PartyMatching(world); // co-op: the E window — find/register groups (matching)
  const chat = new ChatBox(
    (text, channel) => world.sendChat(text, channel), // text chat (/p party · /g guild)
    (sub, arg) => world.guildCommand(sub, arg), // GDD v0.5 §1: /guild create|invite|accept|decline|leave|kick
  );
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
    // The server owns time-of-day + rain, so all clients share one sky (interpolated).
    renderer.render(world, world.weather()); // local player = Knight, others = Knights, mobs = avatars
    drawCombatFeedback(world); // after render: damage numbers from the server's events
    hud.update(world); // personal HUD: hp/mp/xp/level + action bar cooldowns + target frame
    map.update(world); // world map (M) — player position on the zones
    mpHud.update(world, renderer, statusLabel(world.status), world.playerCount());
    partyHud.update(world); // party frames + controls + invite popup (from localParty/localInvite)
    duelHud.update(world, renderer, input.duelTargetId()); // PvP: banner + challenge popup + floating "Duelar" button on the left-click-selected player
    pkHud.update(world, input.pkHeld()); // PvP: free-PK "zona PvP" / "PK armado" warning (GDD v0.5 §2)
    teleporterHud.update(world, input); // TP3: opens the hub menu on a teleporter-NPC click; drives the Return button state
    partyMatching.update(); // the E window — LFM list + register + pending requests (reads the world directly)
    music.update(world, dt); // crossfade city/combat/exploration by the player's context
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

// Resolve the player name, then start. `?name=` is a shortcut that skips the screen;
// otherwise the name-entry screen asks. The chosen name flows into world creation (SP:
// the local Sim player; MP: the `join` handshake, which the server uses as the save
// key). Host-only — no sim/protocol/IWorld change. The server re-validates the name.
function withChosenName(start: (name: string) => void): void {
  const fromUrl = params.get('name')?.trim();
  if (fromUrl && isValidName(fromUrl)) {
    start(normalizeName(fromUrl)); // ?name=… shortcut: skip the screen for a valid name
    return;
  }
  // No name, or an invalid ?name=: ask. An invalid value pre-fills the field so the
  // player can fix it rather than silently entering with a sub-minimum/garbage name.
  new NameSelect((name) => start(name), fromUrl ? { initial: fromUrl } : {});
}

function statusLabel(s: NetStatus): string {
  return s === 'online' ? 'conectado' : s === 'connecting' ? 'conectando…' : 'desconectado';
}
