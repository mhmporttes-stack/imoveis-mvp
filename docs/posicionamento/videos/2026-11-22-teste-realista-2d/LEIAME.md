# Teste de estilo — Matheus realista + gráficos 2D (8 s)

**Status:** teste aguardando julgamento do dono. Não publicado. Texto da cena é de teste.

**Estilo:** animação explicativa vertical (1080×1920), inspirada em vídeo de outro perfil — personagens, paleta e tema são próprios. Matheus = recortes realistas da biblioteca do dono (`../../assets/boneco-3d/realista-hd`), fundo claro com raios azuis, gráficos 2D animados, legenda em frases, painel azul-marinho embaixo.

**Cena:** "Erro 1 · Contrato" (pose `desespero`, selo vermelho "!") → troca de pose → "O certo" (pose `explicando`, lupa lendo o contrato, selo azul de visto).

## Arquivos
- `teste-estilo.mp4`, `capa.png` — entregáveis (sem áudio).
- `cena.html` — a cena (linha do tempo em JS, função `render(t)`); textos em `CHUNKS`, poses em `img/`.
- `montar.sh` — refaz tudo (recortes → quadros → MP4). Requer python3 (Pillow, numpy), node + playwright, ffmpeg.
- `preparar_recortes.py`, `render_frames.cjs`, `fonts/` (Montserrat, OFL).

## Regras aplicadas (`../PREFERENCIAS.md`)
- Marca d'água "M" ~30%, um canto por cena (cena 1: topo direito; cena 2: topo esquerdo), fora do texto.
- Área do adesivo de link (x 80–560, y 1470–1590) fica livre.
- Vermelho só em palavra negativa ("sem ler"); realce positivo em azul.
- Metadados de autoria no MP4.

## Para o vídeo completo (pendente de decisão do dono)
Narração (voz do dono × sintética), tema/roteiro de 5 itens, chamada final (adesivo de link × palavra nos comentários), poses extras da biblioteca por item.
