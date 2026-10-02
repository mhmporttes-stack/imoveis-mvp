---
name: analisar-saude-financeira
description: Diagnóstico da saúde financeira da imobiliária num período — receita recebida, despesas, lucro livre, margem, caixa, reserva/cobertura, ponto de equilíbrio e resultado por corretor, com apontamentos Fato/Apontamento/Recomendação. Use para "como está meu financeiro", "estou ganhando dinheiro?", "tenho reserva?", "quanto preciso vender para pagar as contas". Somente leitura.
argument-hint: "[período: mês | mês anterior | AAAA-MM | AAAA-MM-DD a AAAA-MM-DD] — vazio = mês atual"
context: fork
agent: gestor-financeiro
---

# Analisar saúde financeira

Executa como `gestor-financeiro` (somente leitura). Argumentos: `$ARGUMENTS` (vazio = mês atual até hoje; avise que é parcial). Definições: `docs/FINANCEIRO_SAUDE.md`.

1. **Período e premissas.** Datas `[início, fim]`; hoje em America/Sao_Paulo. Liste premissas pendentes que mexem em número (% de gestor).
2. **Receita (REALIZADO).** Classificação: comissão recebida − repasses − nota fiscal (% da própria venda, `financial_sales.invoice_percentage`) − despesas operacionais pagas = resultado líquido.  Recebimentos `status='received'` com `received_date` no período (consulta C-RECEBIDO do doc). Separe do **PREVISTO** (`expected/overdue` por `expected_date`) e destaque vencidos.
3. **Despesas.** Operacionais (`financial_operating_expenses`, expandindo recorrência — C-DESPESAS-OP) + custos da venda apropriados (repasses, despesas da venda, nota, comissões) proporcionais ao recebido. Mostre os dois blocos.
4. **Resultado:** lucro livre = receita bruta recebida − despesas; margem = lucro ÷ receita bruta. Compare com o período anterior (mês completo → mês anterior).
5. **Caixa e reserva.** Só se `financial_health_settings` tiver saldo inicial; senão diga "caixa não configurado" e **não estime**. Cobertura = caixa ÷ custo operacional mensal; classifique só pelos limiares configurados (reserva_months / critical_months).
6. **Ponto de equilíbrio:** despesas operacionais do período ÷ margem de contribuição (parte da imobiliária ÷ comissão bruta recebida, 6 meses). Mostre recebido e quanto falta.
7. **Por corretor:** resultado da imobiliária (parte da imobiliária nas comissões recebidas) — nunca VGV.
8. **Reconcilie** com a aba Saúde (mesmo período). Termine com 3 apontamentos Fato/Apontamento/Recomendação, no formato do agente.
