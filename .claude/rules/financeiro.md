---
paths:
  - "lib/financial*"
  - "components/AdminFinancialDashboard.jsx"
  - "app/admin/financeiro/**"
  - "app/api/financeiro/**"
  - "lib/whatsapp-broadcast-finance.js"
---

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

**[REGRA OFICIAL DE NEGÓCIO — confirmada pelo dono em 2026-10-01]** Cliente que entra no status `sale_paid` ("Pago", última etapa do pipeline de venda — ver `.claude/rules/crm-clientes-funil.md`) marca automaticamente a `financial_sales` correspondente como `financial_status = 'received'` ("Recebido") **e conta nos totais mensais do mês em que a mudança aconteceu** (regra do dono: "a venda recebida deve ser computada no mês que eu alterei o status para pago"). Implementação: `markFinancialSaleReceivedForRegistration` (`lib/financial.js`), chamada por `updateSimulationRegistration` (`lib/simulation-registrations.js`) só na transição PARA `sale_paid` (nunca retroativo em toda atualização). Como `financial_status` é sempre DERIVADO da soma dos `financial_payments` contra a comissão bruta (`deriveFinancialStatus`), a função lança um `financial_payments` novo com o valor que falta receber (comissão bruta − já recebido), `received_date` = hoje (`getTodayInSaoPaulo`) — nunca mexe em recebimentos/despesas/repasses já lançados, só complementa o que falta.

## Previsão de recebimento + Agenda

**[REGRA OFICIAL DE NEGÓCIO — pedido do dono em 2026-10-02]** Três datas diferentes, nunca misturar: **data da venda** (`sale_date`) ≠ **previsão de recebimento** (`financial_sales.expected_receipt_date`, campo "Previsão de recebimento" na Edição Financeira, perto do status) ≠ **data real do recebimento** (`financial_payments.received_date`). A previsão é a expectativa de entrada do SALDO: valor previsto = comissão livre − recebido − parcelas já datadas (`computeForecastAmount`, nunca gravado). Previsão **nunca** vira recebido sozinha; vencida sem confirmação continua pendente (atividade segue aberta, valor em "Vencidas de meses anteriores"). Venda recebida/cancelada não tem previsão nem atividade.

- **Indicadores** (`calculateReceivableMetrics`, `lib/financial-expected-receipt-core.mjs`, testado): "Recebido neste mês" = só pagamento `received` com data real no mês; "A receber" = não recebido e não cancelado, pela data prevista (parcela datada ou previsão do saldo). Não dependem do período da data da VENDA.
- **Agenda**: UMA atividade `recebimento` por venda (`calendar_activities.financial_sale_id`, 09:00 de SP), mantida por `syncExpectedReceiptActivity` (ao salvar a venda, ao confirmar/reagendar e pela reconciliação do cron `scheduled-activities`). Reagendar move a MESMA atividade. Concluir/reagendar/excluir pelas ações genéricas da Agenda é recusado para atividade financeira.
- **Confirmar recebimento** (`POST /api/financeiro/[id]/receipt`, `requireGeneralAdminApi`): idempotente e à prova de corrida — claim condicional da atividade + `financial_payments.confirmed_activity_id` único. Valor ≤ saldo previsto; parcial aceita nova previsão para o saldo.
- **Só o dono** [REGRA OFICIAL — dono, 2026-10-02]: lançar, alterar e **ver** a previsão é exclusivo do administrador principal (`isOwnerAdminEmail`, `isExpectedReceiptOwner` em `lib/financial.js`). Não-dono (inclusive outro admin geral, gestor, corretor, associado) não recebe `expectedReceiptDate` (omitido em `listFinancialSales`/`getFinancialSale`, logo na API e na tela), não vê o campo/linhas/atividade e não grava (salvar a venda preserva a previsão); `POST /api/financeiro/[id]/receipt` responde 403. A atividade é sempre do dono.
- **Divergência conhecida, não alterada**: o saldo usa a comissão LIVRE, mas `deriveFinancialStatus` compara com a BRUTA — com nota fiscal (15%) as bases diferem. Não mude sem decisão do dono.
