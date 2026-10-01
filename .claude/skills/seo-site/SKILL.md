---
name: seo-site
description: SEO local e técnico do site público matheusmachadoimoveis.com.br (Next.js): metadados, canonical, JSON-LD (RealEstateAgent/LocalBusiness/FAQPage), sitemap, robots, páginas por intenção (primeiro imóvel, MCMV, financiamento Caixa), Core Web Vitals, Search Console/Analytics. Audita e IMPLEMENTA no código quando o dono pede. Use para "melhore meu SEO", "meu site aparece no Google?", "implemente as melhorias do site".
---

# SEO do site (auditar e implementar)

Agente: `marketing-posicionamento`. Antes de editar: ler `CLAUDE.md`, `AGENTS.md`, `.claude/rules/frontend-pwa.md` e `workflow-dev.md`. Rotas públicas: `app/page.jsx`, `app/empreendimentos`, `app/simulacao`, `app/captacao`, `app/venda-seu-imovel`, `app/politica-de-privacidade`. **Nunca** indexar `/admin`, `/minha-jornada/*`, `/dev`.

## Auditar (evidência = URL + trecho do HTML ou arquivo:linha)
1. Rastreamento: `/robots.txt`, `/sitemap.xml` (existem? incluem só páginas públicas? imóveis/empreendimentos novos entram?), `noindex` indevido, canonical (`www` vs. sem `www`), redirecionamentos.
2. Por página pública: `<title>` único e com intenção + "Marília", meta description, H1 único, Open Graph, texto que responde a busca (não só formulário), links internos, `alt` das imagens.
3. Schema JSON-LD: `RealEstateAgent` (ou `LocalBusiness`) com nome, CRECI, endereço/área de atuação, telefone, `sameAs` (Instagram, Facebook, GMN), `areaServed` Marília; `FAQPage` só onde há FAQ visível; `Residence`/`Offer` para imóveis só com dado real. Validar a sintaxe; não inventar propriedade que a página não mostra.
4. Páginas por intenção que **não existem** e que o público de primeiro imóvel pesquisa (ex.: "Minha Casa Minha Vida em Marília", "como financiar o primeiro imóvel na Caixa", "documentos para financiamento", "imóveis na planta em Marília"). Só proponha com evidência de demanda (consulta-alvo, Search Console, perguntas reais do atendimento em `docs/GUIA_ATENDIMENTO.md`).
5. Desempenho/mobile: PageSpeed Insights via `WebFetch` (API pública) quando acessível; senão `[A CONFIRMAR]`. Imagens pesadas, scripts de terceiros.
6. Search Console/Analytics: verificar se há tag/propriedade (HTML) e pedir ao dono export/print de Consultas e Páginas (90 dias). Sem acesso → não estime cliques.
7. Rastreabilidade de leads orgânicos: UTMs/`source_metadata` chegam ao CRM? (`docs/TRAFEGO_META.md`). Lacuna de captura → descrever e acionar `crm-editor`.

## Implementar (só quando o dono pedir; local, reversível)
- Menor mudança que resolve: `metadata`/`generateMetadata` por rota, `app/robots.js`, `app/sitemap.js`, componente de JSON-LD, páginas novas de conteúdo (texto útil e verificável, com fonte e data para regras de MCMV/Caixa; **sem prometer aprovação de crédito**, CRECI visível).
- Respeitar: nenhuma remoção de funcionalidade, nenhuma mudança em rotas/URLs publicadas (`?c=`, `?ref=`, `/minha-jornada/<token>`), Pixel/CAPI intactos.
- Validar: `pnpm build` (se só `public/sw.js` mudou de hash, `git checkout -- public/sw.js`); conferir HTML gerado (`next dev` na porta 3020 ou build) para título/JSON-LD/robots/sitemap.
- Registrar em `docs/CHANGELOG_AI.md`; **publicar (push) só com pedido explícito**, e depois: reenviar sitemap no Search Console (tarefa do dono, 2 min — instrua).
- Medir: baseline no `HISTORICO.md` antes; reavaliar em 14 e 45 dias (páginas indexadas, impressões, cliques, posição nas consultas-alvo).

## Dados reais primeiro (Windsor)
Fonte 1: **Search Console** (consultas/páginas: cliques, impressões, CTR, posição; consultas com "marília", "primeiro imóvel", "minha casa minha vida", "caixa", marca) e **GA4** (sessões e leads por origem/página de entrada) via Windsor — o "valor inicial" dos indicadores do BACKLOG vem daqui. Se ausentes, o item 1 do BACKLOG é conectar a fonte; não estimar cliques/posição.
