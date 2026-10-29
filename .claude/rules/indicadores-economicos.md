---
paths:
  - "lib/economic-indicators*"
  - "app/admin/indicadores-economicos/**"
  - "app/api/admin/economic-indicators/**"
  - "app/api/cron/economic-indicators/**"
  - "components/economic/**"
  - "tests/economic-indicators*"
  - "tests/fixtures/economic/**"
  - "supabase/migrations/*economic_indicators*"
---
# Indicadores Econômicos (ECON-1)

**[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-29]** Aba para todos os perfis com dados oficiais (BCB, IBGE, FGV via BCB), calculadora de correção, alertas e o card "Radar Econômico". Detalhe: `docs/BUSINESS_RULES.md` ECON-1.

- Catálogo único `ECON_INDICATORS` (`lib/economic-indicators-core.mjs`); indicador novo só com código/endpoint confirmado por requisição real e fixture gravada em `tests/fixtures/economic/`. Nunca inventar, interpolar nem simular dado diário de série mensal.
- A tela e o Radar só leem o banco; rede só no cron `/api/cron/economic-indicators`. Falha preserva o último valor válido e aparece na tela (nunca esconda).
- Taxas por banco = média de mercado do BCB; a tela sempre diz que não é a taxa oferecida ao cliente.
- Textos de "O que mudou"/impacto são determinísticos, só com números; nunca causalidade ou previsão.
- Alertas só pela Central de Alertas existente (`createAlertDeliveries`), Informativo, sem push, chave `econ:<indicador>:<referência>`. Não crie outro canal.
- Radar: seta neutra (sem verde/vermelho); não altere a lógica dos cards Campeão da Semana/Melhor do Dia (`components/TopRankingBadge.jsx`).
- Migration `20261029120000_economic_indicators.sql` criada e **pendente de aplicação** pelo dono.
