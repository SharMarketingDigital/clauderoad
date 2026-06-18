# Execução & Prompts — operando o agente (Antigravity + Claude)

> Como dirigir a IA pra construir o Openrealm. Inclui a dinâmica, o que conectar
> (quase nada), um template de prompt reutilizável, e os prompts prontos do M1.

---

## 1. A dinâmica (o loop)

Uma tarefa por vez. Em cada uma:
1. Você dá **uma tarefa pequena** (um prompt).
2. O agente **lê os `CLAUDE.md` + arquivos relevantes, planeja, edita, roda
   comandos** (`npm test`, `npm run typecheck`).
3. Você **revisa o diff**, **testa** (`npm run dev` no navegador), aprova ou devolve.
4. Aprovado → **commit + push** (GitHub Desktop).
5. Próxima tarefa.

Seu papel = encarregado de obra: assina a tarefa, inspeciona, aprova/refaz.
**Nunca** "faça o jogo inteiro" — uma engrenagem por vez.

---

## 2. O que conectar (MCP / API)

- **Obrigatório:** só o modelo (Claude) já configurado no Antigravity. Nada além.
- **MCP:** **não precisa** pra construir. O agente já lê/escreve arquivos e roda o
  terminal sozinho.
  - *Opcional, com valor real:* uma ferramenta de **browser** (built-in ou MCP tipo
    Playwright) pra o agente **abrir e testar o jogo** sozinho. Adicionar depois.
- **API no código:** **NENHUMA.** O jogo não usa IA — não vai chave de API alguma
  no projeto. A IA constrói; o jogo é só um RPG.

---

## 3. Template de prompt (reutilize pra QUALQUER tarefa)

```
CONTEXTO: [por que isso, em 1 frase — o que o jogador deve poder fazer]

TAREFA: [o que implementar, específico e pequeno]

RESTRIÇÕES:
- Respeite a arquitetura: render/ui falam só com o IWorld (src/world_api.ts),
  nunca com o Sim direto.
- Lógica de jogo só em src/sim/ (sem DOM/Three, sem Math.random/Date.now,
  tick fixo 20Hz/determinismo).
- Leia o CLAUDE.md da pasta antes de mexer nela.

CRITÉRIO DE ACEITE: [como sei que ficou pronto — em termos do que vejo no jogo]

VERIFICAÇÃO: rode `npm run typecheck` e me diga se passou. Se mexeu em lógica do
sim, adicione/atualize um teste em tests/. Vou testar no navegador com `npm run dev`.
```

---

## 4. Prompt de orientação (rode ao abrir o projeto numa sessão nova)

```
Você vai trabalhar no Openrealm, um RPG web em TypeScript + Three.js.

PASSO 1 — Leia, sem alterar nada:
- CLAUDE.md da raiz e os CLAUDE.md de src/sim, src/render, src/ui.
- docs/design/GDD-Openrealm-v0.2.md (o design canônico).

PASSO 2 — Verifique a saúde do projeto rodando, nesta ordem:
- `npm install`
- `npm run typecheck`
- `npm test`
Me diga se os três passaram.

PASSO 3 — Me dê um resumo de até 6 linhas confirmando que entendeu: o stack, a
regra do IWorld, e os invariantes do src/sim (sem DOM/Three; determinismo 20Hz;
sem Math.random/Date.now).

NÃO altere nenhum código nesta etapa — só leia, verifique e confirme.
```

Depois disso, abra o jogo você mesmo com `npm run dev` pra ver o personagem
andando no navegador. Aí sim parta para o M1.1.


---

## 5. Sequência de prompts do M1 (combate + 1 maestria)

Faça **um por vez**: cole, revise, teste, commit, próximo. (Comece pela maestria
**Espada** — uma só por enquanto.)

### M1.1 — Seleção de alvo (tab-target)
```
CONTEXTO: o jogador precisa selecionar um inimigo para atacar.

TAREFA: implemente seleção de alvo. Adicione ao IWorld o comando de selecionar/
ciclar alvo e a leitura do "alvo atual" do jogador. Tab cicla para o inimigo mais
próximo à frente; clicar num inimigo também seleciona. A simulação guarda o
targetId do jogador. No render, destaque o inimigo selecionado (contorno ou
marcador) e mostre um "target frame" no HUD (nome + barra de vida do alvo).

RESTRIÇÕES: lógica de alvo em src/sim/; render/ui só via IWorld; não quebrar o
determinismo. Leia os CLAUDE.md das pastas antes.

CRITÉRIO DE ACEITE: aperto Tab e o inimigo mais próximo fica selecionado; o HUD
mostra nome e vida dele; clicar em outro troca; o alvo morto/saiu limpa a seleção.

VERIFICAÇÃO: `npm run typecheck` passa; teste no sim para a lógica de ciclar alvo.
```

### M1.2 — Auto-ataque + morte do inimigo
```
CONTEXTO: com um alvo selecionado e no alcance, o personagem deve atacar sozinho.

TAREFA: implemente auto-ataque por swing timer (corpo a corpo). Quando há alvo no
alcance e à frente, a cada swing causa dano ao alvo. Dano = fórmula simples
baseada em Força + arma (valores provisórios, comentados). A vida do inimigo cai;
ao chegar a 0 ele morre e some, e renasce no mesmo tipo de ponto após ~15s.

RESTRIÇÕES: toda a matemática de combate em src/sim/ (determinística); sem
Math.random/Date.now. render/ui só via IWorld.

CRITÉRIO DE ACEITE: com alvo no alcance, ataco automaticamente a cada swing, a
vida do alvo diminui, ele morre e some, e reaparece depois.

VERIFICAÇÃO: `npm run typecheck` passa; teste do cálculo de dano no sim.
```

### M1.3 — Feedback de dano (juice)
```
CONTEXTO: o combate precisa "sentir" gostoso.

TAREFA: ao causar dano, mostre o número saltando acima do alvo (floating combat
text) e um flash branco rápido no modelo atingido. Para isso, exponha no IWorld
uma lista de "eventos recentes" (ex.: dano causado neste tick) que o render lê e
desenha. Os eventos são gerados pela simulação; o desenho é só no render/ui.

RESTRIÇÕES: a geração dos eventos é determinística no sim; a apresentação é no
render/ui via IWorld.

CRITÉRIO DE ACEITE: vejo números de dano subindo e um flash no inimigo a cada golpe.

VERIFICAÇÃO: `npm run typecheck` passa; testo no navegador.
```

### M1.4 — Primeira habilidade: Golpe Forte (GCD + MP)
```
CONTEXTO: além do auto-ataque, o jogador usa habilidades que custam recurso.

TAREFA: adicione a habilidade "Golpe Forte" da Espada no slot 1 (tecla 1). Causa
dano extra ao alvo, consome MP, respeita o Global Cooldown de 1,5s e tem um
cooldown próprio. Adicione uma barra de habilidades simples no HUD mostrando o
ícone do slot 1 e o cooldown girando. Adicione o comando "usar habilidade {slot}"
ao IWorld.

RESTRIÇÕES: efeito/custo/cooldown calculados no sim (determinístico); barra de
habilidades é UI; tudo via IWorld.

CRITÉRIO DE ACEITE: aperto 1, dou um golpe mais forte no alvo, gasta MP, e o slot
entra em cooldown (e o GCD bloqueia spam por 1,5s).

VERIFICAÇÃO: `npm run typecheck` passa; teste do consumo de MP e do cooldown no sim.
```

### M1.5 — XP e subir de nível
```
CONTEXTO: matar mobs precisa fazer o personagem evoluir (pacing gentil).

TAREFA: ganhar XP ao matar um inimigo; subir de nível ao atingir o limiar da
curva (curva GENTIL e provisória — fácil no começo, comentar os números). Ao
subir: aumenta HP/MP e concede +5 pontos de atributo (por ora pode só acumular um
contador "pontos disponíveis"). Adicione uma barra de XP no HUD e um efeito visual
simples de level up.

RESTRIÇÕES: XP/curva/level no sim (determinístico); barra de XP é UI; via IWorld.

CRITÉRIO DE ACEITE: mato mobs, a barra de XP enche, subo de nível com feedback, e
meu HP/MP máximos aumentam.

VERIFICAÇÃO: `npm run typecheck` passa; teste da curva de XP / threshold de nível.
```

---

## 6. Depois do M1

Mesma receita pros próximos blocos do GDD, sempre fatiando pequeno:
- **M2 (grind):** distribuir pontos de atributo na ficha → as outras 2 maestrias →
  inventário/bags → loot por sorte (tabelas de drop) → vendor → alquimia (+N).
- **M3 (co-op):** servidor que roda o mesmo Sim → conectar 2 clientes por WebSocket
  → party (XP/loot compartilhado, frames) → chat.
- **M4:** persistência (Postgres) → deploy do servidor → público.

Regra que vale sempre: **uma tarefa → revisar → testar → commit.**
