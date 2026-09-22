# Financeiro

Arquivos: `lib/financial.js` (persistência, escopo por perfil), `lib/financial-calculations.js` (distribuição de comissão em centavos), `components/AdminFinancialDashboard.jsx`.

## Modelo

`financial_sales` (venda/VGV, data, percentual e comissão bruta, status: pendente/parcial/recebido/cancelado) → `financial_expenses` (despesas) e `financial_payments` (recebimentos: previsto/recebido/atrasado/cancelado), ambas apontando pra venda.

Cálculo básico (`lib/financial.js`):
```
dedução por nota = comissão bruta × 15%, se invoiceIssued
comissão livre = max(0, comissão bruta − dedução − despesas)
a receber = max(0, comissão livre − recebido)
```

`invoiceIssued` é só um campo de controle interno ("Gerar nota/nota emitida") — **não é integração fiscal real** (sem emissão de NFS-e/prefeitura). Nunca descreva esse recurso como emissão fiscal automática numa resposta ao usuário sem essa integração existir de fato.

**[PENDENTE DE VALIDAÇÃO]** Os 15% de dedução por nota fiscal (`invoiceIssued`) são o que o código calcula hoje. **Não trate como regra oficial** — o dono ainda não confirmou se 15% é a alíquota/percentual correto atualmente ou um valor que ficou desatualizado. Não altere esse número sem confirmação explícita.

## Distribuição de comissão (`lib/financial-calculations.js`)

**[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-09-22]** Quando houver comissão de gestor aplicável: descontar **10% para o gestor**; sobre o valor restante, dividir **50% para a imobiliária e 50% para o corretor**. Em vendas realizadas pelo próprio proprietário/admin do sistema, **não deve haver desconto de gestor**. O gestor deve ser **selecionável/configurável conforme o corretor/operação** (não um gestor único fixo para todas as vendas).

**[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO — diverge da regra oficial acima, confirmar antes de corrigir]** `calculateCommissionDistribution` (`lib/financial-calculations.js`) já recebe `managerId`/`managerPercentage` por venda (ou seja, o gestor e o percentual **já são selecionáveis por operação** — isso já bate com a regra oficial), mas:
- O percentual de gestor é um campo livre digitado por venda (`payload.managerPercentage`), **não fixo em 10%** como a regra oficial pede.
- Corretor/imobiliária já usam 50%/50% como padrão da função, mas os percentuais continuam sendo parâmetros livres (`brokerPercentage`/`agencyPercentage`) que só precisam somar 100% — não há uma trava que force exatamente 50/50.
- **Não há nenhuma regra automática que zere o desconto de gestor quando o vendedor é o proprietário/admin** — hoje `hasManagerCommission` é só um toggle manual preenchido em cada venda; nada no código verifica quem é o vendedor para desabilitar isso sozinho.

Cálculo inteiramente em centavos para controlar arredondamento — não reescreva em float sem motivo. Esta lacuna (implementação vs. regra oficial) é candidata a uma tarefa de correção futura — não corrigida agora porque esta etapa é só de documentação.

## Visão de associado

**[PENDENTE DE VALIDAÇÃO]** `toAssociateFinancialView` produz, no servidor, uma projeção: 10% fixo da comissão livre e 10% fixo dos recebimentos, com despesas e participação imobiliária/gestor ocultadas. **A finalidade exata desse cálculo (por que 10%, e se vale pra todo associado do mesmo jeito) ainda não foi confirmada pelo dono** — não trate como regra oficial. A documentação técnica antiga já registra que "não presumir que todos os cenários de venda própria e múltiplas participações foram modelados separadamente" — um associado com mais de um corretor vinculado, ou participação em vendas próprias, pode não estar coberto pelo código atual.

## Criação automática de venda

**[PENDENTE DE VALIDAÇÃO]** Existe criação automática de `financial_sales` ao entrar em determinados status comerciais, tanto por código quanto por trigger de banco. **A lista exata de status que dispara essa criação ainda não foi validada pelo dono como a lista oficialmente correta** — antes de alterar quais status disparam isso, confirme a lista com ele. Ao mexer nesse fluxo, de qualquer forma, **preserve a prevenção de duplicidade por cliente** já existente em `financial_sales` — não remova essa trava para "simplificar".
