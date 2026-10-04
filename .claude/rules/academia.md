---
paths:
  - "components/academia/**"
  - "app/academia/**"
  - "app/api/admin/academia/**"
  - "app/dev/vitrine/academia/**"
  - "lib/academy-*"
  - "tests/academy-*"
---

# Academia (formação dos corretores)

Referência: `docs/ACADEMIA.md` (estado, mapa de arquivos, limitações); plano e repasse de design em `docs/academia/`; detalhe e pendências em `docs/BUSINESS_RULES.md` grupo ACA-x. Chave de liberação: `ACADEMIA_ENABLED` (padrão desligada; só o nome da variável).

- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-04] Quem edita o conteúdo.** **Admin e Gerente (gestor)** podem criar e editar conteúdos da Academia; corretor e associado só estudam. Substitui a proposta anterior do plano ("só o admin geral"). Ainda não implementada (F3): toda rota de edição exige guard de gestão no servidor (`requireBrokerManagementApi` ou equivalente, a confirmar na F3); esconder o botão na UI nunca substitui a checagem. Quem **publica** e o fluxo de aprovação: **[PENDENTE DE VALIDAÇÃO]** (ACA-1).
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-04] Nota mínima dos quizzes: 70% (7,0).** Implementação: `settings.pass_score` (70) em `lib/academy-sample.mjs` (dados de exemplo); a aplicação real no servidor vem na F4. Tentativas e nota das provas de módulo/final: **[PENDENTE DE VALIDAÇÃO]** (ACA-2).
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-04] Identidade visual.** Fonte **Fraunces** (com Manrope), hospedada no app (`components/academia/fonts/`, `next/font/local`, sem Google Fonts em runtime), e a **metáfora do prédio com guindaste** (um andar aceso por aula; `components/academia/scene/**`). Não troque sem pedido do dono (ACA-3, ACA-4).
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-04] Orçamento de peso.** O teto de **150 KB (JS gz)** vale **somente para a parte própria da Academia** (hoje 21,5 KB), não para o peso base do site. Fontes de **≈92 KB** aprovadas. Medir em `.next/diagnostics/route-bundle-stats.json` (ACA-5, ACA-6).
- **[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO]** F0/F1: rota `/academia` atrás da chave; dados de exemplo em memória (`lib/academy-sample*.mjs`), sem banco, sem API e sem rede depois de carregar; zoom liberado só nesta rota. Acesso real a dados (F2+) só por `lib/`.
