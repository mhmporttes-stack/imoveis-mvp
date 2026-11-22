# Matheus 2D — personagem para vídeos de animação explicativa

**Status:** proposta aguardando aprovação do dono (variante visual nova — regra 6 do `CLAUDE.md`). Nenhum vídeo foi criado.

**Origem:** estilo "explainer 2D" inspirado em vídeo de outro perfil (personagens vetoriais, legenda dinâmica, etiquetas numeradas). Personagens, proporções, paleta e tema são próprios — nada copiado.

**Base do desenho:** fotos reais do dono (`docs/posicionamento/assets/`): cabelo escuro com topete, barba cheia, sobrancelha grossa, terno azul-marinho + camisa preta + relógio.

## Arquivos
- `ficha-personagem.png` — ficha (expressões, poses, paleta).
- `svg/` — uma imagem por pose (`matheus-*.svg`) e por expressão (`rosto-*.svg`).
- `gerar_boneco.py` — o boneco é código: `boneco_svg(pose, expr)` devolve o SVG. Braços e cotovelos têm ângulos próprios (`POSES`), então a animação do vídeo interpola os ângulos entre quadros.
- `montar_ficha.py` + `render.js` — refazem a ficha e os SVGs (`python3 montar_ficha.py <pasta>`; render com o Chromium do Playwright).

## Poses e expressões
Poses: em-pe, apontando, joinha, explicando, comemorando, dica. Expressões: feliz, neutro, surpreso, preocupado, pensativo, bravo/reprovado.

## Regras de uso
- Fundo claro e paleta da marca (`ESTILO-CARROSSEL.md`); vermelho só em palavra negativa.
- Adesivo de link e marca d'água "M" seguem `../PREFERENCIAS.md`.
- Pendente: pose "pensando" (mão no queixo) — cotovelo ainda não ficou natural.
