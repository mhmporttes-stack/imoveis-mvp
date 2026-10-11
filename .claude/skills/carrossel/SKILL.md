---
name: carrossel
description: "Cria carrossel/post do Instagram de Matheus a partir de referências (prints/fotos de posts que ele gostou): recria a ESTRUTURA com o padrão dele (fundo preto, minimalista, azul da marca, foto + @mhm.machado no rodapé) e entrega PNG 1080x1350 + legenda. Use para \"cria um carrossel\", \"recria esse post\". Não publica."
---

# Carrossel do Instagram a partir de referência

Agente: `marketing-posicionamento` (conteúdo orgânico). Nada é publicado: entrega arquivos para o dono postar.

## Padrão visual (pedido do dono, 2026-10-11)
- Fundo **preto**, minimalista, muito respiro; texto branco; destaque em **azul da marca** (`**palavra**` no roteiro).
- Rodapé em toda lâmina: **foto do Matheus em círculo** + "Matheus Machado" + **@mhm.machado** (o @ real; `@matheusmachadoimoveis` não existe).
- Marca: só o símbolo oficial `public/assets/matheus-machado-symbol.png` (regra 10 do CLAUDE.md — nunca logo antiga nem logo nova inventada).
- Formato 1080×1350 (4:5). Capa com gancho forte; 1 ideia por lâmina; última lâmina = chamada para ação.

## Fluxo
1. **Ler a referência** (imagens enviadas): número de lâminas, gancho da capa, ritmo (texto/lista/citação/número), hierarquia, tamanho de texto, CTA. Descrever em 3–5 linhas o que será reaproveitado.
2. **Recriar, não copiar**: reaproveita a estrutura e o estilo da ideia; o texto é reescrito para o público do Matheus (primeiro imóvel, MCMV, Marília/SP). Nunca copiar frase, foto, marca ou @ de terceiros.
3. **Conformidade**: sem prometer aprovação, valor de subsídio ou taxa sem fonte/data; regra de MCMV citada com fonte; CRECI quando houver oferta (`/criar-anuncio` → `conformidade-imobiliaria.md`).
4. **Roteiro JSON** (tipos: `capa`, `texto`, `lista`, `citacao`, `cta` — ver cabeçalho do gerador) em `docs/posicionamento/carrosseis/<AAAA-MM-DD>-<tema>/roteiro.json`.
5. **Gerar**: `NODE_PATH=/opt/node22/lib/node_modules node .claude/design/tools/renderizar-carrossel.mjs <roteiro.json> --saida docs/posicionamento/carrosseis/<pasta>` (na máquina do dono: Playwright com Chromium instalado).
6. **Conferir cada PNG com Read** (texto cortado, sobra de espaço, contraste) antes de entregar; ajustar e gerar de novo.
7. **Entregar**: as lâminas (SendUserFile) + legenda pronta (gancho, 3–5 linhas de valor, CTA para a simulação/link na bio, 3–5 hashtags locais) + sugestão de horário.

## Foto do Matheus
Arquivo: `docs/posicionamento/assets/matheus-perfil.jpg` (campo `"foto"` do roteiro). Sem a foto, o rodapé usa o símbolo "M" — peça a foto ao dono uma vez e salve nesse caminho.
