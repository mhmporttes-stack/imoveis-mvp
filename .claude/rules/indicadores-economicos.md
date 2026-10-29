---
paths:
  - "lib/economic-indicators*"
  - "app/admin/indicadores-economicos/**"
  - "app/api/admin/economic-indicators/**"
  - "app/api/cron/economic-indicators/**"
  - "components/economic/**"
  - "tests/economic-indicators*"
  - "tests/economic-radar*"
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
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-29]** Setas de IPCA e INCC (Radar e aba): queda = verde (`text-success`), alta = vermelha (`text-danger`, "quer dizer que o juro/inflação subiu"), estável = neutra; ícone + aria-label sempre. Demais indicadores: seta neutra. Regra única `directionTone` (`lib/economic-indicators-core.mjs`). Não altere a lógica dos cards Campeão da Semana/Melhor do Dia (`components/TopRankingBadge.jsx`).
- **[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-29] Tira do Radar (ECON-2).** Mini-cards com seta e minigráfico real de 6 meses: Selic, Caixa + média dos bancos (modalidade padrão do comparativo, `RADAR_BANK_MODALITY_PATTERN`), TR, INCC-DI (mês + 12 m), IPCA, renda real OU desemprego (o mais recente) e MCMV **só se cadastrado** pelo admin geral (`crm_settings` `econ_radar_mcmv`, sempre com portaria e data; nada calculado). Tocar abre o detalhe (12 meses + fonte + data da divulgação). Selo "mudou hoje" = `releasedToday` (mesma lógica dos alertas: 1ª coleta não conta, Selic só quando o valor muda). "Como isso afeta a parcela" = `buildInstallmentMessage` (só números mostrados, sem promessa, assinatura "Matheus Machado Corretor de Imóveis" opcional). Fundo: linha real do INCC/Selic, só `transform`, parado com movimento reduzido/aba oculta. Uma rota só (`/radar`), cache 30 s (`CACHE_TAGS.ECON_RADAR`, invalidado pela coleta e pelo cadastro do MCMV) — não crie outra consulta por tela. `items` (IPCA/INCC) mantido. Detalhe: `docs/BUSINESS_RULES.md` ECON-2.
- Migration `20261029120000_economic_indicators.sql` criada e **pendente de aplicação** pelo dono.
