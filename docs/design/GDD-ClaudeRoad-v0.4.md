# GDD ClaudeRoad v0.4 — O Mapa do que Falta (fiel ao Silkroad)

> **Documento de planejamento do v0.4 — geral, não é divisão de tarefas.** Define os sistemas do Silkroad Online que o ClaudeRoad vai implementar nesta fase, descritos como devem ser feitos, com prioridade.
>
> **Decisões do Shar aplicadas:** Job System **adiado** · Alquimia profunda (Magic Stones) **adiada** · Fortress War **fora** · **Guildas + Union dentro** · **+ 2 quick wins de experiência como prioridade** (fluxo de criação de personagem e áudio/música de fundo) · restante aprovado.
>
> **Princípio:** clonar o comportamento do Silkroad primeiro, depois ajustar à nossa escala (poucos jogadores). Mecânicas são copiadas (legal); nomes e conteúdo são nossos.

---

## 0. Como ler este documento

- **Objetivo:** definir, de forma completa e honesta, **os sistemas do v0.4** e a **ordem** de fazê-los. Quem implementa e como dividir vem depois, num plano à parte.
- **Legenda (usada no §3):** ⏭️ adiado · ❄️ congelado · ✂️ cortado (escala MMO).
- **Dois quick wins (§1.3 e §1.4):** fluxo de criação de personagem (classe → nome) e áudio/música de fundo. Baratos, alto valor, sem dependência — prioridade de execução (Tier 0 no §2).
- **Sobre escala:** vários sistemas do Silkroad pressupõem muita gente. Onde isso acontece, o doc marca a **adaptação** que torna o sistema jogável com 1–2 pessoas, ou separa a parte que **funciona já** da que **cresce com população**.

---

## 1. Os sistemas do v0.4

> Agrupados por tema (pilar social/PvP, acabamentos de experiência, QoL/tempero, conteúdo). A **ordem de execução** está no §2. Cada um traz: **como é no Silkroad** (fiel), **o que falta**, **adaptação à escala** e **prioridade**.

---

### 1.1 Guildas + Union (a camada social) — **o maior sistema do v0.4**

**Como é no Silkroad:** estrutura social persistente.
- **Guilda:** criar (custo em ouro), **mestre + cargos** com permissões, **nome/emblema**, **canal de chat de guilda**, **armazém de guilda** (estoque compartilhado), e **nível de guilda** que sobe pela atividade dos membros.
- **Union:** **aliança de guildas** — permite **party de raid de até 32**, chat de union, e coordenação pra conteúdo grande.
- Guildas podem **declarar guerra** entre si (ver 1.2 — a parte PvP).

**O que falta:** tudo. Precisa de: criação/dissolução de guilda, **membros + cargos/permissões**, **chat de guilda**, **persistência** (quem é de qual guilda, cargos, armazém) e o conceito de **union** (alianças + raid estendido). A persistência usa o **banco e a identidade por nome** — **não exige descongelar login**.

**Adaptação à escala:** guildas **degradam bem** (diferente da Fortress War). Uma guilda de 2 já tem chat/cargos/armazém funcionando; o valor **cresce** com mais gente. Union (raid 32) funciona como mecanismo mesmo sem encher os 32 — é party estendida.

**⚠️ Decisão necessária — armazém de guilda × freeze de trade P2P:** o estoque compartilhado de guilda é, na prática, **uma forma de passar itens entre jogadores** (deposito, o colega saca). Como o **Trade P2P de itens está ❄️ congelado**, há conflito de escopo. Duas opções:
  - **(a) Respeitar o freeze:** armazém de guilda **pessoal por membro** (cada um só saca o que ele mesmo depositou) — ou fora do escopo do v0.4.
  - **(b) Exceção escopada:** armazém realmente **compartilhado** — abre uma forma limitada de transferir itens entre membros.
  → **Default sugerido: (a)**, pra manter o freeze intacto. Você decide.

> **Prioridade: ALTA (o pilar do v0.4).** Maior sistema da fase; estrutura social fiel; funciona pequeno e escala. Pareia com o PvP (1.2).

---

### 1.2 PvP — duelo 1v1 + guerra de guildas (a primeira PvP do jogo)

**Como é no Silkroad:** sem PvP nas cidades; **duelos 1v1** amistosos; **guild wars** (guilda declara guerra a outra → membros se atacam livremente); e, em escala, PK de mundo aberto.

**O que falta:** **qualquer PvP** — hoje o jogo é 100% PvE. A peça técnica nova é a **regra de elegibilidade** (quem pode atacar quem). **Não é netcode novo:** jogadores já são entidades e o combate entre entidades já sincroniza; resolução autoritativa no servidor.

**Adaptação à escala (a parte honesta):**
- **Duelo 1v1 → funciona JÁ, com 2 pessoas.** PvP imediatamente jogável — ótimo pra dois jogadores testarem o balanço das classes um contra o outro. Baixo custo.
- **Guerra de guildas → cresce com população.** Precisa de ≥2 guildas com gente online; o *mecanismo* entra agora, o uso real depende de mais jogadores.
- **Cidade e farm comum continuam seguros** (sem PK forçado de mundo aberto — ver §3).

> **Prioridade: duelo = ALTA (jogável já) · guerra de guildas = MÉDIA (entra com as guildas, ativa com população).** Pareia com 1.1.

---

### 1.3 Fluxo de criação de personagem (classe → nome) — **quick win**

**Como é no Silkroad:** ao entrar, o jogador cria o personagem — escolhe classe/aparência e **digita um nome** antes de cair no mundo.

**O que falta:** **metade já existe** — a **seleção de classe ao entrar** está pronta (escolhe 1 de 4 classes e equipa arma+kit; funciona em SP e MP). **Falta a tela de digitar o nome depois da classe**: hoje o nome no multiplayer vem por **parâmetro de URL**, não por uma tela de verdade pro jogador. A sequência completa é **entrar → tela de classe (existe) → tela de nome (nova) → mundo**. O nome digitado vira a **chave de save** (a identidade-por-nome que o jogo já usa). Validação simples (não-vazio, tamanho/caracteres).

**Não fere o freeze de Login/contas:** é só dar **cara de tela** à identidade-por-nome existente — **sem conta, sem senha**. UX sobre o que já há.

**Adaptação/escopo:** pequeno. Só adiciona um input de nome e o liga ao fluxo de entrada existente.

> **Prioridade: ALTA / quick win.** É a primeira coisa que o jogador vê; o nome por URL é tosco pra quem chega novo. Muito valor por pouco esforço.

---

### 1.4 Áudio / música de fundo (CC0) — **quick win**

**Como é no Silkroad:** trilha contínua que dá vida ao mundo — **ambiente por região**, **tema de cidade** e **música de combate/boss**.

**O que falta:** o jogo **não tem música**. Precisa de trilha de fundo loopável. **Mínimo: 3 faixas** — **loop de exploração** (o mais importante; é onde o jogador passa o tempo farmando), **tema de cidade** e **faixa de combate/boss**.

**Fonte (decidida): CC0.** Base no acervo **"CC0 Fantasy Music & Sounds" do OpenGameArt** + **1–2 faixas desérticas/orientais CC0** pro tempero da Rota da Seda (base medieval + sabor oriental = o nosso tema). **Por que CC0:** o repo é público e o jogo serve os arquivos de áudio direto ao navegador — mesma situação dos modelos 3D; CC0 evita a **zona cinza de redistribuição** do Fab/Mixamo e mantém o áudio alinhado à disciplina de assets do projeto. *(CC-BY também serve, com um arquivo de créditos. Pack do Fab só com checagem de licença / arquivos fora do source público.)*

**Adaptação/escopo:** loop simples via **áudio do navegador** (HTML5 audio / WebAudio), com **controle de volume + mute**. Começar com 3 faixas; **expandir por região depois** — cada região pode ganhar a sua.

**Determinismo:** áudio é **cosmético, fora do sim** — zero risco pro determinismo.

> **Prioridade: ALTA / quick win.** Transforma a sensação do jogo por pouco esforço — um mundo sem música soa vazio.

---

### 1.5 Montarias & transporte (QoL de viagem)

**Como é no Silkroad:** montaria de viagem acelera o deslocamento num mundo grande; tiers maiores carregam mais (no Silkroad isso servia o transporte de comércio — adiado, então **a justificativa vira pura mobilidade**).

**O que falta:** sistema de **montaria rideável** (invocar, montar, mover, render).

**Adaptação:** começar com **1 montaria de viagem**. Num mundo aberto grande, mobilidade é QoL real. A capacidade de carga (que serviria o Job System) fica em standby até/se o Job System voltar.

> **Prioridade: MÉDIA.** Qualidade de vida; não é estrutural.

---

### 1.6 Grab pet / auto-loot

**Como é no Silkroad:** **grab pet** pega o loot do chão automaticamente.

**O que falta:** o grab pet — QoL gostosa pro grind (não parar pra catar cada drop).

**Adaptação:** pet simples que recolhe loot num raio.

> **Prioridade: MÉDIA.** QoL de grind; fácil; agradável.

---

### 1.7 Consumíveis & QoL — return scroll, auto-potion

**Como é no Silkroad:** além das poções de HP/MP, há **return scrolls** (recall pra cidade), **auto-potion** (dispara poção em limiar de HP/MP) e pílulas que curam status.

**O que falta:** **return scroll** (voltar do farm rápido) e **auto-potion** (sobrevivência no grind e nos duelos).

**Adaptação:** ambos diretos e baratos.

> **Prioridade: MÉDIA.** QoL barata que melhora farm e PvP.

---

### 1.8 Berserk

**Como é no Silkroad:** acumula pontos matando; ao encher (5 barras), ativa **modo de velocidade/dano** por um tempo.

**O que falta:** o sistema inteiro.

**Adaptação:** medidor que enche no combate + buff temporário ao ativar (sorteio, se houver, com **RNG separado**). Dá "tempero" também aos duelos.

> **Prioridade: MÉDIA-BAIXA.** Momentos de poder; não é estrutural.

---

### 1.9 Penalidade de morte (durabilidade no gear)

**Como é no Silkroad:** morrer **gasta durabilidade** do equipamento e consome consumíveis; reviver no cemitério/ponto de ressurreição.

**O que falta:** virar regra de fato — uma penalidade **leve** (revive na cidade, durabilidade cai um pouco), **não punitiva demais** (pacing gentil).

**Adaptação:** leve. Com graus e +N no gear, a durabilidade ganha peso natural (consertar custa → reforça a economia de cidade). Ganha relevância extra com o PvP.

> **Prioridade: BAIXA (mas rápida).** Fecha uma ponta solta; barato.

---

### 1.10 Cap de maestria (foco de build)

**Como é no Silkroad:** teto total de pontos de maestria, forçando builds **focadas**. (O truque "gap" SP-farming é icônico mas jankento.)

**O que falta:** o **cap** (incentiva foco, casa com as 4 classes e ganha peso com PvP).

**Adaptação:** regra pequena. O **"gap"** fica como ⏭️ talvez-nunca (janky).

> **Prioridade: BAIXA-MÉDIA (cap).**

---

### 1.11 Quests

**Como é no Silkroad:** existem, mas o jogo é **grind-cêntrico** — quests são secundárias; algumas **apresentam zonas** ou **apontam bosses**.

**O que falta:** qualquer sistema de quest.

**Adaptação:** **opcional**, como sabor/onboarding. Algumas quests que ensinam o mundo ou apontam um boss/zona dão direção sem virar o foco.

> **Prioridade: BAIXA.** Bom pra norte e sabor; o grind segue sendo o foco.

---

### 1.12 Dungeons / instâncias

**Como é no Silkroad:** áreas **instanciadas** com bosses próprios — desafios fechados pra grupo.

**O que falta:** o conceito de instância (área privada por grupo) e o conteúdo dela.

**Adaptação:** depende de **conteúdo** (mapas, bosses); encaixa melhor **depois** que o mundo aberto e os bosses de mundo amadurecerem. Os **bosses de mundo** já cobrem parte do "raide de co-op".

> **Prioridade: BAIXA (leva futura).** Alvo de quando faltar endgame PvE.

---

## 2. Prioridade sugerida — a ordem de implementar

Ranqueado por **fidelidade × valor × encaixe de escala × dependência × custo**.

**Tier 0 — Quick wins de experiência (baratos, alto valor, sem dependência — dá pra fazer já):**
1. **Fluxo de criação de personagem** (1.3) — metade já existe (tela de classe); falta só a tela de nome.
2. **Áudio / música de fundo** (1.4) — CC0 drop-in; transforma a sensação por pouco esforço.

> *Esses dois não dependem de nada e melhoram o jogo imediatamente — bons de fechar antes/junto do pilar.*

**Tier 1 — a camada social/PvP (o pilar do v0.4):**
3. **Guildas + Union** (1.1) — a maior peça da fase; funciona pequena e escala.
4. **PvP** (1.2) — **duelo 1v1 já** (jogável com 2 pessoas) + **guerra de guildas** (entra com as guildas, ativa com população).

**Tier 2 — QoL & tempero (sem problema de escala):**
5. **Return scroll + auto-potion** (1.7)
6. **Grab pet / auto-loot** (1.6)
7. **Montarias** (1.5) — QoL de viagem
8. **Berserk** (1.8)
9. **Penalidade de morte** (1.9)
10. **Cap de maestria** (1.10)

**Tier 3 — conteúdo (leva futura):**
11. **Quests** (1.11)
12. **Dungeons / instâncias** (1.12)

---

## 3. Adiado, congelado e cortado

**⏭️ Adiado (decisão do Shar neste v0.4 — pode voltar numa leva futura):**
- **Job System (trader/hunter/thief)** — *"não nesse"*. A economia de rotas + PvP de caravana fica pra leva futura. *(Quando voltar, puxa junto a capacidade de carga das montarias.)*
- **Alquimia profunda — Magic Stones (atributos no gear)** — *"por enquanto não"*. A 2ª camada da alquimia fica pra depois; o **"+N com risco" segue sendo a alquimia ativa**.
- **Fortress War** — *"não"*. Cerco guild-vs-guild por fortalezas; endgame PvP de escala — **precisa de população (40+)**. Extensão natural das guildas quando o jogo tiver gente.

**❄️ Congelado (até aviso do Shar):**
- **Trade P2P de itens entre jogadores.** *(Atenção ao armazém de guilda — ver a decisão em 1.1.)*
- **Login / contas.** A identidade **por nome** cobre guildas, PvP e persistência. *(A tela de nome do fluxo de entrada — 1.3 — é identidade-por-nome, não login.)*

**✂️ Cortado (escala MMO / fora da filosofia do projeto):**
- **Item Mall / moeda paga (Silk)** — projeto open-source e grátis.
- **Stalls** (lojinha pessoal) — desnecessário.
- **PK forçado de mundo aberto / always-PvP** — sem população vira deserto ou abuso; o PvP do v0.4 é **consensual** (duelo + guerra de guildas declarada), nunca PK forçado.

---

*Escopo do v0.4 com as decisões aplicadas. Os sistemas (§1) na ordem do §2: primeiro os **quick wins de experiência** (fluxo de entrada + áudio CC0 — baratos e de alto valor), depois o pilar **Guildas + Union + PvP** (duelo já, guerra de guildas com população), seguido de **QoL/tempero** e, por fim, **quests/dungeons** como conteúdo futuro. Job System, Magic Stones e Fortress War ficam mapeados pra levas futuras. Quando você fechar o pilar, monto o plano de execução à parte.*
