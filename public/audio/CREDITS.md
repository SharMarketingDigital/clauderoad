# Música de fundo — créditos e licenças

As faixas tocadas no jogo são servidas de `public/audio/`. Foram curadas do pack
"Hub (todas as faixas CC0)" (origem: OpenGameArt). A atribuição abaixo cobre tanto
**CC0** quanto **CC-BY** (o GDD v0.4 §1.4 aceita CC-BY desde que com créditos), então
estamos seguros independente da licença exata de cada faixa.

| Arquivo | Papel no jogo | Autor (provável) | Fonte | Licença |
|---|---|---|---|---|
| `the_field_of_dreams.mp3` | Exploração (loop, default) | — *(verificar no OGA)* | OpenGameArt | CC0 ou CC-BY — **VERIFICAR** |
| `TownTheme.mp3` | Cidade / safe-zone | cynicmusic *(provável)* | OpenGameArt | CC0 ou CC-BY — **VERIFICAR** |
| `battleThemeA.mp3` | Combate / boss | cynicmusic *(provável)* | OpenGameArt | CC0 ou CC-BY — **VERIFICAR** |

## ⚠️ A confirmar antes de publicar

O pack original **não trazia `License.txt`** — a afirmação "CC0" vinha só do nome da
pasta. As atribuições acima são o melhor palpite pela origem conhecida no OpenGameArt
(`TownTheme`/`battleThemeA` são clássicos do **cynicmusic**, comumente **CC-BY 3.0**, que
exige crédito — não necessariamente CC0).

Antes de publicar o jogo, confirmar na página de origem do OpenGameArt de cada faixa:
1. o **autor** exato;
2. a **licença** exata (CC0 vs CC-BY);
3. se for **CC-BY**, manter o crédito ao autor visível (esta tabela já cumpre isso).

> Nota: as 2 faixas que originalmente queríamos (`determined_pursuit_loop` p/ exploração e
> `Epic Boss Battle` do Juhani Junkala p/ boss) só existiam em `.wav` grande (18/21 MB) e
> não havia `ffmpeg` no ambiente p/ converter em `.ogg`. Foram substituídas pelas mp3 acima
> (web-friendly). Se quisermos as originais depois, basta convertê-las p/ `.ogg` e trocar.
