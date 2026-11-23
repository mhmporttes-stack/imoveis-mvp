#!/usr/bin/env bash
# Cria a pasta de um novo vídeo informativo a partir do modelo vivo (sem os resultados antigos).
# Uso: bash docs/posicionamento/videos/novo-video-informativo.sh <slug>      ex.: 5-erros-do-financiamento
set -euo pipefail
cd "$(dirname "$0")"
SLUG="${1:?uso: novo-video-informativo.sh <slug>}"
MODELO="2026-11-22-primeiro-imovel-sem-entrada"
DEST="$(date +%F)-$SLUG"
[ -e "$DEST" ] && { echo "já existe: $DEST"; exit 1; }
mkdir -p "$DEST/fonts"
cp "$MODELO"/{video.html,personagens.js,sfx.py,render_frames.cjs,montar.sh,shot.cjs,.gitignore} "$DEST/"
cp "$MODELO"/fonts/montserrat-latin.woff2 "$DEST/fonts/"
cat > "$DEST/LEIAME.md" <<EOT
# $SLUG — vídeo informativo (RASCUNHO)
Criado a partir de \`$MODELO\`. Edite \`video.html\` (SC, CAP, EVENTS, NUMS, cartões) e rode \`./montar.sh\`.
Regras: ver \`.claude/agents/animador-informativo.md\` e \`../PREFERENCIAS.md\`.
EOT
echo "ok: docs/posicionamento/videos/$DEST  (próximo: editar video.html e rodar ./montar.sh)"
