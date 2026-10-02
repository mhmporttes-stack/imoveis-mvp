---
name: analisar-despesas
description: Analisa as despesas da empresa — composição por categoria, fixas × variáveis × extraordinárias, recorrências, crescimento anormal, categorias desproporcionais, extraordinárias que se repetem e possíveis lançamentos duplicados — sem julgar "desnecessária" sem evidência. Use para "para onde está indo meu dinheiro", "minhas despesas subiram?", "tem gasto repetido?". Somente leitura.
argument-hint: "[período] — vazio = mês atual × mês anterior"
context: fork
agent: gestor-financeiro
---

# Analisar despesas

Executa como `gestor-financeiro` (somente leitura). Argumentos: `$ARGUMENTS`. Adaptado de `spending-review` / `expense-optimizer` / `seasonal-patterns` (openaccountant), restrito a despesas **operacionais** da imobiliária (`financial_operating_expenses`; despesas por venda são repasses — analise à parte e rotule).

1. **Composição** por categoria e tipo (fixa/variável/extraordinária) no período, com % do total e variação vs período anterior (C-DESPESAS-OP, recorrência expandida).
2. **Recorrentes:** equivalente mensal hoje × há 1 mês; contratos novos; recorrências encerradas.
3. **Anomalias** (cada uma: Fato → Apontamento → Recomendação): categoria ≥ +30% e ≥ R$ 100; categoria > 40% do total; extraordinária em ≥ 2 dos últimos 3 meses; **possível duplicidade** (mesma descrição + valor + data).
4. **Sazonalidade:** só comente com ≥ 6 meses de dados; senão diga que não há histórico.
5. **Economia possível:** liste candidatas a **revisão** (não "cortes"), com o valor mensal envolvido; a decisão é do dono.
Nunca altere/exclua despesa. Sugira correções para o dono fazer na aba Saúde.
