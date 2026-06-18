# LEIA PRIMEIRO — Openrealm

RPG web de mundo aberto (co-op 2 jogadores), feito por Gabriel & Kevin com IA.
Este arquivo é o **ponto de partida**. Siga os 4 passos:

## 1. Instale e rode (uma vez)
Siga o guia completo: **`docs/COMECANDO.md`**.
Resumo: instale Node.js, Antigravity (com Claude) e GitHub Desktop. Abra esta
pasta, rode no terminal `npm install` e depois `npm run dev`, e abra o endereço
que aparecer (`localhost:5173`) — você verá um personagem andando num mundo 3D.

## 2. Abra o projeto no Antigravity
Abra **esta pasta inteira** no Antigravity (não precisa "anexar" arquivos — o
agente lê o que precisar). Confirme que o modelo selecionado é o Claude.

## 3. Rode o prompt inicial
Cole o **prompt de orientação** que está em **`docs/EXECUCAO-E-PROMPTS.md` (§4)**.
Ele faz o agente ler as regras, verificar que o projeto roda, e confirmar que
entendeu a arquitetura — sem alterar nada.

## 4. Comece a construir (M1)
Siga a **sequência de prompts do M1** em **`docs/EXECUCAO-E-PROMPTS.md` (§5)**:
combate + a maestria Espada. Um prompt por vez → revisar → testar → commit.

---

## Mapa dos documentos
- **`docs/COMECANDO.md`** — setup do zero (instalar, rodar, GitHub, deploy).
- **`docs/EXECUCAO-E-PROMPTS.md`** — o loop de trabalho + prompts prontos.
- **`docs/design/GDD-Openrealm-v0.2.md`** — o design do jogo (fonte da verdade).
- **`docs/design/00-indice-mestre-gdd.md`** — status de cada sistema do design.
- **`docs/design/REF-silkroad-sistemas-essenciais.md`** — referência de mecânicas.
- **`CLAUDE.md`** (raiz + por pasta) — as regras que a IA segue.
- **`README.md`** — visão geral técnica do projeto.

## Regra de ouro
Uma tarefa pequena por vez → revisar o diff → testar no navegador → commit.
Nunca peça "faça o jogo inteiro".
