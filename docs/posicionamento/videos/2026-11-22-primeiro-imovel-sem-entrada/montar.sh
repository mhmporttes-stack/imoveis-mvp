#!/usr/bin/env bash
# Monta o vídeo "Primeiro imóvel em Marília sem entrada" (37,6 s, 1080x1920) com efeitos sonoros. Sem narração (o dono grava depois).
# Requer: python3 (numpy), node + playwright (Chromium), ffmpeg. Em container sem NODE_PATH: export NODE_PATH=$(npm root -g)
# Cenário de números: padrão 1800 (renda R$ 1.800); para renda R$ 2.000: CENARIO=2000 ./montar.sh
set -euo pipefail
cd "$(dirname "$0")"
cp ../../../../public/assets/matheus-machado-symbol.png symbol.png            # marca d'água "M" oficial
CHECK=1 node render_frames.cjs video.html frames 30                           # 1) confere sobreposições (texto × texto × rostos × corpos)
node render_frames.cjs video.html frames 30                                   # 2) quadros + frames/events.json (efeitos)
python3 sfx.py frames/events.json sfx.wav                                     # efeitos sintetizados, sincronizados pelos eventos
ffmpeg -v error -y -framerate 30 -i frames/f%04d.jpg -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -movflags +faststart video_mudo.mp4
ffmpeg -v error -y -i video_mudo.mp4 -i sfx.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest \
  -metadata title="RASCUNHO - Primeiro imóvel em Marília sem entrada" -metadata artist="Matheus Machado Corretor de Imóveis" \
  -metadata copyright="Matheus Machado Corretor de Imóveis" rascunho-v1.mp4
ffmpeg -v error -y -ss 2.9 -i rascunho-v1.mp4 -frames:v 1 capa.png                         # capa (gancho)
