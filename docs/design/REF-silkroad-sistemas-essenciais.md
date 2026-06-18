# Referência — Sistemas essenciais do Silkroad Online

> Mapa enxuto de **todos os sistemas centrais** do Silkroad Online, organizado
> como um GDD, pra servir de direção. Cada sistema tem um **veredito** pro nosso
> projeto (Openrealm, RPG web de 2 jogadores):
>
> - ✅ **Adotar** — já decidido ou claramente sim.
> - 🔧 **Adaptar / ADICIONAR** — falta no nosso GDD; vale incluir (adaptado).
> - ⏸️ **Depois** — bom, mas não no começo.
> - ❌ **Cortar** — é de escala MMO; não faz sentido com 2 jogadores.
>
> Mecânicas são copiadas (legal); nomes/conteúdo são nossos.

---

## 1. Conceito
MMORPG na Rota da Seda (China → Ásia Central → Europa). Foco em **grind** e em
PvP/economia de **rotas de comércio**, não em dungeons/raids. Mundo grande mas
"comprimido" em cidades a pé umas das outras. Free-to-play com loja (Silk).

---

## 2. Personagem & maestrias
- **Raças:** Chinês e Europeu (depois Egípcio). Chinês = sem classe fixa, monta
  o kit com maestrias; Europeu = classe fixa.
- **Maestrias (chinês):** 3 de **arma** (Espada/Blade, Lança/Glaive, Arco) + 4 de
  **força/elemento** (Fogo, Gelo, Raio, Força/Cura). Você sobe maestrias com SP e
  destrava/sobe as skills delas. Skills custam **MP**.
- **Imbues / buffs:** skills que adicionam dano elemental aos ataques, e buffs
  (vida, ataque) — vêm das maestrias de força.

**Para o Openrealm:**
✅ Maestrias de **arma** (Espada/Escudo, Lança, Arco) — já no GDD.
❌ Maestrias de **força/elemento** (incl. Cura) — já cortadas (sem magia/healer).
🔧 **Imbues simples** poderiam virar buffs próprios de cada arma (opcional).

---

## 3. Atributos & progressão
- **Quatro "moedas" do mesmo mob:** XP (sobe nível), SP (sobe maestrias/skills),
  Stat points, e Job XP.
- **Stat points:** +5 por nível, distribuídos entre **Força** (dano físico, HP,
  def. física) e **Inteligência** (MP, def. mágica).
- **Cap de maestria:** chinês tinha teto total de pontos de maestria (ex.: 300),
  forçando builds focadas em vez de tudo no talo.
- **"Gap" SP-farming:** rebaixar a maestria em relação ao nível pra ganhar muito
  mais SP (e quase nada de XP). Icônico, mas jankento.

**Para o Openrealm:**
✅ XP + SP + stat points (Força/Inteligência) — já no GDD.
🔧 Cap de pontos de maestria pra incentivar foco — vale considerar.
⏸️ Truque do "gap" — talvez muito depois.

---

## 4. Combate
- **Tab-target.** Auto-ataque (swing timer / auto-shot) + skills que custam MP.
- **Berserk:** acumula pontos matando; ao encher, ativa um modo de
  velocidade/dano aumentados por um tempo.
- **Status:** stun, knockback, knockdown, burn/poison (DoT), freeze, e o famoso
  "zombie" (inverte o efeito das poções de cura).

**Para o Openrealm:**
✅ Tab-target + auto-ataque + custo de MP — já no GDD.
🔧 **Status effects** (stun, slow, DoT) — ótimos e baratos; vale incluir cedo.
⏸️ Berserk — feature de tempero, dá pra depois.

---

## 5. Itens & equipamento  ← **FALTA no nosso GDD**
- **Categorias:** armas, escudos, proteção de corpo (armor = phys alto/mágico
  baixo; protector = equilibrado; garment = mágico alto/phys baixo) e acessórios.
- **Graus (Degrees):** tiers por faixa de nível (1° a 11°+). Gear melhor = subir
  mais rápido e PvP mais forte.
- **Raridade:** branco (normal) vs azul (com atributos). Atributos azuis comuns:
  +HP, +MP, taxa de crítico, bloqueio, parry, resistência a status.
- **"+N" (Plus):** aprimoramento de 0 a +N via alquimia.
- **Selos:** Seal of Star (~+5 níveis), Seal of Moon (~+10), Seal of Sun (~+15,
  raríssimo). Equivalem a um item de nível bem mais alto.

**Para o Openrealm:**
🔧 **ADICIONAR.** Versão enxuta: equipamento por arma + alguns slots de armadura,
raridade branco/azul, e o "+N". Os selos dá pra simplificar pra 1–2 tiers raros.
É o que dá objetivo de longo prazo.

---

## 6. Alquimia (o grind de poder)  ← **FALTA no nosso GDD — é o coração viciante**
Duas camadas:
- **Elixir Alchemy (sobe o "+"):** Elixir do tipo certo (Arma / Proteção /
  Escudo / Acessório) + **Lucky Powder**. Pode **falhar**: zera o "+" ou quebra o
  item. Atenuantes: **Lucky** (+ chance), **Immortal** (não quebra), **Astral**
  (não cai abaixo de +4). Risco sobe muito depois de +3.
- **Magic Stone Alchemy (sobe atributos):** quebrar monstros → elementos →
  combinar com tablets → **stones**. Cada stone melhora **um atributo** num valor
  **aleatório** (pode até reduzir num sucesso). Camada profunda de min-maxing.

**Para o Openrealm:**
🔧 **ADICIONAR (prioridade).** Começar só com a Elixir Alchemy (o "+N" com chance
de falha) — é simples de programar e já entrega o loop de "arrisco subir meu
gear?". As stones de atributo entram numa fase posterior. Esse é provavelmente
o sistema com maior retorno de diversão por esforço.

---

## 7. Monstros  ← **FALTA no nosso GDD**
- **Tipos:** normal, **champion**, **elite**, **giant** (gigantes), e **party
  monsters** (precisam de grupo, marcados "(Party)").
- **Uniques (bosses de mundo):** nascem em horários/locais, **anúncio pro
  servidor todo**, invocam **ondas de minions** ao perder vida (em ~80%/60%/20%),
  dropam loot/gold bom. **Crédito de kill = quem causou mais dano** (party primeiro).
  Ex.: Tiger Girl (lvl 20), Captain Ivy (30), Uruchi (40)… cada um com tema e
  status próprios.

**Para o Openrealm:**
🔧 **ADICIONAR.** Os tipos (normal/champion/elite) viram variações de dificuldade
fáceis de fazer. Os **uniques** são perfeitos pro co-op de 2: bosses raros de
zona que valem a pena enfrentar juntos. "Party monsters" só fazem sentido com a
mecânica de party (que vocês terão).

---

## 8. Mundo & zonas
- Regiões em progressão de nível (China → Ásia Central → Europa), com **cidades**
  (vendedores, armazém, teleporte) e **pontos de farm** entre elas.

**Para o Openrealm:**
🔧 Já está na lista de "em aberto" do GDD. Começar com **1 zona + 1 cidade-hub**,
expandir depois.

---

## 9. Economia & Job System (o "coração" social do Silkroad)
- **Conflito Triangular: Trader, Hunter, Thief.** Trader transporta mercadorias
  entre cidades em montaria lenta (camelo) pra lucrar; **Thief** mata o transporte
  e rouba; **Hunter** protege o trader e caça thieves. Cada um tem **job level** e
  **job rank** (sobe matando o job oposto).
- **PvP de rota:** thief e hunter podem se atacar livremente.

**Para o Openrealm:**
❌ **CORTAR.** É o que define o Silkroad, mas exige **muitos jogadores** (traders,
ladrões, caçadores se cruzando no mundo). Com 2 pessoas, não existe. Fica como
"sonho distante se um dia o jogo tiver centenas de jogadores".

---

## 10. Grupos, guildas & unions
- **Party** (XP compartilhado), **guildas** (armazém, organização) e **unions**
  (alianças de guildas pra PvP grande).

**Para o Openrealm:**
✅ **Party** — sim (é o co-op de vocês; XP/loot compartilhado).
❌ Guildas/unions — escala MMO; cortar.

---

## 11. Fortress War
- Cerco **semanal** de guildas/unions a uma fortaleza (destruir portões → torres →
  "heart"); o vencedor **controla a taxa de comércio** da região por uma semana.
  Evento de ~2h que exige 40+ pessoas coordenadas.

**Para o Openrealm:**
❌ **CORTAR.** Puramente MMO de larga escala.

---

## 12. PvP
- Sem PvP dentro das cidades; PvP fora dos portões; zonas always-PvP; **duelos**
  1v1; guild wars; sistema de PK.

**Para o Openrealm:**
⏸️/❌ Já fora de escopo no GDD. Um **duelo 1v1** simples entre Gabriel e Kevin é a
única peça que talvez valha, lá na frente.

---

## 13. Pets
- **Grab pet** (pega o loot do chão automaticamente), **transport pet** (armazém
  extra ambulante) e pets de ataque/crescimento.

**Para o Openrealm:**
⏸️ **Depois.** O **grab pet** (auto-loot) é uma qualidade de vida gostosa pro
grind, mas não é essencial no começo.

---

## 14. Consumíveis & conveniência
- **Poções de HP/MP** e pílulas de status — centrais à sobrevivência ("auto
  potion" automatiza). **Return scrolls** (voltar pra cidade). **Stalls** (lojinha
  pessoal pra vender a outros jogadores). **Item Mall / Silk** (moeda paga).

**Para o Openrealm:**
✅ Poções de HP/MP + cura de status — já é a base de sobrevivência do GDD.
🔧 Return scroll / auto-potion — QoL simples, vale.
⏸️ Stalls — com 2 jogadores, **trade direto** já resolve.
❌ Item Mall / Silk — monetização; nosso projeto é open-source e grátis.

---

## 15. Quests
- Existem, mas o Silkroad é **grind-cêntrico**; quests são secundárias (algumas
  destravam bosses/áreas).

**Para o Openrealm:**
🔧 **Opcional.** Grind é o foco (já decidido). Algumas quests como bônus/sabor.

---

## 16. Penalidade de morte
- Morrer **gasta durabilidade** do equipamento e consome poções; reviver no
  cemitério.

**Para o Openrealm:**
🔧 Já está "em aberto" no GDD. Proposta leve: revive no cemitério, durabilidade
cai um pouco.

---

## Resumo: o que falta vs o que cortar

**Adicionar ao nosso GDD (PvE/itens — alto valor, escala 2 jogadores):**
1. 🔧 Equipamento: graus, raridade branco/azul, "+N". (§5)
2. 🔧 Alquimia: o "+N" com chance de falha (Elixir), depois stones. (§6) — **prioridade**
3. 🔧 Monstros: tipos (normal/champion/elite) + **bosses unique** de zona. (§7)
4. 🔧 Status effects no combate (stun/slow/DoT). (§4)
5. 🔧 Party com XP/loot compartilhado. (§10)
6. 🔧 Mundo: 1 zona + hub pra começar. (§8)

**Cortar (escala MMO, não faz sentido com 2 jogadores):**
- ❌ Job System (Trader/Hunter/Thief) e economia de rotas. (§9)
- ❌ Guildas/unions e Fortress War. (§11)
- ❌ Item Mall / moeda paga. (§14)

**Deixar pra depois:**
- ⏸️ "Gap" SP-farming, berserk, pets (auto-loot), stalls, duelo 1v1, quests.
