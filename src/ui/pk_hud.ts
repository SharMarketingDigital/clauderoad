// GDD v0.5 (PK livre §2): a small top-of-screen warning telling the local player when they are in a
// PvP-enabled area (OUTSIDE any city, where free PK can happen) and whether PK is currently ARMED
// (holding ALT). Pure presentation — reads the world (IWorld) + the host's ALT flag; never touches the
// sim. Wired into the ONLINE loop only (PK needs two players), mirroring how the DuelHud is wired.
import type { IWorld } from '../world_api';
import { zoneAt } from '../sim/zones';

export class PkHud {
  private banner = document.createElement('div');

  constructor() {
    const b = this.banner;
    // Self-contained inline styling (no CSS coordination needed): a compact banner near the top centre.
    b.style.cssText = [
      'position:absolute',
      'top:42px', // sit below a possible duel banner at the very top
      'left:50%',
      'transform:translateX(-50%)',
      'padding:5px 14px',
      'border-radius:6px',
      'font:600 13px sans-serif',
      'pointer-events:none',
      'z-index:30',
      'display:none',
      'white-space:nowrap',
      'border:1px solid rgba(255,59,59,0.5)',
      'box-shadow:0 1px 6px rgba(0,0,0,0.4)',
    ].join(';');
    document.body.append(b);
  }

  // `pkHeld` = the host's ALT state (Input.pkHeld()), for the immediate "armed" cue with no server round-trip.
  update(world: IWorld, pkHeld: boolean): void {
    const id = world.localPlayerId();
    const me = id != null ? world.entities().find((e) => e.id === id) : undefined;
    // Only relevant once you exist and stand OUTSIDE a city safe-zone (the only place PK is possible).
    const inPvpArea = !!me && !me.dead && !zoneAt(me.x, me.z).safe;
    if (!inPvpArea) {
      this.banner.style.display = 'none';
      return;
    }
    this.banner.style.display = 'block';
    if (pkHeld) {
      this.banner.textContent = '⚔ PK ARMADO — clique num jogador pra atacar';
      this.banner.style.background = 'rgba(120,20,20,0.85)';
      this.banner.style.color = '#ffd9d9';
    } else {
      this.banner.textContent = '⚠ Zona PvP — segure ALT pra atacar jogadores';
      this.banner.style.background = 'rgba(40,20,20,0.7)';
      this.banner.style.color = '#ffb9a8';
    }
  }
}
