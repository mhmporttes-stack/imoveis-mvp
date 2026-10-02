# Métricas canônicas do funil — fonte única

> **Quem usa:** o agente `analista-dados` e suas skills (`/analisar-funil`, `/descobrir-padroes`, `/comparar-periodos`). Qualquer outro agente (`gestor-trafego`, `auditor-crm`, futuros) que calcule conversão, tempo entre etapas ou produtividade **deve usar estas definições** — ou declarar explicitamente qual variante usou.
>
> **Verificado em 2026-10-01** contra `lib/client-status.js`, `lib/performance-overview.js`, `lib/scoring-rules.js`, `docs/BUSINESS_RULES.md` (FUN-1…FUN-7, RAN-2, PRO-6) e o banco de produção (somente `SELECT`). Se o código mudar, o código vale; atualize este arquivo e `docs/analytics/*`.
>
> Regra de ouro: **os números têm de bater com o painel Desempenho** (`getPerformanceOverview`). Quando uma análise precisar de outra coorte, ela é nomeada à parte (MET-5), nunca chamada de "funil".

SQL de referência (testado): [`docs/analytics/funil-painel.sql`](analytics/funil-painel.sql) e [`docs/analytics/consultas-base.md`](analytics/consultas-base.md).

## MET-1 — Unidade, fuso e período

- **Unidade = cliente = uma linha de `simulation_registrations` (`id`).** Não é pessoa: o mesmo telefone pode ter vários cadastros (CLI-4, nunca UNIQUE por telefone). Para "pessoas" use `count(distinct phone_normalized)` e diga isso.
- **Fuso: `America/Sao_Paulo`.** Período = `[início 00:00, fim 00:00)` com **fim exclusivo** (mesmo `resolveOverviewRange`). Nos SQLs: `timestamptz '2026-09-28 00:00:00-03'`. Agrupar por dia/hora sempre com `at time zone 'America/Sao_Paulo'`.
- Sempre informar: período, nº de clientes (n) e a fonte (tabela) de cada número importante.

## MET-2 — Etapas do funil (7) e status que pertencem a cada uma

Fonte única: `CLIENT_FUNNEL_STAGES` em `lib/client-status.js`.

| rk | Etapa | Status que contam |
|---|---|---|
| 1 | Atendimento | `in_service` |
| 2 | Simulação | `completed`, `simulation_sent` |
| 3 | Aguardando documentação | `documentation_pending`, `documents_pending` |
| 4 | Aguardando aprovação | `approval_pending`, `income_commitment`, `cancellation_letter`, `research_mo`, `restriction`, `shielding`, `rejected` |
| 5 | Cliente aprovado | `approved` |
| 6 | Reunião | `meeting_pending`, `meeting_done` |
| 7 | Venda | `sale_completed`, `sale_forms`, `sale_reservation`, `sale_compliance`, `sale_contract`, `sale_caixa_signature`, `sale_itbi`, `sale_registry`, `sale_payment`, `sale_paid` |

- Reprovado/Restrição/Blindagem **permanecem** na etapa 4 (FUN-2). Não são "saída do funil".
- **Fora do funil** (rk = 0): `automated_service`, `pending` (Aguardando simulação), `awaiting_return` (Tentando contato), `archived`, `do_not_contact`. "Prospecção" é a **base** do funil, não uma etapa.
- Venda ao entrar sem nunca ter tido Reunião grava marco "Reunião realizada" `sistema/automatico_por_venda` 1 s antes (FUN-5): clientes em Venda quase sempre têm também Reunião no histórico.

## MET-3 — Etapa mais avançada alcançada (`rk` do cliente)

`rk` = **máximo** entre: (a) etapa do **status atual**; (b) maior etapa de **qualquer** linha de `client_status_history.new_status` **sem limite de data**; (c) piso 1 se `direct_broker_link = true` (link pessoal do corretor já chega em Atendimento). É o que `computeCumulativeFunnel` faz. Venda registrada em `financial_sales` coincide com `rk = 7` hoje (7 = 7 em 2026-10-01; **conferir** se mudar).

## MET-4 — FUNIL-PAINEL (a definição "funil" sem adjetivo)

- **Coorte do período** (`getProspectingClientIds`) = união de: clientes **criados** no período · clientes com **evento de prospecção** no período (`prospecting_history` `claimed`/`prospecting_started`, **exceto** `details.source = 'daily_goal'`; mais cada linha de `daily_goal_attempts`) · clientes que **avançaram** de etapa no período (`client_status_history.new_status` numa etapa 1–7). Mudança para Não contactar/Arquivado/Aguardando retorno **não** coloca ninguém na coorte.
- **Funil cumulativo:** a etapa N conta todo cliente da coorte com `rk >= N` (por isso é sempre decrescente). Base ("Prospecção") = tamanho da coorte.
- **Conversão** de uma etapa = `etapa_N / etapa_(N-1)` (a primeira = Atendimento / base). `null` se o denominador for 0. **Conversão total** = Venda / base — sempre declarar que a base mistura coortes (criados + prospectados + avançaram).
- **Por corretor:** o cliente é atribuído ao **responsável atual** (`responsible_user_id`) — não a quem o criou nem a quem mudou o status. Transferências (roleta, redistribuição) deslocam o histórico para o novo responsável.

## MET-5 — COORTE-CRIAÇÃO (para comparar períodos e medir maturação)

Cliente **criado** em `[início, fim)`, acompanhado até **hoje**: % que alcançou cada `rk >= N` (MET-3). É a variante certa para "o que aconteceu com os leads de setembro" e para comparar períodos, porque **cada lead tem a mesma chance de ter avançado**. Sempre declarar a **idade da coorte** (dias desde o fim do período): coorte nova subestima etapas tardias (viés de maturação). Nunca chamar de "funil do painel".

## MET-6 — Tempo entre etapas

- Instante em que o cliente **alcançou** a etapa `r` = `min(changed_at)` das linhas do histórico com `new_status` na etapa `r`. Tempo `r → r+1` = diferença entre os dois instantes, **só para clientes que têm os dois eventos**.
- Reportar **mediana, p75 e n** (nunca média — cauda longa). Diferenças **negativas** (a etapa seguinte aconteceu antes: ex. formulário/simulação preenchido antes do atendimento) são **excluídas da mediana e contadas à parte** como "fora de ordem".
- Clientes que "pularam" etapa não têm instante nela: ficam fora do par (declarar n). Tempo desde a **criação** usa `simulation_registrations.created_at`. Tempo de resposta/1º contato no Chat vem de `whatsapp_messages` (fora do escopo desta definição — ver `auditor-atendimento`, futuro).

## MET-7 — Perdidos e estoque

- **Perdido** = status atual `do_not_contact` ou `archived` (igual a `/auditar-trafego`). Reprovado **não** é perdido (MET-2).
- **Em andamento** = `ACTIVE_CLIENT_STATUS_VALUES` (`lib/client-status.js`). Cliente "aguardando ação" (CLI-13) = ativo, sem atividade futura (legada **e** `calendar_activities`) e sem contato WhatsApp há > 3 dias.

## MET-8 — Origem

- `client_origins` (1 por cliente; origem imutável): `source_kind` ∈ `manual`, `broker_link`, `site`, `whatsapp_organic`, `whatsapp_ad`, `campaign`, `roulette_link`, `tracked_link`, `whatsapp_chat`, `unknown`; `source_label`, `source_metadata` (jsonb). `distribution_type` = `round_robin` (roleta) ou vazio.
- **Cuidado de comparação:** origens `broker_link`, `whatsapp_*`, `campaign` nascem já com piso/estado em Atendimento (MET-3c, WA-9) → "% que chegou a Atendimento" é ~100% **por construção** e não compara com `manual`. Compare etapas **a partir da Simulação** (rk ≥ 2).
- **Atribuição de anúncio pago, CPL e custo por etapa = `gestor-trafego`** (`/auditar-trafego`). O `analista-dados` pode agrupar por `source_kind` do CRM, mas **não** recalcula atribuição paga nem mistura gasto da Meta.

## MET-9 — Prospecção e Meta Diária

- Rodada (`daily_goal_rounds`) `status`: `active`, `converted`, `ended_no_conversion`. **Taxa de conversão da rodada = `converted / (converted + ended_no_conversion)`** — rodadas `active` ficam **fora** (ainda não decididas). "Converteu" = cliente passou a **Em atendimento** (regra do WA-9/Meta Diária); tentativa vencedora em `converted_attempt`.
- Tentativas: `daily_goal_attempts` (`origin` `manual`|`auto`, `attempt_number`, `goal_date`). Cada tentativa conta igual (1ª/2ª/3ª não se diferenciam para a meta). `goal_date` já é a data do dia da meta.
- Eventos de fila: `prospecting_history.event_type` (`claimed`, `auto_returned`, `do_not_contact`, `daily_goal_*`, `in_service` …). `claimed` com `details.source='daily_goal'` é **reserva automática**, não prospecção manual.
- Meta do dia = prospecção + pendentes congelados (`daily_goals`, `daily_goal_pending_freeze`) — **MD-8**; não recalcular percentual à mão, ler `daily_goals.percent`/`goal_met` quando existir.

## MET-10 — Produtividade e ranking

- Produtividade por corretor/dia = tentativas (`daily_goal_attempts.broker_id`) + clientes criados (responsável) + transições de status creditadas (MET-11) — sempre separando `manual` de `auto`.
- **Pontos do ranking não existem como tabela**: são calculados em código (`getPerformanceOverview`/`getPointsLedger`, regras versionadas em `scoring_rule_versions`, ajustes em `scoring_manual_adjustments`, cada marco vale **uma vez por cliente**, RAN-2). Em SQL, trate **marcos de pontuação** (contagem de primeiras vezes por `STATUS_TO_SCORING_KEY`) como *proxy* e **chame de "marcos", nunca de "pontos"**. Se precisar dos pontos reais, diga que depende do painel Ranking.
- Crédito de transição de status = `changed_by` (e-mail); `null`/não reconhecido cai no responsável; `sistema`/`automacao` = 0 (RAN-2).

## MET-11 — Quem "fez" cada coisa

| Evento | Atribuído a |
|---|---|
| Cliente criado | `responsible_user_id` atual (roleta não pontua) |
| Mudança de status | `client_status_history.changed_by` (e-mail → corretor) |
| Tentativa Meta Diária | `daily_goal_attempts.broker_id` |
| Cliente no funil por corretor (MET-4) | `responsible_user_id` **atual** |

## MET-12 — Venda

**[REGRA OFICIAL — dono, 2026-10-02] No painel Desempenho/Visão Geral, a contagem de Venda de um período = clientes cuja PRIMEIRA entrada em qualquer status de venda (`client_status_history`) cai no período** — uma vez só; Conformidade/Cartório/Pago depois não somam venda nem movem o mês (`lib/sales-count-core.mjs`, teste `tests/sales-count-core.test.mjs`). Cliente criado já em status de venda sem histórico de venda conta na data de criação. As demais etapas do funil seguem a definição cumulativa abaixo. O SQL canônico `docs/analytics/funil-painel.sql` implementa isso na coluna `venda` (e mostra `venda_etapa_alcancada` = rk ≥ 7 só para conferência), com regressão em `tests/funil-painel-sql.test.mjs` — corrigido em 2026-10-02: antes o SQL contava rk ≥ 7 e trazia como venda do período quem só mudou de subetapa (ex.: 28/09–01/10: 3 → 0). Venda = `rk = 7` (qualquer dos 10 status de venda) continua valendo para a definição de etapa alcançada. Valor/comissão = `financial_sales` (uma por cliente), **não** se confunde com a contagem do funil. Cancelamento financeiro: `financial_status = 'cancelado'`.

## MET-13 — Lacunas conhecidas nos dados (medidas em 2026-10-01 — reconferir antes de confiar)

1. **`client_status_history` é escrito por código, não por trigger** (P-02). Dos 3.079 clientes, 1.089 têm status atual ≠ último histórico — **1.053 são status de prospecção/fora do funil** (`awaiting_return`, `do_not_contact`, `archived`: ações da Prospecção atualizam `status` direto, PRO-5) e só **36** em status do funil. Conclusão: para **etapas 1–7 o histórico é confiável**; para **fora do funil/prospecção use o status atual**, não o histórico.
2. **Janela curta:** primeiro cliente em 2026-07-21; histórico a partir de 2026-07-27, mas **~96 % dos eventos são de 2026-09-07 em diante** (semana de 09-07: 478; 09-14: 1.424). Análises antes de setembro/2026 são pobres; tendências semanais têm poucas semanas.
3. **`client_status_history.source` é nulo em ~82 %** das linhas (3.246 de 3.948): não use `source` para separar manual de automático em dados antigos; `changed_by` nulo/`sistema` identifica automação.
4. **203 clientes têm `rk ≥ 1` sem nunca ter tido linha `in_service`** (entraram por etapa posterior/piso do link do corretor/backfill): a cumulatividade cobre, mas **tempo entre etapas** deles não existe.
5. **Fora de ordem:** 12 de 44 pares Atendimento→Simulação têm simulação **antes** do atendimento (formulário preenchido antes) — ver MET-6.
6. **Dados de teste** (clientes/contas de teste do dono) existem em produção; um cliente de teste pode inflar uma etapa em amostras pequenas. Em período curto, confira se as contagens de etapas altas (aprovado/reunião/venda) não são de teste.
7. **Atividade do corretor × conversão da rodada:** a taxa de conversão das rodadas varia de 0 % a 100 % entre corretores (n ≥ 20, desde 2026-09-14), mas parte vem de **como a rodada é usada** (corretores novos, rodadas criadas já na conversão, 1–2 dias de dados) — não de qualidade. Nunca ranquear pessoas por essa taxa sem checar volume por dia e tipo de rodada.

## MET-14 — Regras de apresentação (obrigatórias)

- Todo número: **período, n, fonte (tabela/consulta)**. Taxa sem n é inválida.
- **n < 10** no denominador: não concluir, só descrever. **10 ≤ n < 30**: descritivo, sem comparar grupos. Para comparar grupos/períodos use **intervalo de confiança de Wilson 95 %** (fórmula em `consultas-base.md`) e só afirme diferença se os intervalos **não se sobrepõem**.
- Varredura de muitas hipóteses (`/descobrir-padroes`): o que sobrar é **candidato**, nunca fato — validar em outro período antes de recomendar mudança. Correlação ≠ causa: apontar confusores prováveis (origem, corretor, dia, idade da coorte, dado de teste).
- Dados pessoais de **cliente** (nome, telefone, CPF, renda exata, e-mail) nunca no relatório — contagens, faixas e IDs internos. Nomes de corretores (equipe) são aceitos como identificador, sem julgamento de pessoa.

## Divergências conhecidas entre implementações (para reconciliar)

| Onde | Diferença | Efeito hoje |
|---|---|---|
| `/auditar-trafego` (`references/consultas-funil.md`, `stage_of`) | Inclui `financial_sales` não cancelada como piso rk 7; **não** aplica o piso `direct_broker_link` do painel | Zero diferença em 2026-10-01 (vendas = rk 7); pode divergir se surgir venda financeira sem status de venda ou cliente de link do corretor sem histórico |
| Funil do painel (`computeCumulativeFunnel`) | Não consulta `financial_sales` | Idem |

Não corrija uma implementação "para bater" com a outra sem pedido do dono; registre a divergência aqui e em `docs/SYSTEM_ARCHITECTURE.md` §12/§13 se virar risco.
