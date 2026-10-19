-- Análise diária da simulação automática do site × Caixa (SIM-AUTO, pedido do dono 2026-10-19).
-- SOMENTE LEITURA. Tabela: simulation_auto_reviews (migration 20261019190000). Período: troque as datas.
-- auto_snapshot  = o que o site calculou (inputs/outputs; outputs.novo/usado têm subsídio/entrada/poder).
-- corrected_snapshot = o que o corretor lançou da Caixa ao corrigir (novo/usado × price/sac + caixaIncome).

-- 1) Resumo do dia: quantas conferidas, OK, corrigidas, pendentes.
select date_trunc('day', coalesce(reviewed_at, created_at) at time zone 'America/Sao_Paulo')::date as dia,
       count(*) filter (where review_status = 'ok') as ok,
       count(*) filter (where review_status = 'corrected') as corrigidas,
       count(*) filter (where review_status in ('pending', 'correcting')) as pendentes
  from public.simulation_auto_reviews
 where created_at >= now() - interval '7 days'
 group by 1 order by 1 desc;

-- 2) Comparação por campo (corrigidas, imóvel novo, Price): erro absoluto e percentual.
with c as (
  select r.id, r.registration_id, r.reviewed_by_email, r.reviewed_at,
         (r.auto_snapshot #>> '{inputs,incomeConsidered}')::numeric as renda_site,
         (r.corrected_snapshot ->> 'caixaIncome')::numeric as renda_caixa,
         (r.auto_snapshot #>> '{outputs,financing}')::numeric as financiado_site,
         (r.corrected_snapshot #>> '{novo,price,financing}')::numeric as financiado_caixa,
         (r.auto_snapshot #>> '{outputs,novo,subsidy}')::numeric as subsidio_site,
         (r.corrected_snapshot #>> '{novo,price,subsidy}')::numeric as subsidio_caixa,
         (r.auto_snapshot #>> '{outputs,priceFirstInstallment}')::numeric as parcela_site,
         (r.corrected_snapshot #>> '{novo,price,firstInstallment}')::numeric as parcela_caixa,
         (r.auto_snapshot #>> '{outputs,usado,subsidy}')::numeric as subsidio_usado_site,
         (r.corrected_snapshot #>> '{usado,price,subsidy}')::numeric as subsidio_usado_caixa,
         (r.auto_snapshot #>> '{outputs,annualRate}')::numeric as taxa_site,
         (r.corrected_snapshot ->> 'annualRate')::numeric as taxa_caixa,
         (r.auto_snapshot #>> '{outputs,termMonths}')::int as prazo_site,
         (r.corrected_snapshot #>> '{novo,price,termMonths}')::int as prazo_caixa
    from public.simulation_auto_reviews r
   where r.review_status = 'corrected' and r.reviewed_at >= now() - interval '7 days'
)
select count(*) as casos,
       percentile_cont(0.5) within group (order by abs(financiado_site - financiado_caixa) / nullif(financiado_caixa, 0)) as fin_erro_mediano,
       percentile_cont(0.9) within group (order by abs(financiado_site - financiado_caixa) / nullif(financiado_caixa, 0)) as fin_erro_p90,
       percentile_cont(0.5) within group (order by abs(subsidio_site - subsidio_caixa)) as sub_erro_mediano_reais,
       percentile_cont(0.9) within group (order by abs(subsidio_site - subsidio_caixa)) as sub_erro_p90_reais,
       percentile_cont(0.5) within group (order by abs(parcela_site - parcela_caixa)) as parcela_erro_mediano_reais,
       count(*) filter (where renda_caixa is not null and abs(renda_caixa - renda_site) > 1) as renda_diferente
  from c;

-- 3) Casos divergentes (financiado > 2%, subsídio > R$ 500, parcela > R$ 5, taxa/prazo/renda diferentes).
with c as (
  select r.registration_id, s.client_code, r.reviewed_by_email, r.reviewed_at,
         r.auto_snapshot -> 'inputs' as entradas,
         (r.auto_snapshot #>> '{inputs,incomeConsidered}')::numeric as renda_site,
         (r.corrected_snapshot ->> 'caixaIncome')::numeric as renda_caixa,
         (r.auto_snapshot #>> '{outputs,financing}')::numeric as financiado_site,
         (r.corrected_snapshot #>> '{novo,price,financing}')::numeric as financiado_caixa,
         (r.auto_snapshot #>> '{outputs,novo,subsidy}')::numeric as subsidio_site,
         (r.corrected_snapshot #>> '{novo,price,subsidy}')::numeric as subsidio_caixa,
         (r.auto_snapshot #>> '{outputs,priceFirstInstallment}')::numeric as parcela_site,
         (r.corrected_snapshot #>> '{novo,price,firstInstallment}')::numeric as parcela_caixa,
         (r.auto_snapshot #>> '{outputs,annualRate}')::numeric as taxa_site,
         (r.corrected_snapshot ->> 'annualRate')::numeric as taxa_caixa,
         (r.auto_snapshot #>> '{outputs,termMonths}')::int as prazo_site,
         (r.corrected_snapshot #>> '{novo,price,termMonths}')::int as prazo_caixa
    from public.simulation_auto_reviews r
    join public.simulation_registrations s on s.id = r.registration_id
   where r.review_status = 'corrected' and r.reviewed_at >= now() - interval '7 days'
)
select *
  from c
 where abs(financiado_site - financiado_caixa) > 0.02 * nullif(financiado_caixa, 0)
    or abs(subsidio_site - subsidio_caixa) > 500
    or abs(parcela_site - parcela_caixa) > 5
    or taxa_site is distinct from taxa_caixa
    or prazo_site is distinct from prazo_caixa
    or (renda_caixa is not null and abs(renda_caixa - renda_site) > 1)
 order by reviewed_at desc;
