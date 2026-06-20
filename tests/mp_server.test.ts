// Server-boundary tests: ServerWorld wraps the full Sim and is the authoritative seam
// the clients talk to. These assert the per-LAYER guarantees — what intent it accepts,
// and the PERSONAL state (HUD/bag) it hands back to each player. Layer 1 = combat + HUD.
import { describe, it, expect } from 'vitest';
import { ServerWorld } from '../server/world';

const enemyId = (w: ServerWorld) => w.snapshot().entities.find((e) => e.kind === 'enemy')!.id;
const selfOf = (w: ServerWorld, id: number) => w.snapshot().entities.find((e) => e.id === id)!;

describe('ServerWorld — Layer 1: combat commands + personal HUD', () => {
  it('hands each player its OWN self state (HUD + action bar)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    const sa = w.selfState(a);
    expect(sa.abilities.length).toBeGreaterThan(0); // a real action bar
    expect(sa.maxHp).toBeGreaterThan(0);
    expect(sa.maxMp).toBeGreaterThan(0);
    expect(sa.targetId).toBeNull();
    expect(w.selfState(b).targetId).toBeNull();
  });

  it('accepts set-target (combat) and keeps it PER PLAYER', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const b = w.addPlayer('B');
    const eid = enemyId(w);
    w.command(a, { t: 'set-target', id: eid });
    w.step();
    expect(w.selfState(a).targetId).toBe(eid); // A locked on
    expect(w.selfState(b).targetId).toBeNull(); // B unaffected — independent
  });

  it('rejects a command not wired in this layer (set-bot stays off)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    w.command(a, { t: 'set-bot', on: true }); // Layer 4 — not accepted yet
    w.step();
    expect(w.selfState(a).botActive).toBe(false);
  });

  it('routes use-ability — a cast fires on the server (MP spent or cooldown started)', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    const eid = enemyId(w);
    const mp0 = w.selfState(a).maxMp;
    let cast = false;
    for (let i = 0; i < 500 && !cast; i++) {
      const me = selfOf(w, a);
      const t = w.snapshot().entities.find((e) => e.id === eid);
      if (!t) break;
      w.setIntent(a, t.x - me.x, t.z - me.z); // close the distance
      w.command(a, { t: 'set-target', id: eid });
      w.command(a, { t: 'use-ability', slot: 1 });
      w.step();
      const self = w.selfState(a);
      const slot1 = self.abilities.find((x) => x.slot === 1);
      if (self.mp < mp0 || (slot1 != null && slot1.cooldownRemaining > 0)) cast = true;
    }
    expect(cast).toBe(true); // the ability was accepted + processed by the sim
  });

  it('snapshot is shared, self is personal — both reflect the same authoritative world', () => {
    const w = new ServerWorld(1337);
    const a = w.addPlayer('A');
    for (let i = 0; i < 10; i++) w.step();
    const snap = w.snapshot();
    const meInSnap = snap.entities.find((e) => e.id === a)!;
    const self = w.selfState(a);
    expect(meInSnap.hp).toBe(self.hp); // the shared view and the personal view agree
    expect(meInSnap.maxHp).toBe(self.maxHp);
  });
});
