#!/bin/sh
# Ignored Build Step da Vercel (vercel.json → ignoreCommand). Saída 0 = pula o deploy; 1 = publica.
# Pula só quando NADA fora de docs/.claude/tests/whatsapp-individual-service/desktop-app/scratch/*.md mudou desde o último deploy
# (2026-10-11: 22 deploys de documentação em 1 h faziam o app instalado recarregar).
# A Vercel clona só os últimos 10 commits: se o último commit publicado ficou fora da cópia (10+ commits só de docs),
# o git diff dava erro e a Vercel marcava "Deployment has failed" (2026-10-12). Sem como comparar → publica.
PREV="${VERCEL_GIT_PREVIOUS_SHA:-HEAD^}"
# "Redeploy" manual do mesmo commit (ex.: depois de cadastrar variável de ambiente) sempre publica (2026-10-23).
if [ "$(git rev-parse "$PREV" 2>/dev/null)" = "$(git rev-parse HEAD)" ]; then
  echo "Redeploy do mesmo commit: publicando."
  exit 1
fi
if git cat-file -e "$PREV^{commit}" 2>/dev/null \
  && git diff --quiet "$PREV" HEAD -- . ":(exclude)docs" ":(exclude).claude" ":(exclude)tests" \
    ":(exclude)whatsapp-individual-service" ":(exclude)desktop-app" ":(exclude)scratch" ":(exclude)*.md"; then
  echo "Só documentação/ferramentas mudou desde $PREV: deploy ignorado."
  exit 0
fi
echo "Publicando (código mudou ou não foi possível comparar com $PREV)."
exit 1
