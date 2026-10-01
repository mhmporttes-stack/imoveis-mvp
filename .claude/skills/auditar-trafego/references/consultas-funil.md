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

Atribuição (ver `regras-decisao.md` §Atribuição): cliente com `client_origins.source_metadata` contendo `ad_id`/`adset_id`/`campaign_id` (anúncio de WhatsApp) **ou** mídia paga identificada — UTM paga no padrão atual (`utm_medium=paid`, `utm_campaign` = ID da campanha, `utm_term` = ID do conjunto, `utm_content` = ID do anúncio), formato `utm_medium=anuncio` (inclui `utm_campaign=ctwa_formulario` do Fluxo "Anúncio WhatsApp — formulário direto": desde 2026-10-01 o link leva `utm_content=<ID do anúncio>` quando o clique trouxe o ID; nos cadastros anteriores o anúncio é buscado no `referral` da conversa pelo telefone; se a mesma pessoa já tem card de anúncio de WhatsApp, não conta de novo), ou `paid_media=true` gravado pelo cadastro (desde 2026-10-01). Etapa = a **mais avançada já alcançada** (histórico + status atual + venda em `financial_sales` não cancelada), espelhando `CLIENT_FUNNEL_STAGES` de `lib/client-status.js`: 1 atendimento, 2 simulação, 3 documentação, 4 aprovação enviada (inclui restrição/reprovado), 5 aprovado, 6 reunião, 7 venda. Se `lib/client-status.js` mudar, atualize o `stage_of` abaixo.

```sql
with params as (select 'campaign'::text lvl, date '2026-09-01' d_from, date '2026-09-30' d_to),
stage_of(status, rank) as (values
 ('in_service',1),('completed',2),('simulation_sent',2),('documentation_pending',3),('documents_pending',3),
 ('approval_pending',4),('income_commitment',4),('cancellation_letter',4),('research_mo',4),('restriction',4),('shielding',4),('rejected',4),
 ('approved',5),('meeting_pending',6),('meeting_done',6),
 ('sale_completed',7),('sale_forms',7),('sale_reservation',7),('sale_contract',7),('sale_caixa_signature',7),('sale_itbi',7),('sale_registry',7),('sale_payment',7)),
base as (
  select r.id client_id, r.status, o.source_metadata m,
    right(regexp_replace(coalesce(r.phone_normalized,''),'\D','','g'),8) tel8,
    (lower(coalesce(o.source_metadata->>'utm_medium','')) in ('cpc','ppc','paid','paid_social','paid_search','anuncio','anúncio') or (o.source_metadata->>'paid_media')='true') paga
  from simulation_registrations r join client_origins o on o.client_id = r.id cross join params p
  where (r.created_at at time zone 'America/Sao_Paulo')::date between p.d_from and p.d_to
),
attributed as (
  select b.client_id, b.status,
    coalesce(b.m->>'ad_id', case when b.paga then b.m->>'utm_content' end,
      case when b.m->>'utm_campaign'='ctwa_formulario' then (select c.origin->'referral'->>'source_id' from whatsapp_conversations c
        where c.origin->'referral'->>'source_type'='ad' and right(regexp_replace(c.contact_phone,'\D','','g'),8)=b.tel8 limit 1) end) ad_id,
    coalesce(b.m->>'adset_id', case when b.paga then b.m->>'utm_term' end) adset_id,
    coalesce(b.m->>'campaign_id', case when b.paga and b.m->>'utm_campaign' ~ '^[0-9]+$' then b.m->>'utm_campaign' end) campaign_id
  from base b
  where ((b.m ? 'ad_id') or b.paga)
    -- formulário do anúncio de WhatsApp de quem JÁ tem card de anúncio de WhatsApp: não contar a mesma pessoa duas vezes
    and not (b.m->>'utm_campaign'='ctwa_formulario' and exists (select 1 from simulation_registrations r2 join client_origins o2 on o2.client_id=r2.id
      where r2.id<>b.client_id and o2.source_kind='whatsapp_ad' and right(regexp_replace(coalesce(r2.phone_normalized,''),'\D','','g'),8)=b.tel8))
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
select case when coalesce(s.entity_id, c.entity_id) is null then '(mídia paga sem anúncio identificado)' else coalesce(e.name, '(não sincronizado)') end nome, coalesce(s.entity_id, c.entity_id) id,
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

Leitura: `(mídia paga sem anúncio identificado)` = pago comprovado, mas sem como saber qual anúncio. Linha com investimento e `clientes_crm = 0` = gasto sem cliente atribuído (desperdício ou lacuna de rastreamento — ver §Atribuição). Linha `(não sincronizado)` = cliente veio de anúncio que ainda não está em `meta_ad_entities`.

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

Colunas de `meta_ad_entities`: `entity_id`, `name`, `status` (já guarda o status efetivo, ex.: `CAMPAIGN_PAUSED`), `objective`, `targeting` (conjuntos), `parent_id`, `raw`. Não existe coluna `effective_status`. **`special_ad_categories`, orçamento, datas e lance NÃO são sincronizados** (não dá para auditar por aqui).

## Q5 — O que a Meta está contando como resultado

```sql
select a->>'action_type' tipo, sum((a->>'value')::numeric) total
from meta_ad_insights i, jsonb_array_elements(coalesce(i.actions_raw,'[]'::jsonb)) a
where i.entity_type='campaign' and i.entity_id = '<ID_DA_CAMPANHA>'
  and i.date between date '2026-09-01' and date '2026-09-30'
group by 1 order by 2 desc
```

`leads` em `meta_ad_insights` soma só `lead`, `onsite_conversion.lead_grouped`, `leadgen_grouped`. Campanha de **WhatsApp** aparece com `leads_meta = 0` — o resultado dela está em `onsite_conversion.messaging_conversation_started_7d` (conversas iniciadas); use Q5 e Q2 para avaliá-la.

## Q6 — Diagnóstico de atribuição (como cada cadastro chegou)

Classifica os cadastros do período em **1. Anúncio de WhatsApp**, **2. Mídia paga identificada**, **3. Sem rastreio** (rótulo de pago, mas sem nenhuma UTM — não atribuir) e **4. Sem atribuição a mídia paga** (orgânico, link pessoal, manual/prospecção, etc.), com detalhe de qual evidência sustentou a classificação. Use para medir a qualidade do rastreamento e antes de concluir "anúncio sem cliente". Nunca altera origem: é só leitura.

```sql
with params as (select date '2026-09-01' d_from, date '2026-09-30' d_to),
base as (
  select r.id client_id, r.status, o.source_kind, o.source_label, o.source_metadata m,
    right(regexp_replace(coalesce(r.phone_normalized,''),'\D','','g'),8) tel8
  from simulation_registrations r join client_origins o on o.client_id=r.id cross join params p
  where (r.created_at at time zone 'America/Sao_Paulo')::date between p.d_from and p.d_to
),
ev as (
  select b.*,
    lower(coalesce(b.m->>'utm_medium','')) medium,
    (lower(coalesce(b.m->>'utm_medium','')) in ('cpc','ppc','paid','paid_social','paid_search','anuncio','anúncio') or (b.m->>'paid_media')='true') paga,
    exists (select 1 from meta_ad_entities e where e.entity_type='campaign' and e.entity_id=b.m->>'utm_campaign') utm_casa_meta,
    exists (select 1 from meta_ad_entities e where e.entity_type='ad' and e.entity_id=b.m->>'ad_id') anuncio_sincronizado,
    (select c.origin->'referral'->>'source_id' from whatsapp_conversations c
      where b.m->>'utm_campaign'='ctwa_formulario' and c.origin->'referral'->>'source_type'='ad'
        and right(regexp_replace(c.contact_phone,'\D','','g'),8)=b.tel8 limit 1) ad_conversa,
    exists (select 1 from simulation_registrations r2 join client_origins o2 on o2.client_id=r2.id
      where r2.id<>b.client_id and o2.source_kind='whatsapp_ad' and right(regexp_replace(coalesce(r2.phone_normalized,''),'\D','','g'),8)=b.tel8) mesma_pessoa_ja_whatsapp_ad
  from base b
)
select
  case when m ? 'ad_id' then '1. Anúncio de WhatsApp'
       when paga then '2. Mídia paga identificada'
       when source_label ilike '%patroc%' then '3. Sem rastreio (rótulo de pago, sem UTM)'
       else '4. Sem atribuição a mídia paga' end categoria,
  case when m ? 'ad_id' and anuncio_sincronizado then 'ID do anúncio (anúncio sincronizado)'
       when m ? 'ad_id' then 'ID do anúncio (anúncio ainda não sincronizado da Meta)'
       when paga and utm_casa_meta then 'UTM com IDs da Meta (padrão atual)'
       when paga and m->>'utm_campaign'='ctwa_formulario' and m->>'utm_content' ~ '^[0-9]+$' then 'Formulário do anúncio de WhatsApp — ID do anúncio no link (desde 2026-10-01)'
       when paga and m->>'utm_campaign'='ctwa_formulario' and ad_conversa is not null and mesma_pessoa_ja_whatsapp_ad then 'Formulário do anúncio de WhatsApp — anúncio pela conversa; pessoa já contada como anúncio de WhatsApp'
       when paga and m->>'utm_campaign'='ctwa_formulario' and ad_conversa is not null then 'Formulário do anúncio de WhatsApp — anúncio identificado pela conversa'
       when paga and m->>'utm_campaign'='ctwa_formulario' then 'Formulário do anúncio de WhatsApp — sem conversa para identificar o anúncio'
       when paga then 'UTM paga sem ID reconhecido'
       when m ? 'utm_source' then 'UTM não paga (' || coalesce(m->>'utm_source','?') || '/' || coalesce(nullif(medium,''),'sem medium') || ')'
       else 'Sem UTM — ' || source_kind end detalhe,
  count(*) cadastros,
  count(*) filter (where status not in ('pending','automated_service','awaiting_return','archived','do_not_contact')) avancaram_no_funil
from ev group by 1,2 order by 1, 3 desc
```

Resultado real (set/2026): 38 por anúncio de WhatsApp, 21 com UTM no padrão atual, 2 do formulário do anúncio de WhatsApp (1 sem conversa, 1 já contado), 2 "PATROCINADO" sem nenhuma UTM. Em "4." aparecem também cadastros manuais/importação de prospecção (milhares) — não são entrada de anúncio.
