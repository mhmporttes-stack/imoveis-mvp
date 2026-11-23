#!/usr/bin/env bash
# Monta o vídeo (1080x1920) COM VOZ e efeitos sonoros. Requer: python3 (numpy), node + playwright (Chromium), ffmpeg.
# Voz sintética gratuita (Kokoro, pt-BR): precisa de um python com kokoro-onnx + soundfile (VOZ_PY) e dos modelos (KOKORO_DIR, baixa sozinho).
#   python3 -m venv .venv && .venv/bin/pip install kokoro-onnx soundfile   ->   VOZ_PY=.venv/bin/python ./montar.sh
# Voz do dono: salve voz-dono/<id>.wav por frase (ids em locucao.json) — substitui a sintética daquela frase.
# Voz/velocidade: VOZ=pm_alex|pm_santa|pf_dora  VEL=1.18 ./montar.sh
set -euo pipefail
cd "$(dirname "$0")"
export NODE_PATH="${NODE_PATH:-$(npm root -g 2>/dev/null)}"
cp ../../../../public/assets/matheus-machado-symbol.png symbol.png            # marca d'água "M" oficial
${VOZ_PY:-python3} voz.py                                                     # locução por frase + timeline.js (anima no ritmo da fala)
CHECK=1 node render_frames.cjs video.html frames 30                           # confere sobreposições (texto × texto × rostos × corpos × margens)
node render_frames.cjs video.html frames 30                                   # quadros + frames/events.json (efeitos em tempo real)
python3 mix.py frames/events.json narracao.wav audio.wav                      # voz + efeitos (efeitos abaixam sob a voz)
ffmpeg -v error -y -framerate 30 -i frames/f%04d.jpg -c:v libx264 -preset slow -crf 21 -pix_fmt yuv420p -movflags +faststart video_mudo.mp4
ffmpeg -v error -y -i video_mudo.mp4 -i audio.wav -map 0:v -map 1:a -c:v copy -af "loudnorm=I=-16:TP=-1.5:LRA=11" -c:a aac -b:a 192k -shortest \
  -metadata title="RASCUNHO - Primeiro imóvel em Marília (com voz)" -metadata artist="Matheus Machado Corretor de Imóveis" \
  -metadata copyright="Matheus Machado Corretor de Imóveis" rascunho-v2.mp4
ffmpeg -v error -y -ss 3.0 -i rascunho-v2.mp4 -frames:v 1 capa.png            # capa (gancho)
