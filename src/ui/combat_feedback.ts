// Turns world events (a hit landed, a level-up, a death…) into on-screen presentation:
// a hit flash, a floating damage/heal number, boss/death announcements. It reads ONLY
// IWorld.recentEvents(), so it works identically for the offline Sim and the networked
// ClientWorld — the same damage numbers pop whether combat ran locally or on the server.
//
// De-dups by event `seq` (monotonic), so each event is drawn exactly once no matter how
// many frames it stays in the recent-events window.
import type { IWorld } from '../world_api';
import type { Renderer } from '../render/renderer';
import type { CombatText } from './combat_text';

const FCT_WORLD_Y = 2.2; // height (just above the head) where damage numbers pop

// A small announcer surface — the offline Hud satisfies it; multiplayer can pass a
// lightweight shim. Kept narrow so combat feedback doesn't depend on the whole HUD.
export interface Announcer {
  announce(text: string): void;
}

// Build the per-frame feedback function. Call the returned function AFTER render() each
// frame (so projection uses the current camera). Maintains its own seq cursor.
export function makeCombatFeedback(renderer: Renderer, combatText: CombatText, announcer: Announcer) {
  let lastEventSeq = 0;
  return (world: IWorld): void => {
    for (const ev of world.recentEvents()) {
      if (ev.seq <= lastEventSeq) continue;
      lastEventSeq = ev.seq;
      if (ev.kind === 'damage') {
        renderer.flash(ev.targetId);
        const p = renderer.project(ev.x, FCT_WORLD_Y, ev.z);
        if (p.visible) {
          const incoming = ev.targetId === world.localPlayerId();
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
        announcer.announce(`Um chefe surgiu: ${ev.text ?? 'Chefe'}!`);
      } else if (ev.kind === 'boss-defeat') {
        announcer.announce(`${ev.text ?? 'O chefe'} foi derrotado!`);
      } else if (ev.kind === 'boss-summon') {
        announcer.announce(`${ev.text ?? 'O chefe'} chama a matilha!`);
      } else if (ev.kind === 'death') {
        const me = ev.targetId === world.localPlayerId();
        announcer.announce(me ? 'Você morreu! Renascendo...' : `${ev.text ?? 'Um jogador'} morreu.`);
      } else if (ev.kind === 'respawn') {
        const me = ev.targetId === world.localPlayerId();
        announcer.announce(me ? 'Você renasceu.' : `${ev.text ?? 'Um jogador'} renasceu.`);
      }
    }
  };
}
