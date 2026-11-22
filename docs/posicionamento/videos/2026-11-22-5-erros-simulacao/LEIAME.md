# "5 erros antes de simular o financiamento" — animação 2D (estilo fantoche)

**Status:** ficha dos personagens + teste de movimento (4,8 s, com efeitos sonoros) aguardando aprovação do dono. Vídeo completo ainda NÃO criado. Nada publicado. Textos do teste são placeholders.

**Estilo:** formato inspirado em vídeo de outro perfil ("N coisas": etiqueta numerada, uma piada visual por item, legenda grande). Personagens, roteiro, piadas e paleta são próprios — não é cópia 1:1.

## Arquivos
- `ficha-personagens.png` — elenco (corretor, cliente, cliente 2), 8 expressões, 8 poses.
- `teste-movimento.mp4` — pulo de entrada com pouso "esmagado", aceno, apontar, reação do cliente (surpresa → preocupação, balança a cabeça), balão "R$ ?", poeira de pouso.
- `personagens.js` — o boneco é código: `Rig.make("corretor").set({aD:[86,86], hD:"aberta", mouth:"grin", ...})`. Peças: cabeça, tronco, braços (ombro + cotovelo, mão com 4 formas), pernas, olhos (olhar/piscada), sobrancelhas, boca (7 formas).
- `teste-movimento.html` — cena de teste (linha do tempo em `render(t)`; `window.EVENTS` = lista de efeitos sonoros).
- `sfx.py` — efeitos sintetizados (tick, click, pop, boing, thud, whoosh, swipe, ding, buzz, sparkle), sem áudio de terceiros; mixados pela lista de eventos.
- `montar.sh` — refaz tudo. Requer python3 (numpy), node + playwright (Chromium), ffmpeg.

## Decisões / regras (ver `../PREFERENCIAS.md`)
- Boneco 2D desenhado, não precisa parecer com o dono; quanto mais movimento, melhor; boca sem sincronia (só expressões).
- Voz INDEFINIDA: manter duração por cena na linha do tempo para re-sincronizar quando a narração chegar; o áudio final = efeitos + narração (música o dono põe no Instagram).
- Efeitos: conferidos por espectrograma e níveis (pico −1,6 dB), mas ninguém ouviu — o dono julga.
- Marca d'água "M" ~30% fora do texto; área do adesivo de link (x 80–560, y 1470–1590) livre; vermelho só em palavra negativa; metadados de autoria no MP4.

## Próximos passos (após aprovação)
Roteiro dos 5 erros (dados com fonte oficial, sem prometer crédito) → cenas (banco com carinha, tabelas, medidores) → vídeo completo com efeitos → narração quando definida.
