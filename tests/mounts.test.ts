// Sistema 15 (QoL) — Mounts. Fiel aos ITEM_COS_T_* do Silkroad: o item é um token de invocação; a montaria
// multiplica a velocidade de movimento (só locomoção) e DESMONTA ao entrar em combate (via combatUntil).
// Flag por-player (molde pkActive), não uma entidade seguidora. Puro/determinístico (posição/velocidade
// são aritmética, sem Rng). Testado headless no sim.
import { describe, it, expect } from 'vitest';
import { Sim } from '../src/sim/sim';
import { MOUNTS } from '../src/sim/content/mounts';
import { TOWN_SHOPS } from '../src/sim/content/vendor';

const player = (sim: Sim) => sim.entities().find((e) => e.kind === 'player')!;

function withMount(sim: Sim, extraHp = 0): void {
  const pid = sim.localPlayerId()!;
  const save = sim.serializePlayer(pid)!;
  if (extraHp) save.baseMaxHp = extraHp;
  save.bag = [{ itemId: 'mount_horse', rarity: 'normal', plus: 0, qty: 1 }];
  sim.restorePlayer(pid, save);
}

describe('Sistema 15: Mounts', () => {
  it('montado anda mais rápido que a pé (speedMult ~1.5×)', () => {
    // Mede a distância andada em N ticks numa direção segura (dentro da vila), montado vs a pé.
    const walked = (mount: boolean): number => {
      const sim = new Sim(7);
      withMount(sim);
      if (mount) {
        sim.sendCommand({ t: 'set-mount', on: true });
        sim.step();
        expect(sim.mountActive()).toBe(true);
      }
      const p0 = player(sim);
      const x0 = p0.x;
      const z0 = p0.z;
      for (let i = 0; i < 10; i++) {
        sim.sendCommand({ t: 'move', dx: 0, dz: 1 }); // norte, curto -> fica na vila (sem parede/combate)
        sim.step();
      }
      const p1 = player(sim);
      return Math.hypot(p1.x - x0, p1.z - z0);
    };
    const onFoot = walked(false);
    const onMount = walked(true);
    expect(onFoot).toBeGreaterThan(0);
    expect(onMount).toBeGreaterThan(onFoot * 1.4); // ~1.5× (MOUNTS.horse.speedMult)
    expect(onMount / onFoot).toBeCloseTo(MOUNTS.horse.speedMult, 1);
  });

  it('não monta sem possuir o token de montaria', () => {
    const sim = new Sim(7); // bag sem mount_horse
    sim.sendCommand({ t: 'set-mount', on: true });
    sim.step();
    expect(sim.mountActive()).toBe(false);
  });

  it('monta e desmonta pelo comando (toggle)', () => {
    const sim = new Sim(7);
    withMount(sim);
    sim.sendCommand({ t: 'set-mount', on: true });
    sim.step();
    expect(sim.mountActive()).toBe(true);
    sim.sendCommand({ t: 'set-mount', on: false });
    sim.step();
    expect(sim.mountActive()).toBe(false);
  });

  it('DESMONTA ao entrar em combate (montaria é só locomoção)', () => {
    const sim = new Sim(7);
    withMount(sim, 1000); // HP alto pra não morrer no processo
    sim.sendCommand({ t: 'set-mount', on: true });
    sim.step();
    expect(sim.mountActive()).toBe(true);
    // anda até um lobo até tomar dano -> combatUntil setado -> auto-desmonta
    for (let i = 0; i < 500 && sim.mountActive(); i++) {
      const p = player(sim);
      const w = sim.entities().find((e) => e.kind === 'enemy' && !e.boss && e.hp > 0);
      if (w) sim.sendCommand({ t: 'move', dx: w.x - p.x, dz: w.z - p.z });
      sim.step();
    }
    expect(sim.mountActive()).toBe(false); // desmontou ao entrar em combate
  });

  it('DESMONTA ao perder o token (vender/listar) — não fica montado 1.5× sem a montaria', () => {
    const sim = new Sim(7);
    withMount(sim);
    sim.sendCommand({ t: 'set-mount', on: true });
    sim.step();
    expect(sim.mountActive()).toBe(true);
    // lista o token no mercado global (remove do bag) -> perde a posse da montaria
    sim.sendCommand({ t: 'market-list', itemId: 'mount_horse', rarity: 'normal', plus: 0, price: 100 });
    sim.step();
    expect(sim.inventory().stacks.some((s) => s.itemId === 'mount_horse')).toBe(false); // token saiu do bag
    expect(sim.mountActive()).toBe(false); // e o sim desmontou (a re-checagem de posse no stepPlayer)
  });

  it('o alquimista vende a montaria', () => {
    const alch = TOWN_SHOPS.find((s) => s.species === 'alchemist')!;
    expect(alch.stock.some((e) => e.itemId === 'mount_horse')).toBe(true);
  });

  it('é determinístico (mesmo seed + comandos => hash idêntico)', () => {
    const run = (): string => {
      const sim = new Sim(7);
      withMount(sim);
      sim.sendCommand({ t: 'set-mount', on: true });
      sim.step();
      for (let i = 0; i < 20; i++) {
        sim.sendCommand({ t: 'move', dx: 1, dz: 0 });
        sim.step();
      }
      return sim.hash();
    };
    expect(run()).toBe(run());
  });
});
