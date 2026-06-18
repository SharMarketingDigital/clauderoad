# Índice Mestre do GDD — Openrealm

> Mapa de **todas as seções** que o planejamento completo precisa ter. Status de
> cada uma:
> - ✅ **Decidido** — já está num doc.
> - 🟡 **Em aberto** — no radar, falta decidir.
> - 🔴 **Faltando** — nem entrou no planejamento ainda.
>
> Objetivo: nada importante passar batido. Conforme decidimos, vira um doc em
> `docs/design/` e o status sobe pra ✅.

---

## A. Visão & escopo
- ✅ **A1. Conceito / pilares** — RPG web, mundo aberto, tab-target, grind, co-op 2p. *(GDD v0.1)*
- 🟡 **A2. Plataforma & público** — web/navegador, 2 jogadores; decidido em conversa, falta escrever. *(Mobile no começo? decidir.)*
- 🔴 **A3. Setting / lore / fantasia** — Que mundo é esse? Tema, época, tom. Define nomes, arte, identidade.
- 🔴 **A4. Fantasia do jogador** — Em uma frase, o que é divertido aqui? ("Eu e meu parceiro farmamos, ficamos fortes e derrubamos bosses juntos.")

## B. Gameplay core
- ✅ **B1. Combate (tab-target)** — alvo, auto-ataque, GCD, recurso. *(GDD v0.1)*
- 🔴 **B1b. Status effects** — stun, slow, DoT, knockdown. Falta; dá profundidade barata.
- ✅ **B2. Maestrias de arma** — Espada/Escudo, Lança, Arco. *(GDD v0.1)*
- ✅ **B3. Atributos** — Força / Inteligência. *(GDD v0.1)*
- ✅ **B4. Progressão (XP/SP/stat)** — grind puro. *(GDD v0.1)*
- 🔴 **B4b. Curva & ritmo (pacing)** — Quão grindy? (Silkroad é brutal de propósito; nós provavelmente queremos mais gentil.) Tempo-alvo por nível, duração de sessão.
- 🔴 **B5. Loop central explícito** — minuto-a-minuto / sessão / longo prazo. (matar → lootear → upgradar → matar mais forte.)
- 🔴 **B6. Party / co-op (mecânica real)** — XP/loot compartilhado, como agrupar, crédito de kill, frames. *(É o pilar nº1 e não tem sistema.)*
- 🟡 **B7. Controles & câmera** — teclas, mouse; **decidir mobile/touch ou não**.
- 🟡 **B8. Morte & respawn** — penalidade. *(Flagged no GDD.)*

## C. Conteúdo & mundo
- 🟡 **C1. Mundo & zonas** — começar com 1 zona + hub. *(Flagged.)*
- 🟡 **C2. Inimigos & IA** — aggro, comportamento. *(Flagged.)*
- 🔴 **C2b. Tipos de monstro + bosses "unique"** — normal/champion/elite + bosses de mundo (ótimos pro co-op).
- 🟡 **C3. Itens & equipamento** — raridade branco/azul, graus, "+N". *(Loot flagged; profundidade não.)*
- 🔴 **C4. Alquimia / upgrade de gear** — o "+N" com chance de falha. **Alta prioridade**; é a alma do grind.
- 🟡 **C5. Loot & drops** — tabelas, taxas. *(Flagged.)*
- 🔴 **C6. Economia & vendor** — gold dos mobs, comprar poção / vender loot. (Pequena escala; sem job system.)
- 🔴 **C7. Mounts / viagem** — andar no mundo aberto; montaria?
- 🔴 **C8. Quests** — opcional, como bônus ao grind.

## D. Sistemas de suporte
- 🔴 **D1. Inventário / bags** — slots, volta pra cidade pra vender.
- 🔴 **D2. Trade entre jogadores** — direto entre os 2 (substitui as "stalls" do Silkroad).
- 🔴 **D3. Chat / comunicação** — co-op precisa de conversa in-game.
- 🔴 **D4. Tutorial / onboarding** — os 5 primeiros minutos; como se aprende a jogar.
- 🟡 **D5. Contas / personagens / save** — em parte já no esqueleto técnico (`server/`); falta a parte de design (quantos personagens? o que persiste?).

## E. Apresentação
- 🔴 **E1. Direção de arte / estilo visual** — low-poly? paleta? mood? **Decide quais packs CC0 puxar.**
- 🔴 **E2. Direção de áudio** — música, SFX (procedural tipo ClaudeCraft ou packs CC0?).
- 🔴 **E3. UI — inventário de telas** — HUD, inventário, ficha, livro de skills, mapa, vendor, frames de party, settings.

## F. Endgame & retenção  ← **o maior buraco**
- 🔴 **F1. "Por que continuar jogando?"** — cortamos TODO o endgame do Silkroad. Qual é o nosso? (Se for "gear perfeito via alquimia + bosses juntos", então C4 e C2b viram a espinha dorsal, não opcionais.)
- 🔴 **F2. Metas de longo prazo** — caça de gear, bosses recorrentes, novas zonas, conquistas.

## G. Produção
- ✅ **G1. Milestones M0–M4** — *(README do esqueleto.)*
- 🟡 **G2. Escopo do MVP** — o que é a "primeira versão jogável" mínima de verdade.
- ✅ **G3. Arquitetura técnica** — sim/IWorld/determinismo/CLAUDE.md. *(Esqueleto + CLAUDE.md.)*

---

## Prioridade sugerida pra fechar o planejamento
1. **F1 (endgame / por que jogar)** — guia todo o resto.
2. **B4b (ritmo do grind)** — define a sensação.
3. **C4 + C3 (alquimia + itens)** — o motor do grind/retenção.
4. **B6 (party)** — o co-op de verdade.
5. **E1 (direção de arte)** — destrava a escolha de assets.
6. **A3 (setting)** — dá identidade e nomes.

O resto (suporte, UI, quests, mounts) detalha conforme cada fase do roadmap chega.
