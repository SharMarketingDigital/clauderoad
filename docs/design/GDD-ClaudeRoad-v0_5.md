# GDD ClaudeRoad v0.5 — "A Última Leva" (sistemas finais antes da lapidação)

> **Documento de planejamento.** Sucede o GDD v0.4 (Tier 0 + pilar do PvP/duelo,
> jogo online-only e público). O v0.5 é a **leva final de sistemas novos** —
> depois dele, o projeto entra na **fase de lapidação** (polir, balancear,
> deixar bonito e jogável 100%, sem adicionar sistemas).
>
> **O que muda de postura:** este é o último GDD de "construir sistemas". A meta
> é **fechar o conjunto de funcionalidades** que dá ao ClaudeRoad a profundidade
> de um MMORPG estilo Silkroad, e então parar de adicionar e começar a refinar.

---

## 0. Como ler este documento

- **Os 6 sistemas do v0.5** (escolha do Shar): Guildas, PK livre, Loot físico,
  Pets (transporte + coleta), Stalls, Teleporte entre cidades.
- **Estrutura:** cada sistema tem uma seção de **visão** (o quê e por quê, fiel
  ao Silkroad) + um **plano de execução em fatias** (o como, em pedaços pequenos
  e testáveis). É o formato que o Claude Code consome melhor.
- **Divisão de trabalho:** NÃO atribuída neste documento. O Shar e o Kevin
  definem quem faz cada sistema na hora da execução. O documento só aponta, em
  cada sistema, **quais territórios ele toca** (combate, itens, render, etc.)
  pra facilitar essa divisão depois.
- **Regras de engenharia (valem sempre):** uma sim/vários hosts; determinismo
  sagrado (sorteios via Rng nomeado, testes byte-idênticos como portão); cada
  sistema no seu módulo (`src/sim/<sistema>.ts`, o `sim.ts` só chama); fatias
  pequenas → testes verdes → revisão adversarial → commit exato → sem push.
  Seguir o `WORKFLOW.md` e os `CLAUDE.md`.

### Descongelamentos importantes deste v0.5
- **Trade P2P de itens: DESCONGELADO.** O v0.3/v0.4 mantinham o trade entre
  jogadores congelado. O v0.5 o reabre — necessário para os **Stalls** (lojas
  pessoais) e relacionado ao **Loot físico** (itens trocando de dono no mundo).
  Isso traz superfície de determinismo e segurança nova; tratar com cuidado
  (transferência de item é atômica, validada no servidor, à prova de duplicação).

---

## 1. GUILDAS (a casca social — parte do pilar do v0.4 que faltou)

### 1.1 Visão
No Silkroad, guildas dão **identidade social e organização**: criar uma guilda,
ter membros com cargos, um chat próprio, um armazém compartilhado, e a base para
guerra de guildas (PvP organizado). Para o ClaudeRoad (poucos jogadores hoje, mas
crescendo), guildas são a estrutura que permite grupos persistentes além da party
temporária — e a porta para o PvP de grupo no futuro.

**Decisões herdadas (do planejamento do v0.4):**
- **Armazém de guilda = pessoal-por-membro** (cada membro só saca o que depositou)
  — respeita a natureza do trade controlado, sem virar pool livre.
- **Union (raid de 32) = ADIADO** — over-engineering com poucos jogadores; vira
  party-of-parties no futuro, não um rewrite.
- **Guerra de guildas** = a peça de PvP de guilda (elegibilidade entre guildas
  em guerra declarada).

**Territórios que toca:** persistência/servidor (registro, Postgres), chat,
armazém (storage = território de itens), elegibilidade de PvP (sim/combate).

### 1.2 Plano de execução (fatias)
A descoberta de arquitetura do v0.4 vale aqui: **a maior parte de guildas é
server-side e hash-safe** (como o lobby de matching), e só a elegibilidade de
PvP da guerra toca o sim determinístico.

- **B0 — Chat de guilda (`/g`):** alarga o `ChatChannel` para `'guild'`, parse do
  `/g`, tag `[Guilda]`, com fonte de membership stub. Prova o cano ponta-a-ponta.
  `feat(net): canal de chat de guilda (/g)`
- **B1 — Registro de guildas:** `Map<guildName, Set<memberName>>` (como o
  MatchingRegistry) + resolução de membros online + roteamento do `/g`.
  `feat(server): registro de guildas`
- **B2 — Formação (criar/convidar/sair):** intents de membership como mensagens
  de servidor (família matching-*), `GuildView` no SelfSnap, validado no servidor.
  `feat(server): formação de guildas (criar, convidar, sair)`
- **B3 — Persistência (Postgres):** tabelas `guilds`/`guild_members` keyed por
  nome, espelhando o padrão error-guarded + fallback do `store.ts`. Não toca a
  tabela `characters`. `feat(server): persiste guildas no Postgres`
- **C0 — Armazém de guilda (pessoal-por-membro):** reusa `depositStack`/
  `withdrawStack` do storage, marca stack como guild-scoped (só o depositante
  saca), NPC-âncora + comandos com near-check, persiste em `guild_warehouse`.
  ⚙ toca o sim (storage) — coordenado com quem é dono do storage.
  `feat(sim): armazém de guilda (pessoal-por-membro)`
- **D0 — Guerra de guildas (elegibilidade de PvP):** injeta `guildOf` no sim via
  comando (como o restorePlayer), `guildWars` set, comando war-declare/accept;
  estende o `canAttack` com `sameWar`. Reusa o roteamento de dano do duelo.
  Honra safe-zone, entra no hash. ⚙ toca o sim/combate.
  `feat(sim): guerra de guildas (elegibilidade de PvP)`

### 1.3 Decisões em aberto
- UI de guilda (painel de membros, cargos): fatia de suporte, definir escopo.
- Cargos/permissões: começar simples (líder + membro) ou já com hierarquia?

---

## 2. PK LIVRE (PvP sem consentimento — estilo Silkroad)

### 2.1 Visão
Diferente do **duelo** (consensual, já feito), o **PK** (Player Killing) é PvP
**livre**: fora das cidades, qualquer jogador pode atacar qualquer outro, sem
convite. É o PvP "selvagem" do Silkroad — risco constante no mundo aberto.

**Decisões do Shar:**
- **Mecanismo: segurar ALT + atacar** (estilo Silkroad). Sem ALT, o ataque não
  mira jogadores (só mobs) — evita PK acidental. Com ALT pressionado, o ataque
  libera contra jogadores.
- **Sem punição pro PK** — quem mata não sofre penalidade (sem sistema de
  alinhamento/karma negativo nesta versão).
- **Quem morre volta pra cidade** (como a morte normal).
- **Drop ao morrer:** quem morre tem **chance de dropar item da bag** (ver
  Loot Físico, §3 — o PK e o loot físico formam um conjunto coerente).
- **Safe-zone:** dentro das cidades, sem PK (cidade segura, como o duelo).

**Tensão de design a resolver:** "drop ao morrer sem punição" vs o **pacing
gentil** dos GDDs anteriores (você decidiu não copiar o grind brutal). Opções:
chance de drop baixa, ou drop só de itens não-equipados, ou um toggle de zona
PvP. Definir a severidade na execução — começar suave.

**Por que faz sentido agora:** o PK ganha graça com **população** (estranhos se
enfrentando), e o jogo agora é online-público. É o complemento "selvagem" do
duelo (amistoso).

**Territórios que toca:** combate (sim — elegibilidade via ALT), input (a tecla
ALT), e o sistema de drop (loot físico).

### 2.2 Plano de execução (fatias)
Reusa o chokepoint `canAttack` do duelo (já existe).

- **PK0 — Elegibilidade de PK (ALT + fora da cidade):** o `canAttack` libera
  jogador-vs-jogador quando o atacante está com o flag de PK ativo (ALT) E ambos
  estão fora da safe-zone. ⚙ toca o sim/combate.
  `feat(sim): elegibilidade de PK (ALT, fora da cidade)`
- **PK1 — Input do ALT:** a tecla ALT pressionada marca o ataque como PK (passa
  o flag pro comando de ataque/mira). Render/input + um campo no comando.
  `feat(ui): modo PK com ALT`
- **PK2 — Morte por PK + retorno:** quem morre por PK vira espírito → revive na
  cidade. Crédito de kill. (O drop é a fatia do loot físico.)
  `feat(sim): morte e retorno por PK`
- **PK3 — Feedback visual:** indicação clara de que o modo PK está ativo (ex.:
  cursor/alvo muda de cor com ALT), e aviso de que você está em zona PvP.
  `feat(ui): feedback visual de PK`

### 2.3 Decisões em aberto
- Severidade do drop ao morrer (chance, o que pode dropar).
- Zonas: PK em todo o mundo (fora de cidade), ou zonas PvP demarcadas?
- Indicador de "jogador perigoso" / quem está em modo PK?

---

## 3. LOOT FÍSICO (drop no chão — refatoração do sistema de drop)

### 3.1 Visão
Hoje o loot vai **direto pro inventário** ao matar. O Silkroad (e a sensação que
o Shar quer) é o loot **caindo no chão** como objetos físicos que o jogador pega:
- **Caixa** = item (gear, consumível, material).
- **Moedas** = gold.
- **Saquinho** = o "resto" (agrupamento de drops menores).

Isso muda a sensação do farm (você vê o loot cair, corre pra pegar) e habilita o
**grab pet** (que pega o loot do chão automaticamente) e o **drop por PK** (itens
da bag de quem morre caem no chão).

**Por que é uma refatoração grande:** mexe no **sistema de drop inteiro** — de
"item → inventário" para "item → entidade de loot no mundo → pegar → inventário".
Cria entidades de loot (com posição, tipo, conteúdo), lógica de pegar (proximidade
ou clique), e despawn por tempo. Cruza **itens** (Kevin: o que tem dentro) e
**render/mundo** (Gabriel: as entidades visuais no chão).

**Territórios que toca:** drop/itens (sim), entidades de mundo (sim), render (os
objetos no chão), e conecta com pets (coleta) e PK (drop ao morrer).

### 3.2 Plano de execução (fatias)
Esta é a refatoração mais sensível do v0.5 — fatiar com cuidado.

- **LF0 — Entidade de loot no sim:** novo tipo de entidade (loot drop) com
  posição, tipo (caixa/moedas/saquinho), conteúdo (item ou gold), e timer de
  despawn. ⚙ toca o sim (nova entidade, entra no hash). Determinismo: posição do
  drop via Rng nomeado. `feat(sim): entidade de loot no mundo`
- **LF1 — Redirecionar o drop pro chão:** o sistema de drop atual (mob morre →
  item no inventário) passa a **spawnar a entidade de loot** na posição do mob,
  em vez de ir direto pro inventário. ⚙ toca o sim/drop.
  `feat(sim): drop cai no chão em vez do inventário`
- **LF2 — Pegar o loot:** lógica de pegar (proximidade automática ou clique) →
  o conteúdo vai pro inventário, a entidade some. ⚙ toca o sim.
  `feat(sim): pegar loot do chão`
- **LF3 — Render dos drops:** os objetos visuais no chão (caixa/moedas/saquinho)
  — modelos CC0, posicionados, com talvez um brilho/animação. Render puro.
  `feat(render): objetos de loot no chão`
- **LF4 — Drop por PK:** quando um jogador morre por PK, parte da bag dele
  spawna como loot no chão (conecta §2). ⚙ toca o sim.
  `feat(sim): drop da bag ao morrer por PK`

### 3.3 Decisões em aberto
- Pegar: automático por proximidade, ou clique no objeto? (Silkroad é clique;
  grab pet automatiza.)
- Ownership: o loot é livre (qualquer um pega) ou tem prioridade pra quem matou
  por um tempo? (importante com PK/população).
- Tempo de despawn do loot no chão.
- Assets CC0 pros 3 tipos de objeto (caixa/moedas/saquinho).

---

## 4. PETS — Transporte e Coleta (grab pet + transport pet)

### 4.1 Visão
No Silkroad, pets são qualidade de vida do grind:
- **Grab pet (coleta):** pega o loot do chão automaticamente — conecta direto
  com o **Loot Físico** (§3). Sem o loot físico, não há o que o grab pet pegue,
  então ele **depende** do §3 existir primeiro.
- **Transport pet (transporte):** um "armazém ambulante" — inventário extra que
  acompanha o jogador, pra carregar mais loot antes de voltar à cidade.

**Por que faz sentido:** o farm fica mais fluido (não precisa parar pra pegar
cada drop, nem voltar à cidade tão cedo). É polish de QoL que o grind agradece.

**Territórios que toca:** o grab pet toca o loot físico (sim) e render (o pet
visual); o transport pet toca inventário/storage (Kevin) e render.

### 4.2 Plano de execução (fatias)
**Depende do Loot Físico (§3) para o grab pet.**

- **PET0 — Entidade de pet (companheiro visual):** um pet que segue o jogador
  (posição relativa, render). Começa cosmético. ⚙ se a posição entrar no sim, ou
  render-only se for puramente visual seguindo o jogador local. Definir.
  `feat: pet companheiro que segue o jogador`
- **PET1 — Grab pet (coleta automática):** o pet pega o loot do chão num raio
  (reusa a lógica de pegar do §3, automatizada). ⚙ toca o sim (coleta).
  `feat(sim): grab pet coleta loot automaticamente`
- **PET2 — Transport pet (armazém ambulante):** inventário extra acessível com o
  pet (como um banco portátil). ⚙/storage — território de itens (Kevin).
  `feat(sim): transport pet (inventário extra)`
- **PET3 — Obtenção dos pets:** como o jogador consegue um pet (drop, vendor,
  quest?). Definir. `feat: obtenção de pets`

### 4.3 Decisões em aberto
- Pets são permanentes ou consumíveis (tempo de vida, como no Silkroad)?
- Como obter (comprar, dropar, quest)?
- Assets CC0 pros pets.

---

## 5. STALLS (lojas pessoais — DESCONGELA o Trade P2P)

### 5.1 Visão
No Silkroad, **stalls** são lojinhas pessoais: o jogador monta uma barraca,
expõe itens com preços, e fica offline-ish vendendo a outros jogadores. É a
economia entre jogadores sem precisar negociar ao vivo.

**⚠️ Descongelamento:** stalls são, na essência, **trade P2P de itens** (que
estava congelado desde o v0.3). Incluir stalls **reabre** o trade entre
jogadores — com toda a superfície de determinismo e segurança que isso traz
(transferência de itens entre jogadores precisa ser atômica, validada no
servidor, à prova de duplicação/exploit). Esta é a parte **mais sensível**
do v0.5 em termos de segurança de dados.

**Por que o Shar quer:** com população crescendo, a economia entre jogadores dá
vida ao mundo (comprar/vender gear, materiais). É o que transforma o jogo de
"cada um no seu farm" em "uma economia compartilhada".

**Territórios que toca:** itens/inventário (Kevin — a transferência), persistência
(o estado da loja), render (a barraca visual), e segurança (anti-duplicação).

### 5.2 Plano de execução (fatias)
A segurança é o eixo — cada transferência de item é o ponto crítico.

- **ST0 — Transferência de item segura (a base do trade P2P):** a primitiva de
  mover um item/gold de um jogador pra outro, **atômica e validada no servidor**
  (o item sai de um e entra no outro num passo só, sem janela de duplicação).
  ⚙ toca o sim/itens — a fatia mais crítica. Testes exaustivos de não-duplicação.
  `feat(sim): transferência de item entre jogadores (atômica)`
- **ST1 — Montar a loja:** o jogador expõe itens da bag com preços (estado da
  loja: itens à venda + preços). ⚙/itens.
  `feat(sim): montar loja pessoal (stall)`
- **ST2 — Comprar de uma loja:** outro jogador vê os itens, paga o gold, recebe
  o item (usa ST0). ⚙/itens.
  `feat(sim): comprar de uma loja pessoal`
- **ST3 — Persistência da loja:** a loja persiste (o jogador pode ficar
  "vendendo" mesmo após sair?). Definir o modelo. `feat(server): persiste lojas`
- **ST4 — Render/UI da loja:** a barraca visual no mundo + a UI de comprar/vender.
  Render + UI. `feat(ui): interface de lojas pessoais`

### 5.3 Decisões em aberto
- A loja fica ativa com o jogador offline (como o Silkroad), ou só online?
- Onde montar (qualquer lugar, ou zonas de mercado na cidade)?
- Anti-exploit: como garantir zero duplicação de itens (o ponto crítico).
- Taxa de venda (gold sink) ou venda livre?

---

## 6. TELEPORTE ENTRE CIDADES

### 6.1 Visão
No Silkroad, o jogador se teleporta entre cidades-hub (por NPC ou comando, com
custo). É mobilidade essencial num mundo de múltiplas regiões — evita a viagem
longa e repetitiva entre zonas distantes.

**Nota:** isso estava planejado no v0.3 (G4: `feat(sim): teleporte entre cidades`)
mas pode não ter sido concluído. Confirmar o estado atual antes de implementar —
se já existe parcialmente, completar; se não, fazer.

**Por que faz sentido:** com o mundo expandido (múltiplas zonas/cidades), andar a
pé entre elas é tedioso. O teleporte conecta o mundo e respeita o tempo do jogador.

**Territórios que toca:** mundo/zonas (sim — os pontos de teleporte), economia (o
custo em gold), e UI (a interface de escolher destino).

### 6.2 Plano de execução (fatias)
- **TP0 — Verificar o estado atual:** o teleporte do v0.3 foi feito? O que existe?
  (Investigação, não código.)
- **TP1 — Pontos e destino:** os pontos de teleporte (NPC ou estrutura na cidade)
  e os destinos disponíveis (as cidades-hub conhecidas). ⚙/zonas.
  `feat(sim): teleporte entre cidades`
- **TP2 — Custo e validação:** o teleporte custa gold; valida que o jogador tem o
  gold e está num ponto válido. ⚙/economia.
  `feat(sim): custo de teleporte`
- **TP3 — UI de teleporte:** a interface de escolher o destino. UI.
  `feat(ui): interface de teleporte`

### 6.3 Decisões em aberto
- Teleporte por NPC, estrutura, ou comando de chat?
- Custo fixo ou por distância?
- Desbloqueio: todas as cidades de início, ou desbloqueia ao visitar?

---

## 7. Ordem sugerida e dependências

As dependências entre sistemas sugerem uma ordem (ajustável):

1. **Loot Físico (§3)** — **primeiro**, porque o grab pet (§4) e o drop por PK
   (§2) dependem dele.
2. **PK Livre (§2)** — depois do loot físico (pro drop ao morrer).
3. **Pets (§4)** — depois do loot físico (pro grab pet).
4. **Guildas (§1)** — independente; pode rodar em paralelo às outras frentes.
5. **Teleporte (§6)** — independente e pequeno; bom "quick win".
6. **Stalls (§5)** — a mais sensível (descongela trade P2P); fazer com calma,
   pode ser por último pra ter tempo de caprichar na segurança.

**Independências úteis pra divisão de trabalho (Shar + Kevin decidem):**
- Guildas e Teleporte são bem independentes (um pode pegar cada).
- Loot Físico cruza frentes (itens + render) — precisa de coordenação.
- Stalls e Transport Pet são pesados em itens/inventário (território do Kevin).
- PK e o feedback visual são pesados em combate/render (território do Gabriel).

---

## 8. Depois do v0.5: LAPIDAÇÃO

Concluído o v0.5, o projeto **para de adicionar sistemas** e entra na fase de
lapidação:
- **Balanceamento:** as classes, o PvP, as taxas de XP/SP/drop, a economia.
- **Game feel:** responsividade do combate, feedback de impacto, "juice".
- **Visual:** deixar bonito — ambientação, efeitos, UI, coesão estética.
- **Onboarding:** os primeiros minutos, dicas, tutorial.
- **Conteúdo:** preencher o mundo, mais variedade onde estiver raso.
- **Asperezas:** corrigir o que ficou meia-boca.

A lapidação é a fase que transforma "um monte de sistemas que funcionam" em "um
jogo que é gostoso de jogar". É o objetivo final desta etapa do ClaudeRoad.

---

## Resumo do escopo v0.5

| # | Sistema | Toca principalmente | Sensibilidade |
|---|---------|---------------------|---------------|
| 1 | Guildas (B,C,D) | servidor, storage, combate | Média (storage coordenado) |
| 2 | PK Livre | combate, input | Média (balanceamento do drop) |
| 3 | Loot Físico | drop, mundo, render | **Alta** (refatora o drop) |
| 4 | Pets | loot físico, storage, render | Média (depende do §3) |
| 5 | Stalls | itens, persistência, segurança | **Alta** (descongela trade P2P) |
| 6 | Teleporte | zonas, economia, UI | Baixa (quick win) |

**Congelado/cortado (não entra no v0.5):** Union (raid 32), Fortress War, Job
System (trader/hunter/thief), Magic Stones, imbues elementais. *(Se o Job System
for desejado, vira um GDD próprio futuro — é grande.)*

*Plano da última leva de sistemas do ClaudeRoad. Depois disto, lapidação.*
