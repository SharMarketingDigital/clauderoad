// Teleporte entre cidades (TP1) — server-mode Sim (no local player; clients join via addPlayer),
// applying each command on its own tick like party/pvp. The teleport moves the player to another
// city's centre for a fixed gold cost, only when standing at a city teleport point.
import { describe, it, expect } from 'vitest';
import { Sim, RETURN_COOLDOWN_TICKS } from '../src/sim/sim';
import { TELEPORT_COST, TELEPORT_RANGE } from '../src/sim/teleport';
import { chebyshev } from '../src/sim/zones';
import type { Command } from '../src/world_api';

function serverSim(seed = 1): Sim {
  return new Sim(seed, /* spawnLocal */ false);
}
function run(sim: Sim, id: number, cmd: Command): void {
  sim.sendCommandFor(id, cmd);
  sim.step(); // queued commands apply inside step()
}
const ent = (sim: Sim, id: number) => sim.entities().find((e) => e.id === id)!;

describe('teleporte entre cidades (TP1)', () => {
  it('teleporta da cidade central pra Vila do Leste, descontando o custo fixo', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A'); // spawns at (0,0) = the central city's teleport point
    sim.restorePlayer(a, { gold: 1000 });
    const g0 = ent(sim, a).gold;
    run(sim, a, { t: 'teleport', cityId: 'leste' });
    const e = ent(sim, a);
    expect(e.x).toBe(250); // moved to Vila do Leste's centre
    expect(e.z).toBe(0);
    expect(e.gold).toBe(g0 - TELEPORT_COST); // paid the fixed cost
  });

  it('volta da Vila do Leste pra central (round-trip pelo NPC de lá)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' });
    expect(ent(sim, a).x).toBe(250);
    run(sim, a, { t: 'teleport', cityId: 'town' }); // now at Leste's teleporter -> back to the centre
    expect(ent(sim, a).x).toBe(0);
    expect(ent(sim, a).z).toBe(0);
  });

  it('só teleporta perto do NPC do centro (longe da cidade = no-op)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    sim.sendCommandFor(a, { t: 'move', dx: 1, dz: 0 });
    for (let i = 0; i < 60; i++) sim.step(); // walk east, out of the central teleporter's range
    sim.sendCommandFor(a, { t: 'stop' });
    sim.step();
    const before = ent(sim, a);
    expect(Math.hypot(before.x, before.z)).toBeGreaterThan(TELEPORT_RANGE); // away from any city centre
    run(sim, a, { t: 'teleport', cityId: 'leste' });
    const after = ent(sim, a);
    expect(after.x).not.toBe(250); // did NOT teleport (not at a teleport point)
    expect(after.gold).toBe(before.gold); // and spent no gold
  });

  it('exige gold suficiente (sem gold = no-op)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' }); // park at Leste's exact centre (a known position)
    expect(ent(sim, a).x).toBe(250);
    sim.restorePlayer(a, { gold: TELEPORT_COST - 1 }); // now one gold short (position is unchanged by restore)
    run(sim, a, { t: 'teleport', cityId: 'town' });
    expect(ent(sim, a).x).toBe(250); // still at Leste — couldn't afford the trip
    expect(ent(sim, a).gold).toBe(TELEPORT_COST - 1); // unchanged
  });

  it('ignora destino desconhecido ou a propria cidade', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' }); // park at Leste's exact centre
    expect(ent(sim, a).x).toBe(250);
    const goldAtLeste = ent(sim, a).gold;
    run(sim, a, { t: 'teleport', cityId: 'leste' }); // same city you're standing in -> no-op
    expect(ent(sim, a).x).toBe(250);
    run(sim, a, { t: 'teleport', cityId: 'cidade-fantasma' }); // unknown destination -> no-op
    expect(ent(sim, a).x).toBe(250);
    expect(ent(sim, a).gold).toBe(goldAtLeste); // no extra gold spent
  });

  it('e deterministico (mesma seed + comandos => mesmo hash)', () => {
    const play = (): string => {
      const sim = serverSim(7);
      const a = sim.addPlayer('A');
      sim.restorePlayer(a, { gold: 1000 });
      run(sim, a, { t: 'teleport', cityId: 'leste' });
      run(sim, a, { t: 'teleport', cityId: 'town' });
      for (let i = 0; i < 10; i++) sim.step();
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});

// Cadastrar cidade de retorno (TP2a) — the player REGISTERS a hub (at its teleporter NPC); that city
// becomes their Return/respawn point and persists in the save. returnCity isn't on the EntityView, so
// we read it through the persistence seam: serializePlayer(id).returnCity.
describe('cadastrar cidade de retorno (TP2a)', () => {
  const regCity = (sim: Sim, id: number): string | undefined => sim.serializePlayer(id)?.returnCity;

  it('um jogador novo tem a cidade central como retorno por padrão', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    expect(regCity(sim, a)).toBe('town');
  });

  it('cadastra a cidade onde o jogador está (no NPC de cada hub)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' }); // viaja ao hub leste
    run(sim, a, { t: 'register-city' }); // cadastra ali
    expect(regCity(sim, a)).toBe('leste');
    run(sim, a, { t: 'teleport', cityId: 'town' }); // volta à central
    run(sim, a, { t: 'register-city' }); // re-cadastra na central
    expect(regCity(sim, a)).toBe('town'); // o cadastro sempre aponta pro hub atual
  });

  it('cadastrar longe de qualquer hub é no-op (mantém o último cadastro)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' });
    run(sim, a, { t: 'register-city' }); // cadastra leste
    sim.sendCommandFor(a, { t: 'move', dx: 1, dz: 0 });
    for (let i = 0; i < 120; i++) sim.step(); // anda pra longe do centro de leste
    sim.sendCommandFor(a, { t: 'stop' });
    sim.step();
    expect(Math.hypot(ent(sim, a).x - 250, ent(sim, a).z)).toBeGreaterThan(TELEPORT_RANGE); // fora do NPC
    run(sim, a, { t: 'register-city' }); // sem NPC por perto -> no-op
    expect(regCity(sim, a)).toBe('leste'); // segue o último cadastro válido
  });

  it('persiste no save e ignora cidade desconhecida ao restaurar', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' });
    run(sim, a, { t: 'register-city' });
    const saved = sim.serializePlayer(a)!;
    expect(saved.returnCity).toBe('leste'); // round-trips through the save

    const b = sim.addPlayer('B');
    sim.restorePlayer(b, saved); // carrega o save do A num personagem novo
    expect(regCity(sim, b)).toBe('leste'); // cidade cadastrada restaurada

    const c = sim.addPlayer('C');
    sim.restorePlayer(c, { returnCity: 'cidade-fantasma' }); // id inválido no save
    expect(regCity(sim, c)).toBe('town'); // mantém o default seguro (nunca aceita id desconhecido)
  });

  it('cadastrar é deterministico (mesma seed + comandos => mesmo hash)', () => {
    const play = (): string => {
      const sim = serverSim(7);
      const a = sim.addPlayer('A');
      sim.restorePlayer(a, { gold: 1000 });
      run(sim, a, { t: 'teleport', cityId: 'leste' });
      run(sim, a, { t: 'register-city' });
      for (let i = 0; i < 10; i++) sim.step();
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});

// Return / recall (TP2b) — a FREE warp to the player's REGISTERED city from anywhere, gated by a
// cooldown and BLOCKED while in combat (a duel, or a mob aggroed on the player). Server-mode Sim like
// TP1/TP2a; returnCity is the default 'town' unless register-city was used.
describe('return / recall (TP2b)', () => {
  it('recall gratis pra cidade cadastrada (default = central) de qualquer lugar', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' }); // longe da central (250,0)
    expect(ent(sim, a).x).toBe(250);
    const goldBefore = ent(sim, a).gold;
    run(sim, a, { t: 'return' }); // recall -> cidade cadastrada (default 'town')
    expect(ent(sim, a).x).toBe(0); // de volta ao centro da vila central
    expect(ent(sim, a).z).toBe(0);
    expect(ent(sim, a).gold).toBe(goldBefore); // o return e GRATIS (so o teleporte custou)
  });

  it('o recall vai pra cidade CADASTRADA, nao sempre a central', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' });
    run(sim, a, { t: 'register-city' }); // cadastra leste como retorno
    run(sim, a, { t: 'teleport', cityId: 'town' }); // viaja pra central
    expect(ent(sim, a).x).toBe(0);
    run(sim, a, { t: 'return' }); // recall -> leste (a cadastrada)
    expect(ent(sim, a).x).toBe(250);
    expect(ent(sim, a).z).toBe(0);
  });

  it('o return tem cooldown (nao da pra spammar)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' });
    run(sim, a, { t: 'return' }); // recall -> town; inicia o cooldown
    expect(ent(sim, a).x).toBe(0);
    run(sim, a, { t: 'teleport', cityId: 'leste' }); // teleporte ignora o cd do return
    expect(ent(sim, a).x).toBe(250);
    run(sim, a, { t: 'return' }); // dentro do cooldown -> BLOQUEADO
    expect(ent(sim, a).x).toBe(250); // nao fez recall
    for (let i = 0; i < RETURN_COOLDOWN_TICKS + 5; i++) sim.step(); // espera o cooldown
    run(sim, a, { t: 'return' }); // agora libera
    expect(ent(sim, a).x).toBe(0);
  });

  it('o return e BLOQUEADO durante um duelo', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    const b = sim.addPlayer('B');
    sim.restorePlayer(a, { gold: 1000 });
    run(sim, a, { t: 'teleport', cityId: 'leste' });
    run(sim, a, { t: 'register-city' }); // returnCity = leste
    run(sim, a, { t: 'teleport', cityId: 'town' }); // A na central (0,0), cadastrado em leste
    expect(ent(sim, a).x).toBe(0);
    run(sim, a, { t: 'duel-challenge', name: 'B' });
    run(sim, b, { t: 'duel-accept' }); // duelo ativo (o handshake funciona na cidade)
    expect(sim.duelViewFor(a)).not.toBeNull();
    run(sim, a, { t: 'return' }); // em duelo -> BLOQUEADO
    expect(ent(sim, a).x).toBe(0); // continua na central; NAO recall pra leste (250)
    expect(ent(sim, a).z).toBe(0);
  });

  it('o return e BLOQUEADO enquanto um mob esta com aggro (combate PvE)', () => {
    const sim = serverSim();
    const a = sim.addPlayer('A');
    // farma ate algum mob travar aggro no jogador (hostile na view). So ha 1 jogador no mundo,
    // entao qualquer enemy hostile esta necessariamente com aggro NELE.
    let hostile = false;
    for (let i = 0; i < 1500 && !hostile; i++) {
      const ents = sim.entities();
      const me = ents.find((e) => e.id === a)!;
      let mob: { id: number; x: number; z: number } | null = null;
      let best = Infinity;
      for (const e of ents) {
        if (e.kind !== 'enemy') continue;
        const d = (e.x - me.x) ** 2 + (e.z - me.z) ** 2;
        if (d < best) { best = d; mob = e; }
      }
      if (mob) {
        sim.sendCommandFor(a, { t: 'move', dx: mob.x - me.x, dz: mob.z - me.z });
        sim.sendCommandFor(a, { t: 'set-target', id: mob.id });
      }
      sim.step();
      hostile = sim.entities().some((e) => e.kind === 'enemy' && e.hostile);
    }
    expect(hostile).toBe(true); // precondicao: um mob travou aggro no jogador
    sim.sendCommandFor(a, { t: 'stop' }); // para de perseguir, pra isolar o efeito do return (sem drift do movimento)
    sim.step();
    const before = ent(sim, a);
    expect(before.dead).toBe(false); // precondicao: VIVO (senao o bloqueio seria pelo gate de downed, nao pela aggro)
    expect(chebyshev(before.x, before.z)).toBeGreaterThan(30); // brigando fora da central
    const px = before.x, pz = before.z;
    run(sim, a, { t: 'return' }); // tenta recall...
    const after = ent(sim, a);
    expect(after.dead).toBe(false); // continua vivo -> o bloqueio foi pela AGGRO, nao por estar downed
    expect(after.x).toBe(px); // ...BLOQUEADO: recall foi no-op (posicao exatamente inalterada)
    expect(after.z).toBe(pz);
  });

  it('o return e deterministico (mesma seed + comandos => mesmo hash)', () => {
    const play = (): string => {
      const sim = serverSim(7);
      const a = sim.addPlayer('A');
      sim.restorePlayer(a, { gold: 1000 });
      run(sim, a, { t: 'teleport', cityId: 'leste' });
      run(sim, a, { t: 'register-city' });
      run(sim, a, { t: 'teleport', cityId: 'town' });
      run(sim, a, { t: 'return' }); // recall -> leste
      for (let i = 0; i < 10; i++) sim.step();
      return sim.hash();
    };
    expect(play()).toBe(play());
  });
});
