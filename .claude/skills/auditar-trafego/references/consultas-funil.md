# Consultas canônicas (somente leitura) — Gestor de Tráfego

Todas validadas contra produção em 2026-10-01. Execute com `mcp__Supabase__execute_sql` (projeto `tshhasbbchjcvhoyizoo`), **uma instrução `SELECT`/`WITH` por chamada**. Ajuste só o bloco `params` (nível e período). Datas: `meta_ad_insights.date` está no fuso da conta de anúncios (`America/Los_Angeles`); cadastro do cliente é convertido para `America/Sao_Paulo` — diferença de até 1 dia nas bordas do período, aceitável para análise.

## Q0 — Estado dos dados (sempre primeiro)

```sql
select a.ad_account_id, a.currency, a.timezone_name, a.last_synced_at,
  s.backfill_status, s.backfill_completed_through, s.last_intraday_sync_at, s.last_intraday_status,
  s.last_daily_consolidation_at, s.last_daily_status,
  (select min(date) from meta_ad_insights) primeiro_dia, (select max(date) from meta_ad_insights) ultimo_dia,
  (select count(distinct date) from meta_ad_insights) dias_com_dado,
  (select jsonb_object_agg(entity_type, n) from (select entity_type, count(*) n from meta_ad_entities group by 1) t) entidades
from meta_ad_accounts a left join meta_ad_sync_state s on s.ad_account_id = a.ad_account_id
```

## Q1 — Desempenho Meta por nível (campaign | adset | ad)

Métricas não aditivas recalculadas a partir das somas. `freq_max_dia` = maior frequência diária (a frequência do período inteiro não é somável).

```sql
with params as (select 'ad'::text lvl, date '2026-09-01' d_from, date '2026-09-30' d_to)
select e.name, i.entity_id, max(e.status) status, max(p2.name) pai,
  round(sum(i.spend)::numeric,2) investimento, sum(i.impressions) impressoes, sum(i.clicks) cliques,
  sum(i.landing_page_views) visitas_pagina, sum(i.leads) leads_meta,
  round((sum(i.spend)/nullif(sum(i.impressions),0)*1000)::numeric,2) cpm,
  round((sum(i.clicks)::numeric/nullif(sum(i.impressions),0)*100)::numeric,2) ctr_pct,
  round((sum(i.spend)/nullif(sum(i.clicks),0))::numeric,2) cpc,
  round((sum(i.spend)/nullif(sum(i.leads),0))::numeric,2) custo_lead_meta,
  round(max(i.frequency)::numeric,2) freq_max_dia,
  count(distinct i.date) dias_ativos, min(i.date) primeiro, max(i.date) ultimo
from meta_ad_insights i join params p on i.entity_type=p.lvl and i.date between p.d_from and p.d_to
left join meta_ad_entities e on e.entity_type=i.entity_type and e.entity_id=i.entity_id
left join meta_ad_entities p2 on p2.entity_id=e.parent_id
group by 1,2 order by investimento desc
```

## Q2 — Funil CRM por campanha/conjunto/anúncio (o diferencial)

Atribuição (ver `regras-decisao.md` §Atribuição): cliente com `client_origins.source_metadata` contendo `ad_id`/`adset_id`/`campaign_id` (anúncio de WhatsApp) **ou** UTM paga (`utm_campaign` = ID da campanha, `utm_term` = ID do conjunto, `utm_content` = ID do anúncio — convenção dos links pagos atuais). Etapa = a **mais avançada já alcançada** (histórico + status atual + venda em `financial_sales` não cancelada), espelhando `CLIENT_FUNNEL_STAGES` de `lib/client-status.js`: 1 atendimento, 2 simulação, 3 documentação, 4 aprovação enviada (inclui restrição/reprovado), 5 aprovado, 6 reunião, 7 venda. Se `lib/client-status.js` mudar, atualize o `stage_of` abaixo.

```sql
with params as (select 'campaign'::text lvl, date '2026-09-01' d_from, date '2026-09-30' d_to),
stage_of(status, rank) as (values
 ('in_service',1),('completed',2),('simulation_sent',2),('documentation_pending',3),('documents_pending',3),
 ('approval_pending',4),('income_commitment',4),('cancellation_letter',4),('research_mo',4),('restriction',4),('shielding',4),('rejected',4),
 ('approved',5),('meeting_pending',6),('meeting_done',6),
 ('sale_completed',7),('sale_forms',7),('sale_reservation',7),('sale_contract',7),('sale_caixa_signature',7),('sale_itbi',7),('sale_registry',7),('sale_payment',7)),
attributed as (
  select r.id client_id, r.status,
    coalesce(o.source_metadata->>'ad_id', case when o.source_metadata->>'utm_medium' in ('paid','cpc','ppc','paid_social') then o.source_metadata->>'utm_content' end) ad_id,
    coalesce(o.source_metadata->>'adset_id', case when o.source_metadata->>'utm_medium' in ('paid','cpc','ppc','paid_social') then o.source_metadata->>'utm_term' end) adset_id,
    coalesce(o.source_metadata->>'campaign_id', case when o.source_metadata->>'utm_medium' in ('paid','cpc','ppc','paid_social') then o.source_metadata->>'utm_campaign' end) campaign_id
  from simulation_registrations r join client_origins o on o.client_id = r.id cross join params p
  where (r.created_at at time zone 'America/Sao_Paulo')::date between p.d_from and p.d_to
    and ((o.source_metadata ? 'ad_id') or o.source_metadata->>'utm_medium' in ('paid','cpc','ppc','paid_social'))
),
resolved as (
  select a.client_id, a.status,
    case p.lvl when 'ad' then a.ad_id
               when 'adset' then coalesce(a.adset_id, ad.parent_id)
               else coalesce(a.campaign_id, ast.parent_id) end as entity_id
  from attributed a cross join params p
  left join meta_ad_entities ad on ad.entity_type='ad' and ad.entity_id=a.ad_id
  left join meta_ad_entities ast on ast.entity_type='adset' and ast.entity_id=coalesce(a.adset_id, ad.parent_id)
),
reached as (
  select x.*, greatest(
    coalesce((select max(s.rank) from client_status_history h join stage_of s on s.status=h.new_status where h.client_id=x.client_id),0),
    coalesce((select s.rank from stage_of s where s.status=x.status),0),
    case when exists (select 1 from financial_sales f where f.client_id=x.client_id and coalesce(f.financial_status,'')<>'cancelado') then 7 else 0 end) max_rank
  from resolved x
),
crm as (
  select entity_id, count(*) clientes,
    count(*) filter (where max_rank>=1) atendimento, count(*) filter (where max_rank>=2) simulacao,
    count(*) filter (where max_rank>=3) documentacao, count(*) filter (where max_rank>=4) aprovacao_enviada,
    count(*) filter (where max_rank>=5) aprovado, count(*) filter (where max_rank>=6) reuniao, count(*) filter (where max_rank>=7) venda,
    count(*) filter (where status in ('do_not_contact','archived')) perdidos
  from reached group by 1
),
spend as (
  select i.entity_id, sum(i.spend) spend, sum(i.leads) leads_meta
  from meta_ad_insights i join params p on i.entity_type=p.lvl and i.date between p.d_from and p.d_to group by 1
)
select coalesce(e.name, '(não sincronizado)') nome, coalesce(s.entity_id, c.entity_id) id,
  round(coalesce(s.spend,0)::numeric,2) investimento, coalesce(s.leads_meta,0) leads_meta,
  coalesce(c.clientes,0) clientes_crm, c.atendimento, c.simulacao, c.documentacao, c.aprovacao_enviada, c.aprovado, c.reuniao, c.venda, c.perdidos,
  round((s.spend/nullif(c.clientes,0))::numeric,2) custo_cliente,
  round((s.spend/nullif(c.simulacao,0))::numeric,2) custo_simulacao,
  round((s.spend/nullif(c.documentacao,0))::numeric,2) custo_documentacao,
  round((s.spend/nullif(c.aprovacao_enviada,0))::numeric,2) custo_aprovacao_enviada,
  round((s.spend/nullif(c.venda,0))::numeric,2) custo_venda
from spend s full join crm c on c.entity_id = s.entity_id
left join meta_ad_entities e on e.entity_id = coalesce(s.entity_id, c.entity_id)
order by investimento desc
```

Leitura: linha com investimento e `clientes_crm = 0` = gasto sem cliente atribuído (desperdício ou lacuna de rastreamento — ver §Atribuição). Linha `(não sincronizado)` = cliente veio de anúncio que ainda não está em `meta_ad_entities`.

## Q3 — Tendência semana a semana (fadiga, leilão)

```sql
with params as (select 'campaign'::text lvl, date '2026-09-01' d_from, date '2026-09-30' d_to),
w as (
  select i.entity_id, date_trunc('week', i.date)::date semana,
    sum(i.spend) spend, sum(i.impressions) imp, sum(i.clicks) clk, sum(i.leads) leads, max(i.frequency) freq_max
  from meta_ad_insights i join params p on i.entity_type=p.lvl and i.date between p.d_from and p.d_to
  group by 1,2
)
select e.name, w.semana, round(w.spend::numeric,2) investimento,
  round((w.spend/nullif(w.imp,0)*1000)::numeric,2) cpm,
  round((w.clk::numeric/nullif(w.imp,0)*100)::numeric,2) ctr_pct,
  round((w.spend/nullif(w.clk,0))::numeric,2) cpc, w.leads leads_meta, round(w.freq_max::numeric,2) freq_max_dia,
  round(((w.clk::numeric/nullif(w.imp,0)) / nullif(lag(w.clk::numeric/nullif(w.imp,0)) over (partition by w.entity_id order by w.semana),0) - 1)*100,1) var_ctr_pct,
  round(((w.spend/nullif(w.imp,0)) / nullif(lag(w.spend/nullif(w.imp,0)) over (partition by w.entity_id order by w.semana),0) - 1)*100,1) var_cpm_pct
from w left join meta_ad_entities e on e.entity_id=w.entity_id
order by e.name, w.semana
```

## Q4 — Auditoria de segmentação dos conjuntos

```sql
select a.name conjunto, c.name campanha, c.objective, a.status,
  a.targeting->'geo_locations' geo, a.targeting->>'age_min' idade_min, a.targeting->>'age_max' idade_max,
  a.targeting->'genders' generos, (a.targeting ? 'flexible_spec') tem_interesses,
  a.targeting->'targeting_automation' expansao_automatica, a.targeting->'publisher_platforms' plataformas
from meta_ad_entities a
left join meta_ad_entities c on c.entity_type='campaign' and c.entity_id=a.parent_id
where a.entity_type='adset'
order by (a.status in ('ACTIVE')) desc, c.name
```

Campos de campanha disponíveis hoje: só `id`, `name`, `objective`, `status`, `effective_status` — **`special_ad_categories`, orçamento, datas e lance NÃO são sincronizados** (não dá para auditar por aqui).

## Q5 — O que a Meta está contando como resultado

```sql
select a->>'action_type' tipo, sum((a->>'value')::numeric) total
from meta_ad_insights i, jsonb_array_elements(coalesce(i.actions_raw,'[]'::jsonb)) a
where i.entity_type='campaign' and i.entity_id = '<ID_DA_CAMPANHA>'
  and i.date between date '2026-09-01' and date '2026-09-30'
group by 1 order by 2 desc
```

`leads` em `meta_ad_insights` soma só `lead`, `onsite_conversion.lead_grouped`, `leadgen_grouped`. Campanha de **WhatsApp** aparece com `leads_meta = 0` — o resultado dela está em `onsite_conversion.messaging_conversation_started_7d` (conversas iniciadas); use Q5 e Q2 para avaliá-la.
