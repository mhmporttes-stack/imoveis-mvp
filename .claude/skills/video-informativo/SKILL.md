---
name: video-informativo
description: "Cria Reels INFORMATIVO animado (30–40 s, personagens 2D estilo fantoche, tipo 'N coisas…' / 'como comprar o 1º imóvel…') a partir de um assunto: estuda e valida os números no CRM, escreve roteiro com gancho e gatilhos, monta o vídeo com legenda, efeitos sonoros e rodapé legal, sem sobreposição. Use para '/video-informativo <tema>', 'cria um vídeo informativo', 'vídeo animado sobre financiamento/MCMV/subsídio'. Não publica; narração o dono grava depois."
---

# /video-informativo — Animador de Vídeos Informativos

Delegue ao agente **`animador-informativo`** (ou siga `.claude/agents/animador-informativo.md` na sessão principal quando o dono abrir um chat só de vídeos) com o pedido do dono na íntegra (tema, empreendimento/oferta, duração, CTA).

Ordem fixa, sem pedir autorização a cada passo:
1. Brief numa mensagem só (só o que faltar).
2. **Estudo + validação dos números** (motor do CRM + cadastro + fonte oficial) → tabela pedido × CRM. Divergência (ex.: "sem entrada" com entrada > 0, benefício que o empreendimento não aceita) = avisar e propor a versão honesta **antes** de gravar qualquer coisa.
3. Roteiro (gancho, gatilhos, cena a cena, locução, legenda do post) — o dono aprova **uma vez**.
4. `bash docs/posicionamento/videos/novo-video-informativo.sh <slug>` → editar `video.html` → `./montar.sh` (checagem automática de sobreposição) → MP4 `rascunho-vN` + capa.
5. Narração: voz sintética gratuita (`voz.py`, Kokoro `pm_alex`) já inclusa e verificada por transcrição; o dono pode trocar pela própria voz (`voz-dono/<id>.wav` por frase). Efeitos inclusos; música o dono põe no Instagram.

Regras que não mudam: nada publicado; sem promessa de crédito; sem logo/nome da incorporadora; adesivo de link livre (x 80–560, y 1470–1590); rodapé legal; vermelho só em palavra negativa; resposta curta (≤ 15 linhas) com SendUserFile do MP4. Ideias de tema em alta: `/viralizacao`.
