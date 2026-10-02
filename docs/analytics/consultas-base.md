# Consultas-base do analista de dados (somente leitura)

Definições em [`../METRICAS_FUNIL.md`](../METRICAS_FUNIL.md). Todas as consultas: **uma única instrução `SELECT`/`WITH … SELECT`**, projeto Supabase `tshhasbbchjcvhoyizoo`, via `execute_sql`. Troque só os parâmetros (período). Testadas em 2026-10-01.

Funil do painel (MET-4): [`funil-painel.sql`](funil-painel.sql).

## CTE comum `stage_of` (cole em todas)

```sql
stage_of(status, rk) as (values
  ('in_service',1),
  ('completed',2),('simulation_sent',2),
  ('documentation_pending',3),('documents_pending',3),
  ('approval_pending',4),('income_commitment',4),('cancellation_letter',4),('research_mo',4),('restriction',4),('shielding',4),('rejected',4),
  ('approved',5),
  ('meeting_pending',6),('meeting_done',6),
  ('sale_completed',7),('sale_forms',7),('sale_reservation',7),('sale_compliance',7),('sale_contract',7),
  ('sale_caixa_signature',7),('sale_itbi',7),('sale_registry',7),('sale_payment',7),('sale_paid',7))
```

`rk` do cliente (MET-3):

```sql
greatest(
  coalesce((select s.rk from stage_of s where s.status = r.status), 0),
  coalesce((select max(s.rk) from client_status_history h join stage_of s on s.status = h.new_status where h.client_id = r.id), 0),
  case when r.direct_broker_link then 1 else 0 end) as rk
```

## Q-COORTE-CRIAÇÃO por origem (MET-5 + MET-8)

```sql
with stage_of(status, rk) as (values /* ver CTE comum */),
base as (
  select r.id, o.source_kind,
    greatest(coalesce((select s.rk from stage_of s where s.status=r.status),0),
             coalesce((select max(s.rk) from client_status_history h join stage_of s on s.status=h.new_status where h.client_id=r.id),0),
             case when r.direct_broker_link then 1 else 0 end) rk
  from simulation_registrations r left join client_origins o on o.client_id = r.id
  where r.created_at >= timestamptz '2026-09-28 00:00:00-03' and r.created_at < timestamptz '2026-10-02 00:00:00-03')
select coalesce(source_kind,'(sem origem)') origem, count(*) criados,
  count(*) filter (where rk>=1) atend, count(*) filter (where rk>=2) simul,
  count(*) filter (where rk>=3) doc, count(*) filter (where rk>=5) aprov, count(*) filter (where rk>=7) venda
from base group by 1 order by 2 desc
```

## Q-TEMPO-ENTRE-ETAPAS (MET-6)

```sql
with stage_of(status, rk) as (values /* ver CTE comum */),
first_reach as (select h.client_id, s.rk, min(h.changed_at) t
  from client_status_history h join stage_of s on s.status=h.new_status group by 1,2),
pairs as (select a.rk from_rk, b.rk to_rk, extract(epoch from (b.t-a.t))/3600.0 horas
  from first_reach a join first_reach b on b.client_id=a.client_id and b.rk=a.rk+1)
select from_rk||'->'||to_rk etapa,
  count(*) filter (where horas>=0) n,
  round((percentile_cont(0.5) within group (order by horas) filter (where horas>=0))::numeric,1) mediana_h,
  round((percentile_cont(0.75) within group (order by horas) filter (where horas>=0))::numeric,1) p75_h,
  count(*) filter (where horas<0) fora_de_ordem
from pairs group by from_rk,to_rk order by from_rk
```

Para limitar a um período, filtre `where b.t >= … and b.t < …` em `pairs` (chegada à etapa seguinte dentro do período).

## Q-ROTAÇÃO-META-DIÁRIA por corretor (MET-9)

```sql
select u.name corretor, u.role,
  count(*) filter (where r.status in ('converted','ended_no_conversion')) decididas,
  count(*) filter (where r.status='converted') convertidas,
  round(100.0*count(*) filter (where r.status='converted') / nullif(count(*) filter (where r.status in ('converted','ended_no_conversion')),0),1) pct_conv,
  count(distinct (r.created_at at time zone 'America/Sao_Paulo')::date) dias_com_rodada
from daily_goal_rounds r join admin_users u on u.id = r.broker_id
where r.created_at >= timestamptz '2026-09-14 00:00:00-03' and r.created_at < timestamptz '2026-10-02 00:00:00-03'
group by 1,2 order by decididas desc
```

Sempre acompanhar de `dias_com_rodada` e de `count(distinct converted_at::date)` antes de comparar pessoas (MET-13 item 7).

## Q-COBERTURA-DO-HISTÓRICO (rodar antes de qualquer análise de tempo/tendência — MET-13)

```sql
with last_h as (select distinct on (client_id) client_id, new_status from client_status_history order by client_id, changed_at desc)
select count(*) clientes,
  count(*) filter (where r.status <> l.new_status) status_diverge_do_historico,
  count(*) filter (where r.status <> l.new_status and r.status not in ('awaiting_return','do_not_contact','archived','pending','automated_service')) diverge_em_etapa_do_funil,
  (select min(changed_at) from client_status_history) historico_desde,
  (select count(*) from client_status_history where source is null) linhas_sem_source,
  (select count(*) from client_status_history) linhas_total
from simulation_registrations r join last_h l on l.client_id = r.id
```

## Intervalo de confiança de Wilson 95 % (comparar taxas — MET-14)

Para `k` sucessos em `n` (n > 0), `p = k/n`, `z = 1.96`:

```sql
-- limite inferior / superior
round(100*((p + z*z/(2*n)) - z*sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n), 1) as ic_inf,
round(100*((p + z*z/(2*n)) + z*sqrt(p*(1-p)/n + z*z/(4*n*n))) / (1 + z*z/n), 1) as ic_sup
```

Duas taxas só diferem de forma defensável se os intervalos **não se sobrepõem**.

## Proibido nestas consultas

Qualquer função com efeito colateral chamada por `SELECT` (RPCs como `claim_*`, `whatsapp_get_or_create_roulette_client`, `daily_goal_reserve_wallet_slots`, `set_daily_goal_quota`, `nextval`, `set_config`, `pg_*` administrativas), `net.*`, `cron.*`, e qualquer `INSERT/UPDATE/DELETE/ALTER/CREATE/DROP/TRUNCATE/COPY`.
