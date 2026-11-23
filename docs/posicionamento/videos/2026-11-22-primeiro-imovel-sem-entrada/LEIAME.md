# Vídeo 1 — "Primeiro imóvel em Marília" (animação 2D, estilo fantoche, COM VOZ) — RASCUNHO v2

**Status:** rascunho (versão recomendada, números conferidos no CRM) aguardando o dono: ouvir a voz e confirmar Casa Paulista, desconto, IPTU. Nada publicado.

## Arquivos
- `rascunho-v2.mp4` (38,5 s, voz + efeitos) e `capa.png`; `roteiro.md` (números, locução, legenda do post).
- `locucao.json` — **fonte única do texto**: frases (fala + legenda + janela no roteiro), voz, velocidade, pausas. `voz.py` gera a locução (Kokoro, gratuito/local) e `timeline.js` (a animação acompanha a duração real de cada frase).
- `video.html` — o vídeo (`SC` cenas, `EV_SCRIPT` sons, `NUM` números, cartões); `personagens.js`, `sfx.py`, `mix.py` (voz + efeitos com ducking), `render_frames.cjs`, `montar.sh`.

## Como refazer
`VOZ_PY=.venv/bin/python ./montar.sh` (venv com `kokoro-onnx soundfile`; modelos baixam sozinhos em `~/.cache/kokoro` ou `KOKORO_DIR`). Faz, em ordem: voz → **checagem de sobreposição** → quadros → mixagem → MP4. Outra voz: `VOZ=pm_santa|pf_dora` (testadas: pronunciam "Marília" pior que `pm_alex`). Voz do dono: `voz-dono/<id>.wav` por frase.

## Regras aplicadas (`../PREFERENCIAS.md`)
Legenda abaixo do chão; adesivo de link (x 80–560, y 1470–1590) livre; marca d'água "M" em posição diferente por cena; sem logo/nome da incorporadora; vermelho só em palavra negativa; rodapé legal; metadados de autoria. Conferido por transcrição automática do áudio final (voz inteligível; fala × legenda com desvio médio de 0,13 s) — ninguém ouviu: o dono julga a voz e os efeitos.
