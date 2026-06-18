# GDD — Openrealm (v0.2 · completo)

> Documento principal de design. Substitui o v0.1 (combate/maestrias/progressão),
> que agora está folded aqui. Fonte da verdade do que está **decidido**, **em
> aberto** e **fora de escopo**. Base: sistema chinês do Silkroad + profundidade
> de combate do WoW Classic, adaptado pra um **co-op web de 2 jogadores**.
> Mecânicas são copiadas das referências (legal); nomes e conteúdo são nossos.

---

# A. Visão & escopo

## A1. Pilares
- **Mundo aberto + grind** (estilo Silkroad/Mir4): o loop central é farmar mobs.
- **Tab-target** com combate responsivo ("gostoso").
- **Maestrias de arma estilo Silkroad chinês**, enxuto: **3 armas**, sem maestrias
  mágicas/elementais.
- **Co-op de 2 jogadores** (Gabriel & Kevin) no mesmo mundo.
- **Caça de loot/gear por sorte** + **bosses de mundo**: o grande gancho do PvE.
- Crescer em fatias jogáveis. Sem pressa.

## A2. Plataforma & público
- **Web (navegador)** primeiro — link instantâneo, zero instalação, ótimo pra
  contribuição open-source. Empacotar como desktop (Tauri) é um passo opcional.
- **2 jogadores** no foco inicial; a arquitetura escala além disso.
- **Mobile/touch:** em aberto (decidir se entra cedo ou depois).

## A3. Ambientação *(provisória)*
- **Fantasia medieval, com sabor de Rota da Seda** (Ásia/Oriente Médio/Europa
  medievais misturados — que é literalmente o cenário do Silkroad).
- Direção: seguir a linha do Silkroad por enquanto; refinar pra uma identidade
  medieval própria depois. Nomes de zonas, bosses e itens serão nossos.

## A4. Fantasia do jogador
> "Eu e meu parceiro farmamos juntos, ficamos cada vez mais fortes, arriscamos
> upar nosso gear e derrubamos bosses raros do mundo."

---

# B. Gameplay core

## B1. Combate (tab-target)
Quatro engrenagens:
1. **Alvo.** `Tab` cicla os inimigos próximos à frente; clique seleciona. As
   habilidades acertam o alvo, respeitando **alcance** e **ângulo**.
2. **Auto-ataque.** Básico automático num *swing timer* (corpo a corpo) ou
   *auto-shot* (arco) enquanto o alvo está no alcance. Dá dano constante e, em
   algumas armas, gera recurso. Evita o combate virar spam de botão.
3. **Global Cooldown (~1,5s).** Ritmo entre habilidades. Habilidades grandes têm
   cooldown próprio por cima do GCD.
4. **Recurso.** Vida (HP) e Mana (MP). **Habilidades consomem MP** (modelo
   Silkroad) — por isso Inteligência importa mesmo em build físico.

**Fórmulas:** base no WoW Classic (já mapeadas), adaptadas — redução por armadura
`armor / (armor + 85·nível_atacante + 400)`, tabela de acerto, curva de XP. Não
inventar números de balanceamento.

**Sensação ("juice"):** número de dano saltando, flash no impacto, GCD curto,
efeito visual claro na habilidade.

## B1b. Status effects
Efeitos que enriquecem o combate e dão papel às armas:
- **Stun** (atordoa, sem ação) · **Slow** (lentifica) · **Root** (prende no lugar)
  · **Knockdown/Knockback** · **DoT** (sangramento / veneno / queimadura).
- Distribuição inicial (proposta): **Espada** → stun e bloqueio; **Lança** →
  knockdown + sangramento (DoT); **Arco** → slow (kiting) + tiro perfurante.
- Inimigos/bosses também aplicam status (ex.: um boss que amaldiçoa e inverte o
  efeito da poção, à la Silkroad "zombie").

## B2. As 3 maestrias de arma (as "classes")
Maestria do Silkroad chinês, **só com as 3 árvores de arma**. Cada uma sobe de
nível gastando SP; as habilidades destravam/sobem de rank conforme a maestria sobe.

- **Espada / Escudo** — melee defensivo, dano equilibrado, o mais durável.
  Passivo: aumenta bloqueio/absorção. Kit: golpe básico · golpe forte · postura
  defensiva · atordoamento.
- **Lança** — melee de dano alto, bom crítico, golpes em área. Passivo: aumenta
  vida. Kit: estocada · varredura em cone (AoE) · investida (fecha distância) ·
  buff de crítico.
- **Arco** — dano à distância, forte em alvo único; sobrevive mantendo distância.
  Passivo: aumenta precisão. Kit: auto-shot · tiro carregado · tiro múltiplo ·
  tiro que lentifica.

**Combinar maestrias?** Em aberto. Proposta: pode investir SP em mais de uma, mas
builds focadas numa arma são mais fortes — na prática lê como 3 "classes".

## B3. Atributos
- **Força** — dano físico, vida, defesa física.
- **Inteligência** — tamanho do pool de MP, defesa mágica.
- Escolha real do jogador: mais Força (bate mais forte e aguenta) vs mais
  Inteligência (mais MP pra spammar skill + resistência mágica).

## B4. Progressão (grind)
- **Loop:** achar um bom ponto de farm → matar mobs em série.
- **Duas moedas, do mesmo mob:** **XP** (sobe o nível) e **SP** (compra ranks de
  maestria e de habilidade).
- **Por nível:** +HP/MP, **+5 pontos de atributo** pra distribuir, e o SP acumulado
  fica disponível.
- **Habilidades sobem de rank** com SP: mais dano / efeito mais forte.

## B4b. Ritmo & pacing — **gentil e recompensador**
- Decisão: **não** copiar o grind brutal do Silkroad (que é punitivo de propósito,
  pra vender premium/tolerar bots). Curva **gentil no início**: níveis iniciais
  rápidos, drops generosos cedo, ganho de poder visível **a cada sessão**.
- Princípio: toda sessão de jogo deve terminar com "evoluí em algo" (nível, skill,
  um drop bom). Endurece de leve conforme sobe, nunca vira parede.
- Números exatos (taxas de XP/SP, curva) — TBD, tunar jogando.

## B5. Loop central (explícito)
- **Minuto-a-minuto:** mirar → bater/usar skill → matar → pegar loot/XP/SP → repetir.
- **Sessão:** farmar uma área → subir 1–2 níveis e/ou pegar um drop → upar
  skill/gear → ir pra área um pouco mais forte (ou caçar um boss).
- **Longo prazo:** caçar gear melhor (raridade + "+N" via alquimia) e derrubar
  bosses de mundo junto com o parceiro. *(Endgame formal: ver §F.)*

## B6. Party / co-op
- **Grupo de até 2** no começo (desenhar pra crescer depois).
- **Convite:** clique-direito num jogador → *Convidar pra grupo*.
- **XP/SP compartilhado:** dividido entre os membros com **bônus de grupo** (estilo
  vanilla/Silkroad), pra valer a pena jogar junto.
- **Loot:** proposta simples pra 2 amigos — *round-robin* (alterna quem pega) ou
  *pegar livre*. (Decidir; round-robin evita briga.)
- **Crédito de kill** compartilhado no grupo.
- **UI:** frames do grupo (vida/MP do parceiro) e **chat de grupo** (`/p`).

## B7. Controles & câmera
- **Teclado:** WASD move; `Tab` cicla alvo; `1–0` barra de habilidades; teclas pra
  inventário/ficha/skills/mapa.
- **Mouse:** arrastar gira a câmera; scroll zoom; clique seleciona / clique-direito
  ataca-interage.
- **Câmera:** terceira pessoa orbital.
- **Mobile/touch:** em aberto.

## B8. Morte & respawn
- Proposta leve (coerente com pacing gentil): morre → solta espírito → revive no
  **cemitério da zona**, com penalidade pequena (ex.: durabilidade do equipamento
  cai um pouco). Detalhar; manter **não punitivo demais**.

---

# C. Conteúdo & mundo

## C1. Mundo & zonas
- Começar com **1 zona + 1 cidade-hub** (vendedores, armazém, ponto de revive,
  teleporte). Expandir zona a zona depois, em progressão de nível.
- Pontos de farm espalhados pela zona; terreno pode ser procedural pra preencher.

## C2. Inimigos & IA
- **Tipos:** normal · **champion** (mais forte) · **elite** (bem mais forte) —
  variações de dificuldade/recompensa do mesmo mob.
- **IA:** aggro por proximidade e diferença de nível; perseguir; voltar/resetar ao
  se afastar (leash); patrulha simples.

## C2b. Bosses de mundo
Sistema de **boss que nasce no mundo** (modelo das "uniques" do Silkroad — Tiger
Girl, Uruchi etc.), com **nomes próprios nossos**:
- Nascem em **locais e horários** definidos (timer), com **anúncio** quando
  aparecem (e quando morrem, com o nome de quem matou).
- Bem mais HP, ataques e status especiais; podem **invocar ondas de minions** ao
  perder vida (ex.: em 80%/60%/20%).
- **Crédito/loot** vai pra quem causou mais dano (grupo primeiro).
- Dropam o **melhor loot** e maior chance de raridades (SOS/SOM/SUN).
- São o "conteúdo de raide" do co-op de 2.

## C3. Itens & equipamento
- **Slots:** arma (por maestria: Espada+Escudo / Lança / Arco), peças de armadura,
  acessórios.
- **Graus (degrees):** tiers de equipamento por faixa de nível (1°, 2°, …).
- **Raridade (do mais comum ao mais raro):**
  - **Normal** — base.
  - **SOS** (Seal of Star) — incomum, melhor que normal.
  - **SOM** (Seal of Moon) — raro, melhor que SOS.
  - **SUN** (Seal of Sun) — raríssimo, o topo.
  - *(Cada selo equivale a um item de nível mais alto.)*
- **Aprimoramento "+N":** de **+0 a +10** (cap no começo), via alquimia (ver C4).
- **Brilhos:** a arma ganha **efeito visual de brilho** a partir de ~**+3**,
  intensificando até **+10**. (Status visível de "essa arma é forte".)

## C4. Alquimia / upgrade de gear — **prioridade**
O loop de "arrisco evoluir meu equipamento?". Modelo Silkroad simplificado:
- **Subir o "+":** colocar **Elixir** do tipo certo (Arma / Armadura / Acessório)
  + **Pó da Sorte** (Lucky Powder) → tenta subir +1. **Pode falhar.**
- **Na falha:** o "+" **cai** (volta níveis) — e, em "+" altos, risco de **quebrar**
  o item. Quanto mais alto o "+", menor a chance de sucesso.
- **Itens de proteção** (proposta enxuta): *Pó da Sorte* aumenta a chance; um item
  de *Proteção* impede o "+" de cair abaixo de um piso na falha. (Versão simples
  dos Lucky/Immortal/Astral do Silkroad.)
- **Cap inicial:** +10.
- **Camada 2 (depois):** *pedras de atributo* (magic stones) que melhoram stats
  específicos do item num valor aleatório. Fica pra fase posterior.

## C5. Loot & drops — **por sorte (estilo Silkroad)**
- **Drop é RNG.** Cada mob tem tabela de drop; comuns caem direto, e **qualquer
  item — incluindo SOS/SOM/SUN — pode cair de qualquer monstro**, só que as
  raridades têm chance **muito baixa**.
- Isso cria o gancho do "drop de sorte": até um mob comum pode, raramente, soltar
  um SUN. É o que faz farmar ser viciante.
- **Bosses** têm loot melhor e chance bem maior de raridades.
- Drops incluem: gear, gold, poções, materiais de alquimia (elixir, pó da sorte).

## C6. Economia & vendor
- **Gold** cai dos mobs.
- **Vendedores (NPC)** na cidade: compram seu loot "lixo" e vendem poções, flechas,
  materiais básicos e gear inicial.
- Sem sistema de comércio/jobs (cortado — escala MMO).

## C7. Mounts / viagem
- Mundo aberto pede mobilidade. Proposta: uma **montaria** simples (cavalo) pra
  acelerar viagem. Pode entrar numa fase posterior (não-essencial pro MVP).

## C8. Quests
- **Opcionais**, como bônus/sabor (o foco é grind). Algumas podem apresentar a
  zona ou destravar/apontar um boss.

---

# D. Sistemas de suporte *(essenciais)*

## D1. Inventário / bags
- Inventário em grade, **slots limitados**. Encher → voltar à cidade pra vender/
  guardar. **Armazém (banco)** na cidade pra estoque extra.

## D2. Trade entre jogadores
- Janela de **troca direta** entre os 2: ambos colocam itens + gold, ambos
  confirmam, a troca é **atômica** (tudo ou nada). (Substitui as "stalls" do
  Silkroad — desnecessárias com 2 jogadores.)

## D3. Chat / comunicação
- **Chat de texto** in-game: geral (`/say`) e de grupo (`/p`). Mínimo pra co-op.

## D4. Tutorial / onboarding
- **Onboarding leve** no hub inicial: primeiras dicas/quest que ensinam mover,
  mirar, atacar, lootear, upar skill. Os 5 primeiros minutos importam.

## D5. Contas / personagens / save
- **Conta** com alguns **slots de personagem**. Tudo persiste no servidor
  (nível, atributos, skills, inventário, gear, posição). *(Detalhe técnico já no
  esqueleto: `server/`.)*

---

# E. Apresentação

## E1. Direção de arte *(provisória)*
- **Medieval com sabor Rota da Seda**, em **low-poly** usando packs CC0
  (Kenney/KayKit/Quaternius) + Mixamo pras animações. Definir paleta e mood.
- Refinar pra identidade própria depois.

## E2. Direção de áudio
- A decidir: SFX/música **procedurais** (estilo ClaudeCraft, via WebAudio) ou
  **packs CC0** (Kenney audio / Freesound CC0). Provável mistura.

## E3. UI — telas
Inventário de telas a construir: **HUD** (frames, barra de habilidades, alvo) ·
**inventário/bags** · **ficha do personagem** (atributos/equip) · **livro de
skills** (maestrias) · **janela de alquimia** · **mapa da zona** · **vendor** ·
**troca** · **frames de grupo** · **settings**.

---

# F. Endgame & retenção — *a decidir depois*
- **Decisão:** definir conforme o projeto anda. **Não** travar agora.
- **Princípio implícito (já assumido):** sem a camada MMO do Silkroad (fortress
  war/jobs/guildas), a retenção de longo prazo se apoia em **caça de gear (raridade
  + "+N" via alquimia)** e **bosses de mundo recorrentes**. Por isso C4 (alquimia) e
  C2b (bosses) são espinha dorsal, não extras.
- Ideias pra avaliar quando chegar a hora: bosses mais difíceis/raros, novas
  zonas, conquistas, builds alternativas de maestria, um duelo 1v1 amistoso.

---

# G. Produção
- **G1. Milestones M0–M4** — ver `README` do projeto.
- **G2. Escopo do MVP** *(em aberto)* — definir a "primeira versão jogável" mínima
  (proposta: 1 zona, 1 maestria jogável, loop matar→loot→upar, alquimia "+",
  inventário, vendor; depois as outras 2 maestrias e party).
- **G3. Arquitetura técnica** — "uma simulação, vários hosts" + `IWorld` +
  determinismo + hierarquia de `CLAUDE.md`. Ver esqueleto e `CLAUDE.md`.

---

# Fora de escopo (por enquanto)
- Maestrias mágicas/elementais (Fogo/Frio/Luz/Cura) e healer.
- Job System (mercador/caçador/ladrão) + economia de rotas.
- Guildas/unions + Fortress War.
- Item Mall / moeda paga.
- Auto-mode/AFK farming, PvP aberto, stalls, "gap" de SP-farming.

# Decisões ainda em aberto
- Endgame formal (§F) · MVP exato (§G2) · combinar maestrias (§B2) ·
  regra de loot em grupo (§B6) · mobile/touch (§A2/B7) · áudio (§E2) ·
  ambientação final (§A3) · números de balanceamento (§B4b).

---

## Changelog
- **v0.2** — GDD completo. Adicionados: status effects; party/co-op; itens &
  raridade (SOS/SOM/SUN), graus, "+N" até +10 com brilho; alquimia/upgrade;
  drop por sorte; bosses de mundo; economia/vendor; inventário; trade; chat;
  tutorial; contas/save; direção de arte/áudio/UI; ritmo de grind gentil;
  ambientação medieval (provisória). Endgame adiado de propósito.
- **v0.1** — fundamentos: tab-target; maestrias Espada/Escudo, Lança, Arco; grind;
  sem healer.
