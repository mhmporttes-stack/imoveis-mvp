# Vídeo 1 — "Primeiro imóvel em Marília" (animação 2D, estilo fantoche) — RASCUNHO v1

**Status:** rascunho aguardando decisão do dono sobre os números (ver `roteiro.md` §1 e §3). Nada publicado. Narração: o dono grava depois (voz ainda indefinida).

## Arquivos
- `rascunho-v1.mp4` (37,6 s, com efeitos sonoros) e `capa.png`. Nome "rascunho" de propósito: não publicar com os números atuais.
- `roteiro.md` — números conferidos, cena a cena, locução, versão recomendada, legenda do post.
- `video.html` — o vídeo (linha do tempo em `render(t)`): `SC` (cenas), `CAP` (legenda), `EVENTS` (sons), `NUMS` (cenários de números: `1800` pedido; `2000` renda R$ 2.000).
- `personagens.js` (elenco articulado), `sfx.py` (efeitos sintetizados), `render_frames.cjs`, `montar.sh`, `fonts/`.

## Como refazer
`./montar.sh` (padrão) · `CENARIO=2000 ./montar.sh`. Requer python3 (numpy), node + playwright, ffmpeg (`export NODE_PATH=$(npm root -g)`). O `montar.sh` roda antes uma **checagem automática de sobreposição** (texto × texto × rostos × corpos × margens, a cada 0,05 s) e imprime `CHECK: nenhuma sobreposição`.

## Regras aplicadas (`../PREFERENCIAS.md`)
Legenda abaixo da linha do chão e acima da área do adesivo de link (x 80–560, y 1470–1590, livre); marca d'água "M" ~30% em posição diferente a cada cena; sem logo/nome da incorporadora no vídeo; vermelho só em palavra negativa; rodapé legal (análise de crédito, condições da construtora, imagens ilustrativas, CRECI); metadados de autoria no MP4.
Efeitos conferidos por espectrograma e níveis (pico −1,8 dB); ninguém ouviu — o dono julga.
