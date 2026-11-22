#!/usr/bin/env bash
# Monta o TESTE de movimento (4,8 s, 1080x1920, com efeitos sonoros) e a ficha dos personagens.
# Requer: python3 (numpy), node + playwright (Chromium), ffmpeg. Em container sem NODE_PATH: export NODE_PATH=$(npm root -g)
set -euo pipefail
cd "$(dirname "$0")"
cp ../../../../public/assets/matheus-machado-symbol.png symbol.png            # marca d'água "M" oficial
node render_frames.cjs teste-movimento.html frames 30                         # quadros + frames/events.json (efeitos)
python3 sfx.py frames/events.json sfx.wav                                     # efeitos sintetizados, sincronizados pelos eventos
ffmpeg -v error -y -framerate 30 -i frames/f%04d.jpg -c:v libx264 -preset slow -crf 16 -pix_fmt yuv420p -movflags +faststart video_mudo.mp4
ffmpeg -v error -y -i video_mudo.mp4 -i sfx.wav -map 0:v -map 1:a -c:v copy -c:a aac -b:a 192k -shortest \
  -metadata title="Teste - boneco 2D com efeitos sonoros" -metadata artist="Matheus Machado Corretor de Imóveis" \
  -metadata copyright="Matheus Machado Corretor de Imóveis" teste-movimento.mp4
node shot.cjs ficha.html ficha-personagens.png 2000 1400 1                    # ficha (elenco, expressões, poses)
