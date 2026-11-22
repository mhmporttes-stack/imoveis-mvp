#!/usr/bin/env bash
# Monta o vídeo de teste (8 s, 1080x1920, sem áudio).
# Requer: python3 (Pillow + numpy), node + playwright (Chromium), ffmpeg.
# Em container sem NODE_PATH: export NODE_PATH=$(npm root -g)
set -euo pipefail
cd "$(dirname "$0")"
python3 preparar_recortes.py img desespero explicando            # recortes da biblioteca realista do dono
cp ../../../../public/assets/matheus-machado-symbol.png symbol.png  # marca d'água "M" oficial
node render_frames.cjs cena.html frames 30 8                       # quadros (Chromium)
ffmpeg -v error -y -framerate 30 -i frames/f%04d.jpg -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -movflags +faststart \
  -metadata title="Teste de estilo - realista + 2D" -metadata artist="Matheus Machado Corretor de Imóveis" \
  -metadata copyright="Matheus Machado Corretor de Imóveis" teste-estilo.mp4
ffmpeg -v error -y -ss 7.6 -i teste-estilo.mp4 -frames:v 1 capa.png
