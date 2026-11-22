#!/usr/bin/env bash
# Monta o teste do boneco articulado (5 s, 1080x1920, sem áudio).
# Requer: python3 (Pillow, numpy), node + playwright (Chromium), ffmpeg.
# Em container sem NODE_PATH: export NODE_PATH=$(npm root -g)
set -euo pipefail
cd "$(dirname "$0")"
python3 build_rig.py ../../assets/boneco-3d/realista/explicando.png camadas   # corta a pose em peças (tronco, cabeça, braço, antebraço+mão)
cp ../../../../public/assets/matheus-machado-symbol.png symbol.png            # marca d'água "M" oficial
node render_frames.cjs cena.html frames 30 5                                  # quadros (Chromium)
ffmpeg -v error -y -framerate 30 -i frames/f%04d.jpg -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -movflags +faststart \
  -metadata title="Teste - boneco realista articulado" -metadata artist="Matheus Machado Corretor de Imóveis" \
  -metadata copyright="Matheus Machado Corretor de Imóveis" teste-boneco-articulado.mp4
ffmpeg -v error -y -ss 3.9 -i teste-boneco-articulado.mp4 -frames:v 1 capa.png
