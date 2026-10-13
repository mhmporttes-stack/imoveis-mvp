#!/bin/bash
# Cortes do material REAL da incorporadora (Drive do dono) → clipes 1080x1920 30fps em <saida>.
# uso: cortes.sh <pasta-drive2> <saida>
set -e; S="$1"; O="$2"; mkdir -p "$O"
DR="$S/ATUALIZAÇÕES OUTUBRO 2026"; RS="$S/VIDEOS REDES SOCIAIS"
EXP="$RS/EXPERIENCIA RECANTO VERDE 06.05.26.mp4"; SAIA="$RS/SAIA DO ALUGUEL CASA MODELO DECORADO .mp4"
V="scale=1080:1920:flags=lanczos,fps=30,format=yuv420p"
corte(){ ffmpeg -loglevel error -y -ss "$2" -t "$3" -i "$1" -vf "setpts=PTS/$4,crop='min(iw,ih*9/16)':ih,$V" -an -c:v libx264 -crf 14 -preset fast "$O/$5.mp4"; echo "$5 ok"; }
corte "$DR/DJI_0571.MP4" 6    20  5   c01-drone-cima        # de cima (casa com o satélite) → câmera inclina até o horizonte
corte "$DR/DJI_0580.MP4" 0    17  4   c02-drone-portaria    # desce até a frente do condomínio (gravado na vertical)
corte "$EXP"             10.5 2.5 1   c03-portaria          # fachada/portaria nº 205
corte "$DR/DJI_0580.MP4" 47.5 9.5 4   c04-drone-sobe        # sobe sobre os telhados
corte "$EXP"             51.0 1.6 1   c05-frente-casa
corte "$EXP"             1.0  2.6 1   c06-porta             # porta abrindo e entrando
corte "$SAIA"            39.5 4.1 1.3 c07-corredor-sala
corte "$SAIA"            21.0 2.0 1   c08-cozinha
corte "$SAIA"            30.0 1.9 1   c09-casal
corte "$SAIA"            35.6 3.2 1.5 c10-solteiro
