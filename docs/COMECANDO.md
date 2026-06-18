# Começando — Guia de produção do Openrealm (do zero)

> Para quem nunca programou. Siga na ordem. Cada passo diz **o que fazer** e
> **por quê**. Não precisa decorar nada — é só seguir.

---

## 0. Modelo mental (leia primeiro)

Quatro lugares, só isso:
1. **Seu computador** — onde o jogo é feito. Roda no seu navegador local
   (`localhost`) enquanto você desenvolve. Só você vê.
2. **GitHub** — cópia do projeto na nuvem. Guarda tudo, sincroniza Gabriel & Kevin,
   e é o repositório aberto pra comunidade.
3. **A IA (Cursor / Claude Code)** — escreve a maior parte do código, seguindo os
   `CLAUDE.md` e o GDD. Vocês dirigem; ela constrói.
4. **Servidor de produção** — onde o jogo fica "no ar" num endereço público.

**Linguagem:** TypeScript (já montada no esqueleto). Você **não precisa dominá-la**
— a IA escreve, você direciona, testa e revisa.

---

## 1. Instalar as ferramentas (uma vez só)

1. **Node.js** — o motor que roda o projeto.
   - Baixe a versão **LTS** em https://nodejs.org e instale (next, next, next).
   - Conferir: abra um terminal e rode `node --version` (deve mostrar v18+).
2. **Cursor** — editor de código com IA embutida (amigável pra começar).
   - Baixe em https://cursor.com e instale.
   - *(Alternativa mais poderosa: **Claude Code**, agêntico no terminal — foi o que
     o criador do World of Claudecraft usou. Comece pelo Cursor; adote o Claude
     Code quando estiver confortável.)*
3. **GitHub Desktop** — app visual pra usar o GitHub sem terminal.
   - Baixe em https://desktop.github.com e instale.
   - Crie uma conta em https://github.com.
4. **Navegador** — já tem.

---

## 2. Rodar o esqueleto (ver funcionando)

1. Descompacte o `openrealm-starter.zip` numa pasta (ex.: `Documentos/openrealm`).
2. No Cursor: **File → Open Folder** → escolha a pasta `openrealm`.
3. Abra o terminal do Cursor: **Terminal → New Terminal**.
4. Rode, um de cada vez:
   ```bash
   npm install      # instala as peças (Three.js, etc.) — demora um pouco, é normal
   npm run dev      # liga o jogo
   ```
5. O terminal vai mostrar um endereço tipo `http://localhost:5173`. Abra no
   navegador → você vê o personagem andando (WASD, mouse gira a câmera).

✅ **Marco:** "funciona na minha máquina." Pra parar o jogo: clique no terminal e
aperte `Ctrl + C`.

Outros comandos úteis (rodar quando quiser):
- `npm test` — roda os testes (ex.: o teste de determinismo).
- `npm run typecheck` — confere se o código TypeScript está válido.

---

## 3. Subir pro GitHub (versionar + colaborar)

**Conceitos em 1 minuto:**
- **commit** = um "save point" com um nome (ex.: "adiciona ataque básico").
- **push** = manda seus commits pra nuvem (GitHub).
- **pull** = puxa o que o outro mandou.
- **branch** = uma linha de trabalho paralela, pra não atrapalhar o código principal.

**Passos (GitHub Desktop):**
1. **File → Add Local Repository** → escolha a pasta `openrealm`. Ele vai oferecer
   pra criar o repositório git → aceite.
2. Faça o primeiro **commit** (escreva uma mensagem tipo "esqueleto inicial") →
   **Commit to main**.
3. Clique em **Publish repository** → escolha o nome e se é público (sim, é open
   source) → publica no GitHub.
4. O outro (Gabriel ou Kevin) faz **File → Clone Repository** e escolhe esse repo
   pra ter a cópia dele.

---

## 4. O ciclo diário (como o jogo é construído)

Repita sempre este loop, **com passos pequenos**:

1. **Escolha UMA tarefa pequena** do GDD/roadmap (ex.: "personagem ataca um mob").
2. **Peça pra IA implementar.** No Cursor, abra o chat da IA e descreva a tarefa.
   Os `CLAUDE.md` já fazem ela seguir a arquitetura — se precisar, lembre: "respeite
   o `IWorld`, lógica em `src/sim/`, sem quebrar o determinismo."
3. **Teste no navegador** (`npm run dev` já rodando atualiza sozinho).
4. **Deu certo?** → no GitHub Desktop, **commit + push**.
5. **Deu errado?** → peça pra IA corrigir, ou desfaça (no GitHub Desktop dá pra
   descartar mudanças não commitadas).

**Regras de ouro:**
- Nunca peça "faça o jogo todo". Peça uma engrenagem de cada vez.
- Commit pequeno e frequente (é mais fácil voltar atrás).
- Antes de começar a mexer, dê **pull** pra pegar o que o parceiro fez.

---

## 5. Trabalhando em dois (Gabriel & Kevin)

A costura `IWorld` foi feita pra isso — divide bem o trabalho:
- **Pessoa A:** lógica e servidor → `src/sim/`, `server/`.
- **Pessoa B:** visual e interface → `src/render/`, `src/ui/`, `src/game/`.

**Fluxo recomendado (limpo):**
1. Antes de uma tarefa, crie um **branch** no GitHub Desktop (ex.:
   `feature/ataque-basico`).
2. Trabalhe, faça commits nesse branch, **push**.
3. No GitHub, abra um **Pull Request**; o outro dá uma olhada e faz **merge** no
   `main`.

*No comecinho, com só vocês dois, dá pra ser mais informal (combinar e commitar no
main, sempre dando pull antes). Mas pegar o hábito de branch + PR evita dor de
cabeça e já deixa o projeto pronto pra receber gente de fora.*

---

## 6. Colocar em produção (deploy)

Há **duas metades**, com dificuldades bem diferentes:

### 6a. O cliente web (single-player) — fácil e grátis, pode fazer já
O jogo no navegador vira "arquivos estáticos" quando você roda `npm run build`.
Hosts gratuitos servem isso e dão um endereço público:
1. Crie conta na **Vercel** (https://vercel.com) — login com o GitHub.
2. **Add New → Project** → importe o repositório `openrealm`.
3. Ela detecta que é um projeto **Vite** e configura sozinha → **Deploy**.
4. Pronto: um endereço público que **atualiza sozinho a cada push**.

*(Alternativas equivalentes: Netlify, Cloudflare Pages, GitHub Pages.)*

### 6b. O servidor multiplayer — passo pago e mais elaborado, mais pra frente
Quando for ligar "Gabriel e Kevin no mesmo mundo", o servidor (Node +
WebSocket + banco Postgres) precisa rodar **o tempo todo** — não dá pra ser
estático. Opções, da mais fácil à mais control-freak:
- **Railway** ou **Render** (https://railway.app / https://render.com) —
  gerenciado: você conecta o repo, eles rodam o servidor Node e te dão um Postgres.
  Mais fácil pra quem está começando.
- **VPS** (Hetzner, DigitalOcean) — um servidor Linux só seu (~€4–5/mês), onde você
  sobe tudo com Docker. Mais controle, mais trabalho.

**Resumo:** cliente web = grátis e instantâneo agora; servidor multiplayer = pago e
mais elaborado, lá no marco de multiplayer.

---

## 7. O caminho (marcos)

- **M0 — Fundação** ✅ — o esqueleto roda.
- **M1 — Combate + 1 maestria** — mirar, atacar um mob, matar, ganhar XP. *(próximo)*
- **M2 — Coração do grind** — itens, loot por sorte, alquimia (+N).
- **M3 — Co-op** — outras maestrias, party, servidor com os 2 no mesmo mundo.
- **M4 — Persistência + publicar** — salvar no banco, deixar público de verdade.

GDD = o norte do *o quê*. Roadmap = o norte do *quando*. Sempre: fatia pequena →
testa → commit.

---

## 8. Se quebrar (o básico)

- **`npm: command not found`** → o Node não instalou direito; reinstale (passo 1).
- **Erro vermelho ao `npm install`** → leia a última linha; geralmente é internet
  ou versão de Node. Copie o erro e peça pra IA explicar.
- **Tela preta / nada aparece** → confira se o `npm run dev` está rodando e se você
  abriu o endereço certo. Veja o console do navegador (F12) por erros.
- **"Conflito" no GitHub Desktop** → vocês dois mexeram no mesmo arquivo. Dê pull,
  resolva o trecho em conflito (ou peça pra IA), commit de novo.
- Regra geral: **copie a mensagem de erro e cole pra IA** — descrever o erro exato
  resolve 90% dos casos.

---

## Glossário rápido

- **Terminal** — janela onde você digita comandos.
- **Node / npm** — o motor que roda o projeto / o instalador de peças.
- **Repositório (repo)** — a pasta do projeto versionada no Git/GitHub.
- **Commit / push / pull** — salvar ponto / enviar pra nuvem / puxar da nuvem.
- **Branch / Pull Request (PR)** — linha de trabalho paralela / pedido pra juntar
  esse trabalho no principal.
- **Build** — transformar o código em arquivos prontos pra publicar.
- **Deploy** — colocar no ar, num endereço público.
- **Localhost** — endereço que roda só na sua máquina (desenvolvimento).
- **VPS** — um servidor Linux na nuvem, alugado.
