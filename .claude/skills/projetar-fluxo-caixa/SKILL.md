---
name: projetar-fluxo-caixa
description: Projeta o fluxo de caixa dos próximos meses com PREVISTO (recebimentos com data esperada + despesas recorrentes/agendadas) separado de ESTIMATIVA (histórico), calcula caixa projetado, cobertura e o mês em que a reserva fica abaixo do mínimo. Use para "como vai ficar meu caixa", "consigo pagar os próximos meses", "quanto tempo dura meu caixa". Somente leitura.
argument-hint: "[horizonte em meses: 3 (padrão) a 12]"
context: fork
agent: gestor-financeiro
---

# Projetar fluxo de caixa

Executa como `gestor-financeiro` (somente leitura). Argumentos: `$ARGUMENTS` (padrão 3 meses). Adaptado de `cash-flow-forecast` / `runway-calculator` (openaccountant).

1. **Ponto de partida:** caixa atual (aba Saúde / `financial_health_settings`). Sem saldo inicial configurado → pare nessa parte e diga como configurar; mostre só o fluxo líquido projetado.
2. **Prioridade 1 — contratual/operacional (PREVISTO):** recebimentos `expected/overdue` por `expected_date` (parte da imobiliária = recebimento × comissão da imobiliária ÷ comissão bruta, já descontados repasses); venda sem data prevista fica fora e vai para "sem data".
3. **Prioridade 2 — despesas conhecidas (PREVISTO):** recorrências ativas expandidas mês a mês + despesas agendadas.
4. **Prioridade 3 — histórico (ESTIMADO, rotulado):** média 3 meses de despesas variáveis; **não** projete receita nova por histórico a menos que o dono peça, e rotule como cenário.
5. **Saída:** tabela mês a mês: entradas previstas, saídas previstas, fluxo, caixa projetado, cobertura (meses) — e uma 2ª coluna "com estimativa". Runway = caixa ÷ custo operacional mensal. Aponte o 1º mês abaixo da reserva mínima.
Nunca apresente previsão como recebimento nem estimativa como previsão.
