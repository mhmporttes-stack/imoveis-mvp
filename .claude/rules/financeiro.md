---
paths:
  - "lib/financial*"
  - "components/AdminFinancialDashboard.jsx"
  - "app/admin/financeiro/**"
  - "app/api/financeiro/**"
  - "lib/whatsapp-broadcast-finance.js"
  - "components/FinancialHealth*"
  - "docs/FINANCEIRO_SAUDE.md"
---

# Financeiro

Arquivos: `lib/financial.js` (persistência, escopo por perfil), `lib/financial-calculations.js` (distribuição de comissão em centavos), `components/AdminFinancialDashboard.jsx`.

## Modelo

`financial_sales` (venda/VGV, data, percentual e comissão bruta, status: pendente/parcial/recebido/cancelado) → `financial_expenses` (despesas) e `financial_payments` (recebimentos: previsto/recebido/atrasado/cancelado), ambas apontando pra venda.

Cálculo básico (`lib/financial.js`):
```
dedução por nota = comissão bruta × invoice_percentage (% PRÓPRIO de cada venda, 0–100)
comissão livre = max(0, comissão bruta − dedução − despesas)
a receber = max(0, comissão livre − recebido)
```

`invoiceIssued` é só um campo de controle interno ("Gerar nota/nota emitida") — **não é integração fiscal real** (sem emissão de NFS-e/prefeitura). Nunca descreva esse recurso como emissão fiscal automática numa resposta ao usuário sem essa integração existir de fato.

**[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-02]** A nota fiscal é uma **despesa variável da venda** e o percentual **pertence a cada venda** (`financial_sales.invoice_percentage`, campo "Nota fiscal (%)" na Edição Financeira; qualquer valor 0–100, ex.: 6, 10, 12, 15, 20). **Não existe percentual global** nem 15% fixo. Base = **comissão bruta** (nunca VGV), deduzida **antes** da divisão gestor/corretor/imobiliária e **uma única vez** (`calculateSaleBase` em `lib/financial-calculations.js`, fonte única usada por servidor e tela). `invoice_issued` virou derivado (`% > 0`). Vendas antigas foram migradas sem mudar valor (com nota → 15, sem nota → 0); sem a coluna/valor, o fallback é o legado (com nota = 15%).

**[REGRA OFICIAL — dono, 2026-10-02] Classificação:** **repasses** (comissão de corretor e gestor + despesas da venda de categoria Repasse/Corretor parceiro/Captador/Indicador/Bonificação) **não são despesas operacionais**; nota fiscal é despesa variável da venda; despesas operacionais = da empresa (`financial_operating_expenses`) + despesas da venda que não são repasse. Saúde: comissão recebida − repasses − nota − despesas operacionais pagas = resultado líquido (`docs/FINANCEIRO_SAUDE.md`).

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
- **Divergência conhecida, não alterada**: o saldo usa a comissão LIVRE, mas `deriveFinancialStatus` compara com a BRUTA — com nota fiscal as bases diferem. Não mude sem decisão do dono.
## Aba "Saúde" (2026-10-02)

Só admin geral. Despesas **da empresa** vivem em `financial_operating_expenses` (≠ `financial_expenses`, que são repasses/despesas de UMA venda); caixa/reserva em `financial_health_settings`. Cálculo puro em `lib/financial-health-core.mjs` — **toda fórmula (realizado × previsto × estimado, caixa, reserva, ponto de equilíbrio, resultado por corretor) está em `docs/FINANCEIRO_SAUDE.md`**; não duplique nem reinvente. Nunca assumir saldo de caixa; nunca materializar recorrência futura; nunca contar previsão como recebido. **[COMPORTAMENTO ATUAL DA IMPLEMENTAÇÃO]** pedido do dono em 2026-10-02 (implementado como descrito no doc).

**[REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-02]** Despesa operacional só é **paga** após **Confirmar pagamento** manual (a data chegar não paga); previstas (inclusive vencidas) entram só nas projeções; **reagendar** move a data prevista. Alterar recorrente vale **só dali para frente** (série antiga encerrada, nova criada) — nunca reescrever meses passados. Tabela `financial_operating_expense_occurrences`; detalhes em `docs/FINANCEIRO_SAUDE.md`.
