---
name: carrossel
description: "Cria carrossel/post do Instagram de Matheus a partir de referências (prints/fotos de posts que ele gostou): recria a ESTRUTURA com o padrão dele (fundo preto, minimalista, azul da marca, foto + @mhm.machado no rodapé) e entrega PNG 1080x1350 + legenda. Use para \"cria um carrossel\", \"recria esse post\". Não publica."
---

# Carrossel do Instagram a partir de referência

Agente: `marketing-posicionamento` (conteúdo orgânico). Nada é publicado: entrega arquivos para o dono postar.

## Padrão visual (pedido do dono, 2026-10-11)
- **Fundo segue a referência** (regra do dono, 2026-10-11): referência de **cor única** → fundo **preto** (padrão). Referência com **foto/imagem de fundo** → recriar também com imagem (`"imagem"` na lâmina; o gerador escurece a parte de baixo para o texto). Imagem: fotos enviadas pelo dono, fotos de empreendimentos do projeto ou imagem gerada (Canva `generate-image`, sem pessoas reais nem marcas de terceiros) — nunca a foto da referência.
- Minimalista, muito respiro; texto branco; destaque em **azul da marca** (`**palavra**` no roteiro).
- Rodapé em toda lâmina no estilo do topo do perfil do Instagram: **foto em círculo com anel colorido** + **mhm.machado** com selo de verificado + "Corretor de Imóveis" — rodapé pequeno e discreto (pedido do dono, 2026-10-11) (o @ real; `@matheusmachadoimoveis` não existe).
- Sem logo e sem numeração ("1/4") no topo (pedido do dono, 2026-10-11): a identidade é o rodapé. Se algum dia usar marca, só o símbolo oficial `public/assets/matheus-machado-symbol.png` (regra 10 do CLAUDE.md).
- Formato 1080×1350 (4:5). Capa com gancho forte; 1 ideia por lâmina; última lâmina = chamada para ação.

## Estilo do dono
Leia `docs/posicionamento/ESTILO-CARROSSEL.md` (modelos que ele já postou, tipos de lâmina, ícones, linguagem). Posts antigos eram amarelos → hoje sempre azul.

## Fluxo
1. **Ler a referência** (imagens enviadas): número de lâminas, gancho da capa, ritmo (texto/lista/citação/número), hierarquia, tamanho de texto, CTA. Descrever em 3–5 linhas o que será reaproveitado.
2. **Recriar, não copiar**: reaproveita a estrutura e o estilo da ideia; o texto é reescrito para o público do Matheus (primeiro imóvel, MCMV, Marília/SP). Nunca copiar frase, foto, marca ou @ de terceiros.
3. **Conformidade**: sem prometer aprovação, valor de subsídio ou taxa sem fonte/data; regra de MCMV citada com fonte; CRECI quando houver oferta (`/criar-anuncio` → `conformidade-imobiliaria.md`).
4. **Roteiro JSON** (tipos: `capa`, `texto`, `lista`, `citacao`, `cta` — ver cabeçalho do gerador) em `docs/posicionamento/carrosseis/<AAAA-MM-DD>-<tema>/roteiro.json`.
5. **Gerar**: `NODE_USE_ENV_PROXY=1 NODE_EXTRA_CA_CERTS=/root/.ccr/ca-bundle.crt NODE_PATH=/opt/node22/lib/node_modules node .claude/design/tools/renderizar-carrossel.mjs <roteiro.json> --saida docs/posicionamento/carrosseis/<pasta>` (na máquina do dono: Playwright com Chromium instalado).
6. **Conferir cada PNG com Read** (texto cortado, sobra de espaço, contraste) antes de entregar; ajustar e gerar de novo.
7. **Entregar**: as lâminas (SendUserFile) + legenda pronta (gancho, 3–5 linhas de valor, CTA para a simulação/link na bio, 3–5 hashtags locais) + sugestão de horário.

## Foto do Matheus
Arquivo padrão: `docs/posicionamento/assets/matheus-perfil.png` (foto oficial enviada pelo dono em 2026-10-11; recorte do rosto por `fotoZoom`/`fotoPosicao`). Sem o arquivo, o rodapé usa o símbolo "M" — peça a foto ao dono.
Foto **sem fundo** (recorte, enviada e autorizada pelo dono em 2026-10-11): `docs/posicionamento/assets/matheus-recorte.png`. Use quando a referência tiver a pessoa na lâmina (capa com o autor, CTA "fale comigo"): `"comFoto": true` na lâmina — ele entra à direita, por trás do texto, e o texto ocupa ~60% da largura. Só quando fizer sentido, não em todas as lâminas.
Foto **apontando** (sem fundo, 2026-10-11): `docs/posicionamento/assets/matheus-apontando.png` — `"comFoto": "apontando"`; ele fica à direita apontando para o texto (bom para capa de guia, "o mais importante", CTA).

## Imagens geradas no Canva sem trabalho manual (2026-10-11)
O `generate-image` só devolve miniatura. Para baixar em tamanho cheio, automaticamente:
1. `generate-image` (PORTRAIT_4_5, "top 40-45% vazio") → `media_id` de cada imagem.
2. Um design auxiliar 1080×1350: `generate-design` (instagram_post, `asset_ids` = 1ª imagem) → `create-design-from-candidate`; `read-design` com `open_transaction`; `edit-design`: apagar todos os elementos do modelo, `insert_fill` da imagem em top 0/left 0/1089×1350, `add_page` (fundo #000) para as demais e `insert_fill` em cada; `commit`.
3. `export-design` PNG 1080×1350 → URLs públicas temporárias → `curl` para `carrosseis/<pasta>/img/`.
Pedir textos da imagem em português e conferir cada PNG (IA às vezes escreve em inglês).
