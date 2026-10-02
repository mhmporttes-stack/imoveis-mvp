# Financeiro — aba "Saúde" (definições canônicas)

> Fonte única de fórmulas da aba **Saúde** (`/admin/financeiro` → SAÚDE) e do agente `gestor-financeiro`. Código: `lib/financial-health-core.mjs` (cálculo puro, testado em `tests/financial-health.test.mjs`), `lib/financial-health.js` (persistência), `components/FinancialHealthTab.jsx` + `FinancialHealthCharts.jsx` (UI), `app/api/financeiro/saude/**` (rotas). Migrations: `20261002120000_financial_health.sql`, `20261002190000_financial_expense_occurrences.sql`.

## Acesso

Somente **administrador geral** (`isGeneralAdminAuth` na página; `requireGeneralAdminApi` em todas as rotas `app/api/financeiro/saude/**`). Gestor continua sem acesso ao Financeiro; corretor e associado seguem só com a visão própria (a aba Saúde não aparece para eles). Os dados são da empresa inteira (despesas, caixa), por isso não há escopo parcial.

## Realizado × previsto × estimado (nunca misturar)

| Rótulo | Receita | Despesa |
|---|---|---|
| **REALIZADO** | `financial_payments.status = 'received'`, na data `received_date` | despesa operacional **paga = confirmada manualmente** (na data do pagamento e pelo valor pago) + custos da venda apropriados ao recebido |
| **PREVISTO** | `expected`/`overdue` por `expected_date` (vencido ainda aberto = "vencido", segue como previsto) **+ previsão de recebimento do saldo** (`financial_sales.expected_receipt_date`, ver abaixo) | despesa/ocorrência **ainda não confirmada**, na data prevista ou reagendada — inclusive a **vencida** (a data chegar não paga) |
| **ESTIMADO** | nunca estimamos receita | variáveis ainda não lançadas no mês = média dos 3 meses anteriores − variáveis já lançadas (mín. 0). Aparece separado, **fora** do resultado projetado |

Pagamento `cancelled` e venda `cancelled` ficam fora de tudo. Recebido sem data de recebimento usa a data esperada; sem nenhuma, não entra (aviso "dados incompletos").

## Integração com a previsão de recebimento (Agenda)

A previsão do saldo da comissão (`expected_receipt_date`, `computeForecastAmount` de `lib/financial-expected-receipt-core.mjs`) entra como **PREVISTO**, na data prevista, com o mesmo saldo da Agenda (comissão livre − recebido − parcelas já datadas; sem dupla contagem; venda recebida/cancelada não tem previsão). **Só o dono vê essa data** (regra do dono, 2026-10-02): o servidor já a esvazia para outros perfis, então para um admin geral que não seja o dono a Saúde simplesmente não inclui a previsão do saldo (só parcelas datadas). Previsão nunca vira recebido — só a confirmação humana cria o pagamento. Divergência conhecida herdada (não alterada): o saldo usa a comissão livre e o status usa a bruta.

## Modelo de dados novo (aditivo)

- `financial_operating_expenses` — despesas **da empresa** (aluguel, sistemas, anúncios…): `description`, `category`, `expense_type` (`fixed|variable|extraordinary`), `amount > 0`, `expense_date`, `is_recurring`, `recurrence_period` (`monthly|bimonthly|quarterly|semiannual|annual`), `recurrence_end_date`, `note`. **Não confundir** com `financial_expenses` (repasses/despesas de uma venda, filhas de `financial_sales`) — essas continuam intactas.
- `financial_operating_expense_occurrences` — confirmação de pagamento/reagendamento por ocorrência (`status pending|paid`, `paid_date`, `paid_amount`, `rescheduled_to`; único por `expense_id + occurrence_date`; cascade ao excluir a despesa).
- `financial_health_settings` — linha única (`id = 1`): `opening_cash_balance`/`opening_cash_date` (ambos NULL = caixa não configurado; o sistema **nunca assume saldo 0**), `reserve_months` (padrão 3), `critical_months` (padrão 1).
- RLS ligado sem policy pública (padrão do projeto); acesso só pelo servidor.

## Despesa prevista × paga (confirmação manual)

**[REGRA OFICIAL — dono, 2026-10-02]** Toda despesa nasce **prevista**. Só vira **paga** (realizada) após a ação manual **Confirmar pagamento**; a data chegar **não** paga. Vencida e não confirmada = continua prevista (marcada "Venceu há N dias") e aparece no apontamento "despesas aguardando confirmação".

- Confirmação por **ocorrência** (tabela `financial_operating_expense_occurrences`, chave `expense_id + data original`): grava `paid_date` (não futura) e `paid_amount` (**congelado** — editar a despesa depois não muda o que foi pago). **Desfazer** volta a prevista.
- **Reagendar** (`rescheduled_to`) move só a data prevista daquela ocorrência (inclusive para outro mês); a chave continua a data original. Não é possível reagendar uma paga (desfaça antes).
- **Realizado / lucro / margem / caixa** usam só despesas pagas, na data do pagamento. **Projeções/expectativa/ponto de equilíbrio** usam as previstas — inclusive vencidas de meses anteriores (obrigação em aberto; aparecem à parte como "vencidas aguardando confirmação") —, nunca como realizadas. O gráfico mostra previstas só na linha tracejada (vencidas a partir de hoje).
- Custo operacional mensal de referência (reserva) mede o que a operação custa — pago ou ainda a confirmar.
- Sem linha em `...occurrences` = prevista. Despesas já cadastradas antes desta regra passam a ser previstas até serem confirmadas.

## Recorrência

A linha guarda **uma vez** a âncora (`expense_date` = 1ª ocorrência), a periodicidade e o encerramento opcional. As ocorrências são **calculadas na leitura** (`expandExpenseOccurrences`): mesmo dia do mês (dia 31 → último dia dos meses curtos), até `recurrence_end_date`. Nada é materializado no banco.

**Alterar uma recorrente vale só dali para frente [REGRA OFICIAL — dono, 2026-10-02].** Ao mudar valor, categoria, tipo, descrição ou periodicidade, o sistema (`planRecurringSplit` + `splitRecurringExpense`) **encerra a série antiga no dia anterior à vigência** (padrão: hoje; campo "Aplicar a partir de") e cria uma **nova série** a partir da 1ª ocorrência na/após a vigência (mesmo dia do mês; periodicidade nova ancora na data de vigência). Meses encerrados, valores pagos e relatórios históricos ficam idênticos. Confirmações/reagendamentos com data ≥ vigência que existam na série nova são **migrados**; se alguma não existir na nova, a alteração é recusada (nada se perde em silêncio). Sem nada anterior à vigência (nenhum histórico a preservar) edita no lugar; mudar só observação/encerramento não cria versão. Ordem: cria nova → migra → encerra antiga (com desfazimento se falhar no meio — PostgREST sem transação).
- **Encerrar** grava `recurrence_end_date` = hoje; **Excluir** apaga a série inteira e suas confirmações (a UI avisa e sugere Encerrar). Uma recorrente não pode virar única (use Encerrar).

## Receita, custos da venda e lucro

`financial_payments` é medido contra a **comissão bruta** da venda. Cada recebimento gera:
```
razão  = recebido ÷ comissão bruta            (máx. 1)
net    = comissão da imobiliária × razão       (parte da imobiliária)
custo  = recebido − net                        (repasses, despesas da venda, nota, comissões de corretor/gestor)
```
(comissão da imobiliária = `totals.agencyCommission` de `calculateFinancialTotals`, ou seja, já considera nota 15% **[PENDENTE DE VALIDAÇÃO]**, despesas da venda e a distribuição corretor/gestor/imobiliária.) A venda não registra a data em que cada repasse é pago, então os custos são apropriados **proporcionalmente ao recebido** — apropriação gerencial, declarada na tela.

```
RECEITA BRUTA  = Σ recebido (REALIZADO) no período
DESPESAS       = custos da venda apropriados + despesas operacionais realizadas
LUCRO LIVRE    = RECEITA BRUTA − DESPESAS            (= parte da imobiliária recebida − despesas operacionais)
MARGEM         = LUCRO LIVRE ÷ RECEITA BRUTA          (— se receita = 0)
vs anterior    = (atual − anterior) ÷ anterior, só com base > 0; mês cheio compara com mês anterior; outro intervalo, com o intervalo de mesmo tamanho imediatamente anterior
```

## Expectativa do mês e projeção

```
RESULTADO PROJETADO = (recebido + previsto a receber)
                    − (despesas realizadas + custos de venda dos previstos + despesas operacionais futuras/recorrentes do mês)
```
Exemplo do dono: recebido 25.000, previsto 12.000, despesas realizadas 8.000, previstas 4.000 → 25.000 (coberto em teste). Só existe para o mês corrente. Meses encerrados mostram apenas o realizado (não há "foto" da projeção passada — não inventar).

## Caixa, reserva e cobertura

```
CAIXA (hoje) = saldo inicial (início do dia da data inicial) + Σ recebido − custos da venda apropriados − Σ despesas operacionais (desde a data inicial até hoje)
CUSTO OPERACIONAL MENSAL = máx( média dos 3 últimos meses fechados de despesas operacionais não extraordinárias ,
                                 equivalente mensal das recorrências ativas hoje )      (conservador: não subestima quando o histórico é curto)
RESERVA RECOMENDADA = custo operacional mensal × reserve_months
COBERTURA (meses)   = caixa ÷ custo operacional mensal
SAUDÁVEL se cobertura ≥ reserve_months · ATENÇÃO se critical_months < cobertura < reserve_months · CRÍTICO se cobertura ≤ critical_months
```
Sem saldo inicial → "caixa não configurado" e nada derivado é exibido (nem reserva, nem cobertura). A classificação é puramente matemática, com limiares configuráveis; nenhuma IA decide.

## Ponto de equilíbrio

```
MARGEM DE CONTRIBUIÇÃO = Σ net ÷ Σ recebido bruto   (últimos 6 meses + período, só recebidos)
PONTO DE EQUILÍBRIO    = despesas operacionais do período (realizadas + previstas) ÷ margem de contribuição     (receita BRUTA necessária)
FALTA                  = máx(0, ponto de equilíbrio − receita bruta recebida)
```
Sem histórico de recebimentos (margem indefinida), mostra a versão líquida: despesas operacionais × parte da imobiliária já recebida.

## Resultado por corretor

Métrica: **"Resultado da imobiliária por corretor"** = Σ `net` dos recebimentos do período por corretor da venda (`broker_id`/e-mail/nome). É a parte que efetivamente pertence à empresa — **não** é VGV nem comissão bruta. Despesas operacionais não são atribuídas a corretor (não há critério defensável), então não é um "lucro por corretor" completo; o nome na tela reflete isso. Tooltip: bruto recebido, repasses/custos, nº de vendas.

## Apontamentos (Fato → Apontamento → Recomendação)

Regras determinísticas em `buildInsights`: despesas ±10% vs anterior; categoria dominante (≥ 40% = atenção); categoria ≥ +30% e ≥ R$ 100; recorrentes crescendo; extraordinárias em ≥ 2 dos últimos 3 meses; possíveis duplicidades (descrição + valor + data idênticos, linhas distintas); margem ±5 p.p.; cobertura de caixa e queda desde o mês anterior; resultado projetado; recebimentos vencidos. Nunca rotula despesa como "desnecessária".

## Consultas-base (somente leitura, para o agente)

```sql
-- C-RECEBIDO: recebido por mês (comissão bruta)
select date_trunc('month', p.received_date)::date as mes, sum(p.amount) as recebido, count(*) as n
from financial_payments p join financial_sales s on s.id = p.sale_id
where p.status = 'received' and s.financial_status <> 'cancelled' and p.received_date is not null
group by 1 order by 1 desc limit 12;

-- C-PREVISTO: a receber por mês esperado
select date_trunc('month', p.expected_date)::date as mes, sum(p.amount) as previsto, count(*) filter (where p.expected_date < current_date) as vencidos
from financial_payments p join financial_sales s on s.id = p.sale_id
where p.status in ('expected','overdue') and s.financial_status <> 'cancelled' and p.expected_date is not null
group by 1 order by 1;

-- C-DESPESAS-OP: despesas operacionais cadastradas (recorrência expandida no código: lib/financial-health-core.mjs)
select expense_type, category, amount, expense_date, is_recurring, recurrence_period, recurrence_end_date
from financial_operating_expenses order by expense_date desc limit 200;

-- C-CONFIG: saldo inicial e reserva
select opening_cash_balance, opening_cash_date, reserve_months, critical_months from financial_health_settings;
```

## Limitações conhecidas

- Excluir uma despesa apaga suas confirmações de pagamento (sugere-se Encerrar). A divisão de recorrente não é transacional (compensação manual no código).
- Custos da venda (repasses/comissões) apropriados proporcionalmente ao recebido, não pela data real de pagamento do repasse.
- O reparo automático de "Recebido" sem recebimento (`financial-receipt-repair-core.mjs`) lança recebimento complementar com a data de hoje — esse valor entra como receita realizada no mês do lançamento (coerente com a regra do dono de 2026-10-01).
- Premissas PENDENTES do dono que afetam os números: 15% de nota fiscal, % de gestor por venda, lista de status que cria venda (`.claude/rules/financeiro.md`).
- Receita é irregular (poucas vendas grandes): variações mês a mês com poucos recebimentos são ruído de calendário.
