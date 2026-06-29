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
import type { Sfx } from './sfx';

const FCT_WORLD_Y = 2.2; // height (just above the head) where damage numbers pop

// A small announcer surface — the offline Hud satisfies it; multiplayer can pass a
// lightweight shim. Kept narrow so combat feedback doesn't depend on the whole HUD.
export interface Announcer {
  announce(text: string): void;
}

// Build the per-frame feedback function. Call the returned function AFTER render() each
// frame (so projection uses the current camera). Maintains its own seq cursor.
export function makeCombatFeedback(renderer: Renderer, combatText: CombatText, announcer: Announcer, sfx?: Sfx) {
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
          // A crit pops bigger/hotter and gets a "!" — the payoff of the crit roll.
          const text = ev.crit ? `${ev.amount}!` : String(ev.amount);
          combatText.spawn(p.x, p.y, text, incoming ? 'hurt' : 'damage', ev.crit ?? false);
        }
        // A subtle camera kick on a crit that involves ME (I landed it on my target, or I took it).
        const mine = ev.targetId === world.localPlayerId() || ev.targetId === world.localTargetId();
        if (ev.crit && mine) renderer.shake(0.06, 0.12);
        // Combat SFX, gated to me so a crowded MP fight doesn't turn into a wall of noise.
        if (sfx) {
          if (ev.targetId === world.localPlayerId()) sfx.hurt(); // I got bitten
          else if (ev.targetId === world.localTargetId()) ev.crit ? sfx.crit() : sfx.hit(); // I hit my target
        }
      } else if (ev.kind === 'levelup') {
        renderer.flash(ev.targetId);
        const p = renderer.project(ev.x, FCT_WORLD_Y + 0.6, ev.z);
        if (p.visible) combatText.spawn(p.x, p.y, `NÍVEL ${ev.amount}!`, 'levelup');
        if (ev.targetId === world.localPlayerId()) sfx?.levelUp();
      } else if (ev.kind === 'enhance-success') {
        renderer.flash(ev.targetId);
        const p = renderer.project(ev.x, FCT_WORLD_Y + 0.6, ev.z);
        if (p.visible) combatText.spawn(p.x, p.y, `Refino +${ev.amount}!`, 'levelup');
        if (ev.targetId === world.localPlayerId()) sfx?.enhanceSuccess();
      } else if (ev.kind === 'enhance-fail') {
        const p = renderer.project(ev.x, FCT_WORLD_Y + 0.6, ev.z);
        if (p.visible) combatText.spawn(p.x, p.y, `Falhou (+${ev.amount})`, 'fail');
        if (ev.targetId === world.localPlayerId()) sfx?.enhanceFail();
      } else if (ev.kind === 'enhance-break') {
        // K4: a high-"+" failure destroyed the item. Distinct destructive feedback.
        renderer.flash(ev.targetId);
        const p = renderer.project(ev.x, FCT_WORLD_Y + 0.6, ev.z);
        if (p.visible) combatText.spawn(p.x, p.y, 'QUEBROU!', 'fail');
        if (ev.targetId === world.localPlayerId()) sfx?.enhanceBreak();
      } else if (ev.kind === 'heal') {
        renderer.flash(ev.targetId);
        const p = renderer.project(ev.x, FCT_WORLD_Y + 0.6, ev.z);
        if (p.visible) combatText.spawn(p.x, p.y, `+${ev.amount}`, 'heal');
        if (ev.targetId === world.localPlayerId()) sfx?.heal();
      } else if (ev.kind === 'boss-spawn') {
        announcer.announce(`Um chefe surgiu: ${ev.text ?? 'Chefe'}!`);
        sfx?.boss();
      } else if (ev.kind === 'boss-defeat') {
        // The sim composes the full line ("Fulano derrotou [Chefe]"); show it as-is.
        announcer.announce(ev.text ?? 'Um chefe foi derrotado!');
        renderer.shake(0.16, 0.3); // an epic moment — a clear thump for everyone
        sfx?.boss();
      } else if (ev.kind === 'boss-summon') {
        announcer.announce(`${ev.text ?? 'O chefe'} chama a matilha!`);
        sfx?.boss();
      } else if (ev.kind === 'pk-kill') {
        // PK livre: the sim composes the full kill-feed line ("X derrotou Y"); show it to everyone.
        announcer.announce(ev.text ?? 'Um jogador foi morto em PK!');
        sfx?.pkKill();
      } else if (ev.kind === 'death') {
        const me = ev.targetId === world.localPlayerId();
        announcer.announce(me ? 'Você morreu! Renascendo...' : `${ev.text ?? 'Um jogador'} morreu.`);
        // A heavier kick when I go down, or when the player I'm fighting does.
        if (me || ev.targetId === world.localTargetId()) { renderer.shake(0.13, 0.24); sfx?.death(); }
      } else if (ev.kind === 'respawn') {
        const me = ev.targetId === world.localPlayerId();
        announcer.announce(me ? 'Você renasceu.' : `${ev.text ?? 'Um jogador'} renasceu.`);
      }
    }
  };
}
