# Teste — Matheus realista ARTICULADO (marionete 2D, 5 s)

**Status:** teste aguardando julgamento do dono. Não publicado. Texto da cena é de teste. Substitui o 1º teste (`../2026-11-22-teste-realista-2d/`, imagem parada).

**O que mudou:** a pose realista `explicando` (biblioteca do dono) foi cortada em peças que giram — o boneco levanta o braço de verdade.

## Como o boneco é montado (`build_rig.py`)
Peças (todas do tamanho da foto, RGBA): `tronco`, `cabeca`, `braco` (ombro→cotovelo), `antebraco` (cotovelo→mão).
- Pivôs em `camadas/pivos.json`: ombro (485,565), cotovelo (458,920), pescoço (640,452).
- Cada peça invade ~20 px a vizinha com borda suave e o tronco mantém esses pixels: em repouso a montagem é idêntica à foto e, ao girar, a emenda não aparece.
- Em `cena.html`: `#uG` (braço) contém `#fG` (antebraço+mão); `#headG` gira no pescoço. O contrato é solto (não gira com a mão) e segue a posição da palma.
- Movimento: curvas de keyframes `U_KF`/`F_KF` (graus, horário = positivo) + onda da mão + cabeça (inclina e "assente") + respiração/balanço do corpo.

## Arquivos
- `teste-boneco-articulado.mp4`, `capa.png` — entregáveis (sem áudio).
- `montar.sh` — refaz tudo (peças → quadros → MP4). Requer python3 (Pillow, numpy), node + playwright, ffmpeg.
- `build_rig.py` (cortes), `preview_rig.py` (prévia estática das peças), `cena.html`, `render_frames.cjs`, `fonts/`.

## Limites conhecidos
- Braço gira como peça rígida (cara de marionete — igual ao vídeo de referência). Limpo até ~25° no ombro e ~50° no cotovelo; acima disso aparecem emendas.
- Só esta pose tem braço livre o bastante para articular. Outras poses (apontando, comemorando) exigem corte próprio e preenchimento do tronco onde o braço cobre.
- Uma só cabeça por pose: sem troca de expressão dentro da pose (troca = trocar de pose/rig). Boca não sincroniza (decisão do dono).

## Regras aplicadas (`../PREFERENCIAS.md`)
Marca d'água "M" ~30% fora do texto; área do adesivo de link (x 80–560, y 1470–1590) livre; vermelho só em palavra negativa; metadados de autoria no MP4.
