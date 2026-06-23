# GDD ClaudeRoad v0.3 — Expansão "Estrada da Seda"

> **Documento de planejamento.** Sucede o GDD v0.2 (considerado *essencial fechado* — RPG co-op de farm jogável, online, persistente). O v0.3 é a fase de **encher o mundo e expandir os sistemas**, com fidelidade ao Silkroad Online. Construído com o jogo já rodando e gente jogando.

---

## 0. Como ler este documento

- **Pilar do v0.3:** transformar "1 área jogável" num **mundo progressivo estilo Silkroad** — múltiplas regiões com mobs por nível, mais variação de classes/habilidades e profundidade de gear.
- **Divisão de trabalho — frentes INDEPENDENTES:** o v0.3 está dividido em **duas frentes — Gabriel e Kevin**. O princípio nº1 (aprendido na prática): **as tarefas das duas frentes NÃO podem depender uma da outra, nem tocar os mesmos sistemas.** Cada frente é dona de **sistemas inteiros** que vivem em **arquivos próprios e disjuntos** — cada um trabalha, testa e commita sozinho, como se o outro não existisse, sem nunca quebrar o jogo do outro. Os detalhes da separação estão na seção 3.
- **As prioridades do Shar pro Gabriel** (no topo): (1) variação de classes — Arqueiro, Mago, Espada&Escudo, Lança; (2) habilidades visuais à distância e curta (ex.: fogo); (3) expansão do mapa-múndi com mobs por nível; (4) expansão da cidade estilo Silkroad (Jangan como exemplo).
- **Fora do escopo (congelado até aviso do Shar):** Trade entre jogadores (P2P de itens) e Login/contas. **Não confundir** o "Trade entre jogadores" congelado com o **Job System trader/hunter/thief** (transporte de mercadorias com PvP — esse SIM entra, se escolhido, numa leva futura).

---

## 1. Os sistemas do Silkroad (referência) — o cardápio do v0.3

Resumo fiel do que o Silkroad tem, pra embasar a priorização. (Referência — não é tudo pra fazer agora.)

### 1.1 Zonas / Mundo progressivo (o vetor central)
Mundo é uma **progressão linear de regiões**, cada uma com sua faixa de nível de monstros: Jangan ~1–20, Donwhang ~21–30 (caverna 60–70), Hotan ~31–60, Taklamakan ~60–80. Cada região tem cidade-hub (vendor, armazém, revive, teleporte), pontos de caça definidos, monstros e bosses próprios. O jogador se desloca pra áreas mais difíceis conforme fica mais forte — **o mapa é a progressão.** Teleporte entre cidades e mapa/minimapa pra navegar.

### 1.2 Job System — Trader / Hunter / Thief (leva futura)
A partir de certo nível, o jogador escolhe um papel: **Trader** transporta mercadorias numa caravana entre cidades pra lucrar; **Thief** rouba traders; **Hunter** protege traders e caça thieves. Triângulo de conflito = PvP emergente com propósito econômico. Job EXP/nível separado. *(PvP de transporte — NÃO é o trade P2P de itens congelado.)*

### 1.3 Guildas / 1.4 Union / 1.5 Fortress War (leva futura — endgame PvP)
Guildas (criar, cargos, armazém, chat). Union (combina parties em raid de até 32; aliança de guildas). Fortress War: cerco guild-vs-guild por fortalezas (portão → torres → coração); vencedor controla a taxa da cidade.

### 1.6 Quests (leva futura)
Missões narrativas + side quests; dão XP/SP/recompensa, apresentam zonas, apontam objetivos.

### 1.7 Profundidade de gear / Seals & Degrees
**Seal System** (SOS/SOM/SUN) — **já temos no v0.2.** **Degrees** (graus de gear por faixa de nível, com armadura por peças, escudo, acessórios). **Alquimia profunda** (quebrar item, item de proteção, queda múltipla na falha).

### 1.8 Dungeons / 1.9 Mounts / 1.10 PvP arena (leva futura)
Áreas instanciadas com bosses; montarias e animais de carga; zonas free-for-all e arena.

---

## 2. Escopo do v0.3 — Leva 1 (frentes independentes)

O núcleo é dividido em duas frentes que **não se cruzam**:

- **GABRIEL — Mundo & Combate:** variação de classes (Mago/Arqueiro/Espada&Escudo/Lança), habilidades visuais (VFX de fogo/distância/curta), expansão do mapa-múndi com mobs por nível, expansão da cidade estilo Jangan. **Gabriel é dono do combate inteiro** (ofensivo E defensivo) — porque as classes são dele e mexem no cálculo de dano.
- **KEVIN — Itens & Inventário:** slots de equipamento completos (peças de armadura, escudo, acessórios), degrees (graus por nível), alquimia com risco real, armazém/banco, ficha de personagem. **Kevin NÃO toca combate** — só sistemas de item/inventário, que são auto-contidos.

**Por que essas duas frentes são independentes:** o Gabriel mexe em combate, habilidades, mundo, render. O Kevin mexe em definição de itens, equipar/desequipar, alquimia, banco, UI de inventário. **Nenhum arquivo de lógica é compartilhado, e nenhum sistema é dividido entre os dois.** O Kevin define os itens e como equipá-los; o Gabriel define como o combate usa os stats — mas o ponto de junção (stats afetam dano) já existe no jogo hoje e não precisa ser tocado pelos dois ao mesmo tempo (ver seção 3.1).

### Levas futuras (depois da fundação)
- **Leva 2 — Social/PvP:** Job System OU Guildas+Fortress War.
- **Leva 3+:** Quests, Dungeons, Union, Mounts, Áudio, PvP arena.

---

## 3. Divisão de trabalho — Gabriel × Kevin (INDEPENDÊNCIA TOTAL)

> **O princípio nº1 do Shar:** as tarefas não podem depender uma da outra, nem tocar os mesmos sistemas/arquivos. Cada frente trabalha, testa e commita isolada, sem quebrar o jogo do outro. A divisão abaixo garante isso: **sistemas inteiros, arquivos disjuntos, zero dependência cruzada.**

### 3.0 Regras de engenharia (valem pros dois)
- **Uma sim, vários hosts:** todo sistema roda igual em SP e MP, autoritativo no servidor. Lógica de jogo no `src/sim/` (determinística).
- **Determinismo sagrado:** os 111 testes de determinismo do sim DEVEM continuar passando sem mudança. Qualquer sorteio usa **RNG separado**, nunca o `this.rng` principal.
- **Cada sistema no seu módulo:** o `src/sim/sim.ts` NÃO recebe lógica nova inline — cada sistema cria seu arquivo (`src/sim/<sistema>.ts`) e o `sim.ts` só **chama**.
- **Fatias pequenas:** cada uma → typecheck + testes verdes → revisão adversarial → commit com mensagem exata → próxima. Sem push (o Shar faz).

### 3.1 Como as duas frentes NÃO se cruzam (o ponto crítico)

**A lição da tentativa anterior:** dividir o COMBATE entre os dois (ofensivo no Gabriel, defensivo no Kevin) criou dependência — o Kevin não andava sem o Gabriel, e ambos tocavam o cálculo de dano. **Corrigido:** o combate inteiro é do Gabriel.

**O único ponto onde itens e combate "se encontram" é:** os stats do equipamento (que o Kevin define) afetam o dano/defesa (que o Gabriel calcula). **Mas isso NÃO gera dependência de trabalho**, porque:
- O jogo **hoje** já lê os stats do equipamento no cálculo (weapon damage, etc.). O Kevin **adiciona novos stats aos itens** (defesa, stats de peças/acessórios) no schema de item — isso é trabalho dele, no arquivo dele.
- O Gabriel, quando for mexer em como o combate usa os stats (ex.: defesa reduz dano), lê os stats que **já existem na entidade** — não precisa esperar o Kevin nem editar os arquivos de item do Kevin.
- Ou seja: o Kevin enche os itens de stats (frente dele); o Gabriel decide como o combate usa stats (frente dele). Cada um no seu arquivo, sem ordem obrigatória entre eles.

**Tabela de domínios — arquivos 100% disjuntos:**

| Domínio | GABRIEL | KEVIN |
|---|---|---|
| Combate (ofensivo + defensivo) | `src/sim/combat*.ts` (dono total) | — (não toca) |
| Habilidades / classes | `src/sim/content/abilities*` | — |
| Mundo / zonas / spawn | `src/sim/zones.ts`, `src/render/world/*` | — |
| Visual / VFX | `src/render/vfx/*` | — |
| Definição de itens | — | `src/sim/content/items*` |
| Equipar / stats de gear | — | `src/sim/equip*` |
| Alquimia | — | `src/sim/enhance.ts` |
| Banco / armazém | — | `src/sim/storage*` |
| UI | `src/ui/map.ts`, livro de skills | `src/ui/inventory.ts`, `src/ui/storage.ts`, `src/ui/character_sheet.ts` |

### 3.2 Arquivos compartilhados — regra mínima
Poucos arquivos são tocados pelos dois; regra: **adições sempre no fim, nunca reordenar, avisar o outro.**
- `src/net/protocol.ts` — Gabriel adiciona msgs de zona/combate; Kevin de itens/banco. Sempre no fim.
- `src/world_api.ts` (`IWorld`) — métodos novos no fim.
- `src/sim/save.ts` — **Kevin é o dono** do schema de itens/gear/banco no save. Gabriel avisa só se precisar persistir zona atual.
- `src/sim/sim.ts` — cada um adiciona só **chamadas** pro seu módulo, em linhas próprias (Gabriel: combate/zonas; Kevin: equip/alquimia/banco). Como são seções diferentes do arquivo e linhas próprias, não colidem.

---

## 4. FRENTE GABRIEL — Mundo & Combate (prioridades do Shar no topo)

Gabriel cuida do que o jogador **vê e sente**: classes, efeitos, mundo, cidade — e é dono do **combate inteiro**. Ordem de prioridade (P1 → P4).

### G1 — Variação de classes (PRIORIDADE 1)
Transformar as 3 maestrias atuais (Espada/Lança/Arco) num sistema de **4 classes** com identidade:
- **Arqueiro:** dano físico à distância (formaliza o Arco).
- **Mago (NOVO):** dano **mágico** à distância — introduz o conceito de dano mágico no jogo (hoje só há físico). Maior novidade da frente.
- **Espada & Escudo:** corpo-a-corpo tank/defensivo (formaliza a Espada).
- **Lança:** corpo-a-corpo perfurante/área (mantém/ajusta).
- Cada classe com kit de habilidades e papel; mantém o subir-por-SP (rank) que já existe.
- **Como o combate é do Gabriel:** o Mago introduz `damageType: 'magical'` e, junto, a defesa mágica correspondente — tudo dentro dos arquivos de combate do Gabriel. Não depende do Kevin.
- **Arquivos:** `src/sim/content/abilities*.ts`, `src/sim/combat*.ts` (dono). `world_api.ts` (adicionar 'mage' ao MasteryId, no fim).
- **Commits:** `feat(sim): classe Mago e dano mágico` · `feat(content): kits de habilidade por classe`.

### G2 — Habilidades visuais à distância e curta / VFX (PRIORIDADE 2)
Efeito visual distinto por habilidade (hoje tudo usa o mesmo flash):
- **Fogo** (bola de fogo do Mago) — começar por aqui. Depois **projétil** (flecha) e **corpo-a-corpo** (slash/cone).
- **Arquivos:** `src/render/vfx/*` (novo). VFX é cosmético, não toca o sim — zero risco.
- **Commit:** `feat(render): efeitos visuais de habilidades`.

### G3 — Expansão do mapa-múndi com mobs por nível (PRIORIDADE 3)
Múltiplas regiões, cada uma com mobs de uma faixa de nível (Jangan 1–20, Donwhang 21–30...):
- **Modelo de zonas** (`src/sim/zones.ts`): regiões como dados (id, faixa de nível, bounds, hub, spots de spawn).
- **Spawn por zona:** mobs nascem nos spots de cada região, com espécies/níveis daquela zona (RNG separado por spot).
- **Mundo maior + biomas:** expandir o terreno (hoje 120×120) pra regiões distintas.
- **Aggro por nível:** mob muito acima do jogador é mais perigoso.
- **Sugestão de escopo:** 2–3 regiões pra começar (ajustável).
- **Arquivos:** `src/sim/zones.ts`, `src/render/world/*`. Coordenação: `sim.ts` (spawn por zona — função própria), `protocol.ts` (zona no snapshot, no fim).
- **Commits:** `feat(sim): sistema de zonas com mobs por nível` · `feat(render): biomas e mundo expandido`.

### G4 — Expansão da cidade estilo Silkroad / Jangan (PRIORIDADE 4)
Hub virando cidade de verdade (muralhas, portões, estruturas, layout):
- Reusa o MegaKit (95% sobrando). Cada região tem cidade-hub (vendor, revive, teleporte).
- Teleporte entre cidades (comando + custo de ouro).
- **Arquivos:** `src/render/world/cities/*`, `src/sim/zones.ts` (hub como dado), UI de teleporte.
- **Commits:** `feat(render): cidade-hub estilo Silkroad` · `feat(sim): teleporte entre cidades`.

### G5 — Mapa / minimapa (suporte)
Tela de mapa (tecla M) com as regiões e a posição. `src/ui/map.ts`. Commit: `feat(ui): mapa do mundo`.

**Arquivos do Gabriel:** `combat*.ts`, `content/abilities*`, `zones.ts`, `render/vfx/*`, `render/world/*`, `ui/map.ts`. Compartilhados (no fim): `sim.ts` (chamadas próprias), `protocol.ts`, `world_api.ts`.

---

## 5. FRENTE KEVIN — Itens & Inventário (NÃO toca combate)

Kevin cuida do que o jogador **ganha e veste** — sistemas de item/inventário auto-contidos. **Não toca combate, mundo, nem habilidades.**

### K1 — Slots de equipamento completos (set Silkroad)
De weapon+armor pro set completo: arma, **peças de armadura** (capacete, peito, mãos, pernas, pés), **escudo**, **acessórios** (colar, brinco, anel). Cada slot afeta os stats; recompute ao equipar/desequipar.
- **Arquivos:** `src/sim/content/items*`, `src/sim/equip*`, UI `src/ui/inventory.ts`.
- **Commit:** `feat(sim): slots de equipamento completos (armadura por peça, escudo, acessórios)`.

### K2 — Degrees (graus de gear por faixa de nível)
Equipamento em tiers (1º grau, 2º...), cada grau melhor e pra uma faixa de nível, com requisito de nível pra equipar.
- **Arquivos:** `src/sim/content/items*` + regras de requisito.
- **Commit:** `feat(content): graus de equipamento (degrees) por faixa de nível`.

### K3 — Stats defensivos NOS ITENS (sem tocar o cálculo de combate)
Os itens passam a ter **stat de defesa/armadura** (e stats de peças/acessórios). O Kevin **adiciona os stats ao schema do item e ao recompute da entidade** — NÃO mexe no cálculo de dano (isso é do Gabriel). Quando o Gabriel implementar "defesa reduz dano", ele lê o stat de defesa que o Kevin já pôs na entidade. Frentes independentes: Kevin enche o item de stats; Gabriel decide como o combate os usa.
- **Arquivos:** `src/sim/content/items*`, `src/sim/equip*` (recompute). **NÃO toca `combat*.ts`.**
- **Commit:** `feat(sim): stats defensivos no equipamento`.

### K4 — Alquimia com risco real
Na falha em "+" alto: **quebra** o item, **item de proteção** (piso), **queda de múltiplos níveis**. Fecha a ressalva do v0.2.
- **Arquivo:** `src/sim/enhance.ts` (estender).
- **Commit:** `feat(sim): alquimia com risco real (quebra, proteção, queda múltipla)`.

### K5 — Armazém / banco na cidade
Depósito/saque de itens num NPC de armazém. Persiste no save.
- **Arquivos:** `src/sim/storage*`, `src/ui/storage.ts`. Coordenação: `save.ts` (Kevin é o dono do schema de itens/banco).
- **Commit:** `feat(sim): armazém de itens na cidade`.

### K6 — Ficha de personagem como tela própria (suporte)
Tela dedicada de stats (hoje é uma linha na bolsa). `src/ui/character_sheet.ts`. Commit: `feat(ui): tela de ficha do personagem`.

**Arquivos do Kevin:** `content/items*`, `equip*`, `enhance.ts`, `storage*`, `ui/inventory.ts`, `ui/storage.ts`, `ui/character_sheet.ts`. Compartilhados (no fim): `save.ts` (dono do schema de itens), `protocol.ts`, `sim.ts` (chamadas próprias de equip/alquimia/banco).

---

## 6. Ordem de execução (frentes em paralelo, sem dependência)

**Não há "Ação Zero" nem ponto de sincronização obrigatório** — as frentes são independentes. Cada um segue sua ordem:

- **Gabriel:** G1 classes (Mago + dano/defesa mágica, tudo no combate dele) → G2 VFX → G3 zonas → G4 cidade → G5 mapa.
- **Kevin:** K1 slots → K2 degrees → K3 stats defensivos nos itens → K4 alquimia → K5 banco → K6 ficha.

Cada um commita suas fatias quando terminar; como os arquivos são disjuntos, `git pull`/merge não conflita. **Integração natural (sem trabalho extra):** o stat de defesa que o Kevin põe nos itens (K3) é lido pelo combate do Gabriel quando ele implementar a mitigação — acontece sozinho, cada um no seu tempo.

---

## 7. Decisões do Shar (defaults marcados — ajustar se quiser)

| # | Decisão | Default |
|---|---|---|
| 1 | Gabriel = Mundo & Combate (inteiro) · Kevin = Itens & Inventário (sem combate) | ✅ confirmada |
| 2 | Classes do Gabriel | Arqueiro, Mago, Espada&Escudo, Lança |
| 3 | Nº de zonas na Leva 1 (G3) | 2–3 regiões |
| 4 | Cap de nível do v0.3 | *a definir* |
| 5 | 2º grande social (Leva 2) | *a escolher:* Job System **ou** Guildas+Fortress War |
| 6 | Baixar assets (biomas, fogo, modelo do Mago) | *a decidir* — Quaternius/Poly Pizza/KayKit |

---

## 8. Próximas fases (pós-Leva 1) — referência

- **Leva 2 (social/PvP):** Job System (trader/hunter/thief) OU Guildas + Fortress War.
- **Leva 3+:** Quests, Dungeons, Union (raid 32), Mounts, Áudio, PvP arena.
- **Congelado (até aviso do Shar):** Trade P2P de itens, Login/contas. *(Job System trader/hunter/thief NÃO é o trade congelado.)*

---

*Plano de execução do v0.3 com frentes independentes. Gabriel (mundo & combate) e Kevin (itens & inventário) trabalham em paralelo, sem dependência cruzada, sem tocar os mesmos sistemas. Cada um commita no seu ritmo.*
