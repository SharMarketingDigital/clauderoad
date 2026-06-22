# GDD ClaudeRoad v0.3 — Expansão "Estrada da Seda"

> **Documento de planejamento.** Sucede o GDD v0.2 (considerado *essencial fechado* — RPG co-op de farm jogável, online, persistente). O v0.3 é a fase de **encher o mundo e expandir os sistemas**, com fidelidade ao Silkroad Online. Construído com o jogo já rodando e gente jogando.

---

## 0. Como ler este documento

- **Pilar do v0.3:** transformar "1 área jogável" num **mundo progressivo estilo Silkroad** — múltiplas regiões com mobs por nível, mais variação de classes/habilidades e os sistemas sociais/PvP que dão alma ao Silkroad.
- **Divisão de trabalho:** o v0.3 está dividido em **duas frentes — Gabriel e Kevin** — por **sistema completo** (cada um toca todas as camadas — sim, servidor, render, UI, conteúdo — de um conjunto de sistemas). A divisão foi desenhada pra **não dar conflito de commit**: cada frente trabalha em **arquivos majoritariamente próprios**, e os poucos arquivos compartilhados (`protocol.ts`, `sim.ts`, `IWorld`) têm **regras de coordenação** explícitas (seção 3.0) pra os dois nunca editarem as mesmas linhas.
- **As prioridades do Shar pro Gabriel** (no topo): (1) variação de classes — Arqueiro, Mago, Espada&Escudo, Lança; (2) habilidades visuais à distância e curta (ex.: fogo); (3) expansão do mapa-múndi com mobs por nível; (4) expansão da cidade estilo Silkroad (Jangan como exemplo). Estão detalhadas na **Frente Gabriel**.
- **Fora do escopo (congelado até aviso do Shar):** Trade entre jogadores (P2P de itens) e Login/contas. **Não confundir** o "Trade entre jogadores" congelado com o **Job System trader/hunter/thief** (que é o transporte de mercadorias com PvP — esse SIM entra, se escolhido).
- **Status:** cada item marcado 🔵 (proposto) — você prioriza o que entra de fato. Não é pra fazer tudo; é o cardápio fiel ao Silkroad pra você escolher.

---

## 1. Os sistemas do Silkroad (pesquisa) — o cardápio do v0.3

Resumo fiel do que o Silkroad tem, pra embasar a priorização. Cada um vira um candidato a "sistema" do v0.3.

### 1.1 Sistema de Zonas / Mundo progressivo 🔵 **(o vetor central)**
No Silkroad, o mundo é uma **progressão linear de regiões**, cada uma com sua faixa de nível de monstros:
- Jangan (China) — níveis ~1–20 · Donwhang (China Ocidental) — ~21–30 (caverna 60–70) · Hotan (Reino Oásis) — ~31–60 · Taklamakan (deserto sem cidade) — ~60–80.
- Cada região tem **cidade-hub** (vendor, armazém, revive, teleporte), **pontos de caça definidos** (spots), monstros próprios, e **bosses únicos** (Tiger Girl, Uruchi, Isyutaru...).
- O jogador **se desloca** pra áreas mais difíceis conforme fica mais forte — o **mapa é a progressão**.
- **Teleporte** entre cidades (pago), e **mapa/minimapa** pra navegar.

**Por que é o centro do v0.3:** hoje o ClaudeRoad tem 1 zona plana. Este sistema é o que transforma o jogo em "mundo". Tudo mais (job, mais bosses, mais gear) ganha sentido com regiões.

### 1.2 Job System — Trader / Hunter / Thief 🔵 **(a identidade do Silkroad)**
O sistema mais único do Silkroad. A partir de certo nível, o jogador escolhe um papel:
- **Trader (Mercador):** compra mercadorias numa cidade, carrega num **animal de carga (caravana)** e transporta pra outra cidade pra vender com lucro. Quanto mais longe / maior o "grau" da carga, maior o lucro — e maior o risco (NPCs ladrões mais fortes, e thieves jogadores).
- **Thief (Ladrão):** ataca traders, rouba a mercadoria, leva pro "covil dos ladrões" pra vender. Inimigo do hunter.
- **Hunter (Caçador):** protege traders e caça thieves. Ganha XP de job matando thieves (NPC ou jogador) e quando o trader entrega a carga.
- **Triângulo de conflito:** trader ⟶ precisa de hunter ⟶ caça thief ⟶ rouba trader. PvP emergente com propósito econômico.
- **Job EXP/nível** separado do nível normal; desbloqueia caravanas melhores, roupas de job, consumíveis.

**Nota:** isto é PvP de transporte com economia — NÃO é o "trade P2P de itens" congelado. É o coração da identidade Silkroad.

### 1.3 Guildas 🔵
- Organização de jogadores: criar guilda (mestre), convidar, hierarquia de cargos, **armazém de guilda**, chat de guilda.
- Base pra conteúdo de grupo grande e pra Fortress War.
- Tecla G (no Silkroad) abre a janela de guilda.

### 1.4 Union (aliança de parties/guildas) 🔵
- **Union Party:** combina até 4 parties numa só (raid de até 32 jogadores) — pra farm em massa e Fortress War.
- **Union de guildas:** aliança de guildas pra Fortress War.

### 1.5 Fortress War (guerra de fortaleza) 🔵 **(endgame PvP)**
- Evento PvP em larga escala, guild-vs-guild, por controle de **fortalezas** (ex.: Jangan).
- Mecânica: registrar a guilda (mestre, em janela de tempo), montar posições (engenheiros, hammerers, clérigos), destruir **portão → torres → coração da fortaleza** (nessa ordem; o sistema bloqueia o coração antes).
- Vencedor controla a fortaleza por um período, **cobra taxa** (% do que jogadores gastam nos NPCs daquela cidade), e pode abrir dungeon exclusiva da union.
- **Command Post** = ponto de spawn no cerco; estruturas defensivas (portões/torres) que se faz upgrade.

### 1.6 Quests 🔵
- Missões narrativas (a história segue a rota da seda, de Jangan a Constantinopla) + side quests com NPCs regionais.
- Dão XP + SP + recompensas; apresentam zonas e apontam objetivos.

### 1.7 Profundidade de gear / Seals & Degrees 🔵
- **Seal System (raridade por "selo"):** itens "nascem" com Seal of Star (SOS, leve), Seal of Moon (SOM, médio) ou Seal of Sun (SUN, forte). Drop raríssimo. **(Já temos isto no v0.2!)**
- **Degrees (graus de gear):** equipamento em tiers por faixa de nível (1st degree, 2nd... até 9th+), cada grau melhor e pra nível mais alto. Inclui armadura por **peças** (capacete, peito, mãos, pernas, pés), **escudo**, **acessórios** (colar, brinco, anel), além de arma.
- **Alquimia profunda:** "+N" (já temos), mas com **elixir + sorte (já temos)**, e o que falta: **quebrar item em + alto, item de proteção, queda de múltiplos níveis na falha** — a tensão real do Silkroad.

### 1.8 Dungeons / Áreas instanciadas 🔵
- Cavernas e tumbas (Donwhang Cave, Qin-Shi Tomb) com faixas de nível altas e bosses — par natural do sistema de zonas.

### 1.9 Mounts / Transporte 🔵
- Montarias (cavalo de corrida pra velocidade) e animais de carga (caravana, pro job de trader). Acompanha zonas (viagem entre regiões).

### 1.10 PvP livre / Battle Arena 🔵
- Zonas free-for-all e arena de batalha (PvP consensual fora do job/fortress).

---

## 2. Proposta de escopo do v0.3 — o que faz sentido AGORA

Tentar tudo de uma vez seria irreal. O **núcleo do v0.3** é dividido entre as duas frentes (detalhe na seção 3), priorizando o que o Shar pediu + o que dá o maior salto de "ser Silkroad":

### Núcleo do v0.3 (Leva 1)
- **GABRIEL — Mundo & Combate visível:** variação de classes (Mago/Arqueiro/Espada&Escudo/Lança), habilidades visuais (VFX de fogo/distância/curta), expansão do mapa-múndi com mobs por nível, e expansão da cidade estilo Jangan.
- **KEVIN — Itens & Progressão de Gear:** degrees (graus de gear por nível), peças de armadura + escudo + acessórios, defesa/mitigação de verdade, alquimia com risco real, armazém/banco.

Os dois se complementam: o **Gabriel constrói o mundo onde caçar e como lutar**; o **Kevin constrói o que vestir e ganhar**. E foram separados pra **não colidir nos commits** (seção 3.0).

### Leva 2 (depois da fundação)
**Um grande sistema social/PvP:** **Job System** (trader/hunter/thief — identidade Silkroad) OU **Guildas + Fortress War** (endgame PvP de cerco). São ambos grandes; fazer um bem-feito por vez, dividido entre os dois.

### Deixar pra v0.4+
Quests (camada de conteúdo), Dungeons instanciadas, Union de 32, PvP arena, Mounts completos (a não ser que o Job exija a caravana). Áudio entra como suporte conforme as zonas pedirem.

---

## 3. Divisão de trabalho — Gabriel × Kevin (anti-conflito de commit)

> Princípio do Shar: **dividir de forma que NÃO dê conflito entre tarefas e commits.** A divisão abaixo segue isso: cada frente é dona de um conjunto de sistemas que vivem em **arquivos próprios**, e os poucos arquivos compartilhados têm regra de coordenação. Conflito no Git acontece quando dois editam o mesmo arquivo nas mesmas linhas — a estrutura abaixo evita isso por design.

### 3.0 Estratégia anti-conflito (LEItura obrigatória pros dois)

**A regra de ouro: cada sistema novo mora no seu próprio módulo.** O `sim.ts` (o coração) NÃO deve receber lógica nova inline — cada sistema cria seu arquivo (`src/sim/<sistema>.ts`) e o `sim.ts` só **chama** uma função. Assim Gabriel e Kevin nunca editam as mesmas linhas do `sim.ts`.

**O ponto de atrito mais perigoso: o cálculo de dano.** O Gabriel adiciona **dano ofensivo** (dano mágico do Mago, VFX). O Kevin adiciona **defesa/mitigação** (armadura reduz dano). Ambos querem mexer no mesmo cálculo. Solução:
- Gabriel é dono de **`src/sim/combat_offense.ts`** (como o dano é gerado: físico/mágico, por classe).
- Kevin é dono de **`src/sim/combat_defense.ts`** (como o dano é reduzido: armadura, defesa, mitigação).
- O `sim.ts` chama os dois em sequência: `dano_final = defense.mitigate(offense.compute(...))`. Cada um edita só o seu arquivo. **Combinem a assinatura dessa função juntos, uma vez, no começo** — depois trabalham isolados.

**Arquivos compartilhados (zonas de coordenação) — regras:**
- `src/net/protocol.ts` — adicionar mensagens **sempre no fim**, nunca renumerar/reordenar o que existe. Avisar o outro ao adicionar.
- `src/sim/sim.ts` — só **chamadas** pros módulos de cada um; evitar lógica inline. Cada comando novo numa linha própria.
- `src/world_api.ts` (`IWorld`) — adicionar métodos no fim; avisar.
- `src/sim/save.ts` — schema do save: Gabriel adiciona campos de equip/itens, Kevin... (na verdade Kevin é quem mexe em gear — ver abaixo). Coordenar quem toca o save.
- `CLAUDE.md` — manter atualizado.

**Ritmo de commit:** cada um commita suas fatias na ordem que terminar; como os arquivos são disjuntos, `git pull`/merge raramente conflita. Quando for mexer numa zona de coordenação, avisar no chat do time antes.

---

### FRENTE GABRIEL — "Mundo & Combate Visível" ⭐ (prioridades do Shar no topo)

O Gabriel cuida do que o jogador **vê e sente**: as classes, os efeitos visuais, o mundo e a cidade. Os 4 pontos que o Shar pediu estão no topo, em ordem.

#### G1 — Variação de classes (Arqueiro, Mago, Espada&Escudo, Lança) ⭐ PRIORIDADE 1
Hoje há 3 maestrias (Espada, Lança, Arco). Expandir pra um sistema de **classes** com identidade clara:
- **Arqueiro** (já existe como Arco — formalizar): dano físico à distância.
- **Mago** (NOVO): dano **mágico** à distância — introduz o conceito de dano mágico no jogo (hoje só há físico). É a maior novidade desta frente.
- **Espada & Escudo** (formalizar a partir da Espada): tank — mais defesa/bloqueio, dano corpo-a-corpo.
- **Lança**: dano corpo-a-corpo em área/perfurante (já existe — manter/ajustar).
- Cada classe com seu kit de habilidades e papel. (Como o Silkroad faz mastery; manter o estilo de subir por SP que já existe.)
- **Arquivos:** `src/sim/content/abilities*.ts`, `src/sim/combat_offense.ts` (dano físico vs mágico — coordenar com Kevin a assinatura). UI: livro de skills (já existe).

#### G2 — Habilidades visuais à distância e curta (VFX) ⭐ PRIORIDADE 2
Hoje todas as skills usam o mesmo flash genérico. Dar **efeitos visuais distintos** por habilidade:
- Efeito de **fogo** (ex.: bola de fogo do Mago à distância), efeito de **projétil** (flecha do Arqueiro), efeito **corpo-a-corpo** (slash/cone da Espada/Lança).
- Pode começar simples (um efeito de fogo bem feito já agrega muito) e expandir.
- **Arquivos:** `src/render/vfx/*` (novo módulo de efeitos), chamado pelo render quando uma skill é usada. Não toca a lógica do sim (VFX é cosmético) → zero risco de conflito com o Kevin.

#### G3 — Expansão do mapa-múndi (mobs por nível) ⭐ PRIORIDADE 3
O vetor central do Silkroad: **múltiplas regiões, cada uma com mobs de uma faixa de nível** (igual Jangan 1–20, Donwhang 21–30...).
- **Modelo de zonas** (`src/sim/zones.ts`): regiões como dados (id, faixa de nível, bounds, hub, spots de spawn).
- **Spawn por zona:** mobs nascem nos spots de cada região, com as espécies/níveis daquela zona (reusa as espécies que já temos + novas). RNG separado por spot (determinismo).
- **Mundo maior + biomas:** expandir o terreno (hoje 120×120) pra regiões distintas (campina → outra → outra). Render reusa floresta/pedra que sobram + assets novos se baixados.
- **Aggro por nível:** mob muito acima do jogador fica mais perigoso/agressivo.
- **Arquivos:** `src/sim/zones.ts`, `src/render/world/*`. Coordenação: `sim.ts` (chamada de spawn por zona — função própria), `protocol.ts` (zona no snapshot).

#### G4 — Expansão da cidade estilo Silkroad (Jangan) ⭐ PRIORIDADE 4
Transformar o hub atual numa **cidade de verdade** estilo Jangan: muralhas, portões, mais estruturas, NPCs, layout de cidade. Reusa o MegaKit (95% sobrando) + assets novos.
- Cada região do G3 tem sua cidade-hub (vendor, revive, ponto de teleporte entre cidades).
- **Teleporte** entre cidades (comando + custo de ouro).
- **Arquivos:** `src/render/world/cities/*`, `src/sim/zones.ts` (hub como dado). UI de teleporte.

#### G5 (suporte, se couber) — Mapa / minimapa
Tela de mapa (tecla M) mostrando as regiões e a posição do jogador. (UI — `src/ui/map.ts`.)

**Resumo de arquivos do Gabriel (próprios):** `src/sim/content/abilities*`, `src/sim/combat_offense.ts`, `src/sim/zones.ts`, `src/render/vfx/*`, `src/render/world/*`, `src/ui/map.ts`. **Coordenação:** `sim.ts` (chamadas próprias), `protocol.ts` (fim), `combat_offense×combat_defense` (assinatura combinada com Kevin).

---

### FRENTE KEVIN — "Itens & Progressão de Gear"

O Kevin cuida do que o jogador **ganha e veste**: a profundidade de equipamento que dá sentido a farmar nas zonas do Gabriel. Fecha também as ressalvas de "alquimia suave" do v0.2.

#### K1 — Slots de equipamento completos (set Silkroad)
De weapon+armor pro set completo: arma, **peças de armadura** (capacete, peito, mãos, pernas, pés), **escudo** (par com a classe Espada&Escudo do Gabriel), **acessórios** (colar, brinco, anel).
- **Arquivos:** schema de item (`src/sim/content/items*`), `src/sim/equip*`, recompute de stats. UI: tela de equip (`src/ui/inventory.ts`/equip).

#### K2 — Degrees (graus de gear por faixa de nível)
Equipamento em tiers (1º grau, 2º grau...), cada grau melhor e pra uma faixa de nível, com requisito de nível pra equipar. Dá o "que vestir" progressivo nas zonas do Gabriel.
- **Arquivos:** conteúdo de itens como dados (`src/sim/content/items*`) + regras de requisito.

#### K3 — Defesa / mitigação de verdade
Introduzir **armadura que reduz dano** (fecha a fórmula que falta do v0.2). Ligar Força→HP/defesa física, Int→defesa mágica (a defesa mágica casa com o Mago do Gabriel).
- **Arquivo:** **`src/sim/combat_defense.ts`** (dono). Coordena com o `combat_offense.ts` do Gabriel só na assinatura combinada (seção 3.0). **Este é o ponto de contato com o Gabriel — combinar a função juntos uma vez, depois isolado.**

#### K4 — Alquimia com risco real
Na falha: **quebra** o item em "+" alto, **item de proteção** (piso na falha), **queda de múltiplos níveis**. Fecha a ressalva do v0.2 (a tensão "arrisco meu gear?" vira real, como no Silkroad).
- **Arquivo:** `src/sim/enhance.ts` (já existe, estender).

#### K5 — Armazém / banco na cidade
Depósito/saque de itens num NPC de armazém (entra aqui porque é sobre itens/inventário). Persiste no save.
- **Arquivos:** `src/sim/storage*`, `src/ui/storage.ts`. Coordenação: `save.ts` (novo schema — Kevin é o dono do schema de itens/banco no save).

#### K6 (suporte) — Ficha de personagem como tela própria
Tela dedicada de stats do personagem (hoje é uma linha na bolsa).
- **Arquivo:** `src/ui/character_sheet.ts`.

**Resumo de arquivos do Kevin (próprios):** `src/sim/content/items*`, `src/sim/equip*`, `src/sim/enhance.ts`, `src/sim/combat_defense.ts`, `src/sim/storage*`, `src/ui/inventory.ts`, `src/ui/storage.ts`, `src/ui/character_sheet.ts`. **Coordenação:** `combat_defense×combat_offense` (com Gabriel), `save.ts` (schema de itens), `protocol.ts` (fim).

---

### Por que essa divisão não colide

| Domínio | Gabriel | Kevin |
|---|---|---|
| Combate | ofensivo (`combat_offense.ts`) | defensivo (`combat_defense.ts`) |
| Mundo | zonas, cidades, render | — |
| Visual | VFX, render | — |
| Itens | — | gear, degrees, alquimia, banco |
| UI | mapa, livro de skills | inventário, equip, ficha, banco |

Os arquivos próprios são **disjuntos**. O único contato real é a **função de dano** (offense × defense), resolvida com módulos separados e uma assinatura combinada uma vez. Tudo o mais, cada um toca o seu — `git merge` flui sem conflito.

---

## 4. Ordem sugerida de execução do v0.3

1. **Combinar a assinatura do dano** (Gabriel + Kevin, juntos, 10 min): definir como `combat_offense.compute()` e `combat_defense.mitigate()` se encaixam no `sim.ts`. É o único ponto onde os dois se tocam — resolver primeiro, depois trabalham isolados.
2. **Leva 1 — Fundação, em paralelo:**
   - **Gabriel:** G1 classes (Mago/dano mágico) → G2 VFX → G3 mapa-múndi/zonas → G4 cidade.
   - **Kevin:** K1 slots → K2 degrees → K3 defesa → K4 alquimia → K5 banco.
   - Os dois fluem em paralelo; arquivos disjuntos.
3. **Integração** (encontro Gabriel × Kevin): mobs por zona (Gabriel) dropam gear por grau coerente (Kevin) — loot tables por zona. E a defesa mágica (Kevin) casa com o dano mágico do Mago (Gabriel).
4. **Pente-fino prioritário:** **crédito de boss por dano** (não último golpe) — fecha a ressalva do v0.2 de "derrubar juntos". (A alquimia com risco já está no K4.)
5. **Leva 2 — Social/PvP:** escolher Job System OU Guildas+Fortress War, dividir entre os dois.
6. **Leva 3+:** Quests, Dungeons, Union, Mounts, Áudio, Arena — conforme prioridade.

---

## 5. Princípios de engenharia (herdados do v0.2, mantidos)

- **Uma sim, vários hosts:** todo sistema novo roda igual em SP e MP, autoritativo no servidor. Estado de jogo no `src/sim/` determinístico; estado de lobby/sessão (como o matching) pode ficar no servidor.
- **Determinismo sagrado:** os testes de determinismo do sim devem continuar passando. Sorteios usam RNG separado, nunca o principal. Offline nunca aciona sistemas multiplayer.
- **Fidelidade primeiro:** clonar o comportamento do Silkroad, depois ajustar. (Como foi feito no Party.)
- **Fatias pequenas, commit por fatia, revisão adversarial, teste do Shar com screenshots.**
- **Coordenação de Git:** zonas de coordenação (protocol/sim/IWorld) com mudanças pequenas e avisadas; cada sistema no seu módulo.

---

## 6. Decisões pendentes (pra você, Shar)

1. **Confirmar a divisão da Leva 1:** Gabriel = Mundo & Combate Visível (classes, VFX, mapa-múndi, cidade) ‖ Kevin = Itens & Gear (degrees, peças, defesa, alquimia, banco)? Ou ajustar?
2. **As 4 classes do Gabriel (G1):** Arqueiro, Mago, Espada&Escudo, Lança — confirma? O **Mago** introduz dano mágico (maior novidade). Alguma classe a mais/menos?
3. **Quantas zonas** na primeira leva (G3)? Sugestão: 2–3 regiões (ex.: campina atual nv 1–10, 2ª região nv 10–20, talvez 3ª) — pra provar o sistema sem virar trabalho infinito de conteúdo.
4. **Qual o 2º grande social** (Leva 2): Job System (trader/hunter/thief, PvP de caravana) ou Guildas+Fortress War (endgame PvP de cerco)?
5. **Precisaremos baixar assets** pra biomas novos (deserto/caverna), efeitos de fogo, e talvez modelo do Mago — quer começar a garimpar (Quaternius/Poly Pizza/KayKit) em paralelo?
6. **Cap de nível do v0.3:** até que nível o jogo vai? (Define quantas zonas e graus de gear.)

---

*Fim do GDD v0.3 (rascunho para discussão). Nada implementado — é o mapa. Ajustamos as decisões da seção 6 e aí destravamos a Leva 1, com Gabriel em Mundo & Combate Visível e Kevin em Itens & Gear.*
