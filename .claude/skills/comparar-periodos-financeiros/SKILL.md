---
name: comparar-periodos-financeiros
description: "Compara dois períodos financeiros (receita, despesas, lucro, caixa, por corretor), separando variação real de ruído. Use para \"setembro contra agosto\". Só leitura."
argument-hint: "[período A] vs [período B] — vazio = mês atual × mês anterior (mesmo nº de dias)"
context: fork
agent: gestor-financeiro
---

# Comparar períodos financeiros

Executa como `gestor-financeiro` (somente leitura). Argumentos: `$ARGUMENTS`. Adaptado de `profit-loss` + `variance` (openaccountant).

1. Calcule **os dois períodos com as mesmas fórmulas** (docs/FINANCEIRO_SAUDE.md) e liste: receita bruta, despesas (operacionais + custos da venda), lucro, margem, caixa no fim, nº de vendas com recebimento.
2. **Variação** em R$ e %, só com base > 0. Mês corrente parcial → compare com o mesmo nº de dias do anterior **ou** avise que é parcial; nunca compare mês parcial com mês cheio sem avisar.
3. **Decomponha** a variação do lucro: efeito receita × efeito despesa operacional × efeito custo de venda (mix de repasses).
4. **Ruído:** com poucos recebimentos (< 5) a diferença pode ser só calendário de pagamento — diga isso.
5. **Projeção × realizado:** só para o mês em andamento; meses encerrados não têm projeção guardada (não invente).
6. Mudou regra (% de nota fiscal da venda, % gestor) no intervalo? Cite no `docs/CHANGELOG_AI.md`/`git log`. Termine com Fato/Apontamento/Recomendação.
