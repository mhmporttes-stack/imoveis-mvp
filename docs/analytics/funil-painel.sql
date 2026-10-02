-- FUNIL-PAINEL (canônica) — replica getPerformanceOverview/computeCumulativeFunnel (lib/performance-overview.js).
-- Etapas 1–6: cumulativas (rk >= N, MET-3/MET-4). VENDA: MET-12 (regra oficial 2026-10-02) — cliente da
-- coorte cuja PRIMEIRA entrada em qualquer status de venda (client_status_history) cai no período; sem
-- histórico de venda e status atual de venda = data de criação (buildFirstSaleEntries/countFirstSalesInRange).
-- Mudança de subetapa (Conformidade, Pagamento, Pago...) NÃO é venda nova.
-- SOMENTE LEITURA: uma única instrução WITH ... SELECT. Troque só os dois timestamps em `params`
-- (meia-noite de São Paulo; fim EXCLUSIVO). Ver docs/METRICAS_FUNIL.md.
with params as (
  select timestamptz '2026-09-28 00:00:00-03' as ini, timestamptz '2026-10-02 00:00:00-03' as fim
),
stage_of(status, rk) as (values
  ('in_service',1),
  ('completed',2),('simulation_sent',2),
  ('documentation_pending',3),('documents_pending',3),
  ('approval_pending',4),('income_commitment',4),('cancellation_letter',4),('research_mo',4),('restriction',4),('shielding',4),('rejected',4),
  ('approved',5),
  ('meeting_pending',6),('meeting_done',6),
  ('sale_completed',7),('sale_forms',7),('sale_reservation',7),('sale_compliance',7),('sale_contract',7),
  ('sale_caixa_signature',7),('sale_itbi',7),('sale_registry',7),('sale_payment',7),('sale_paid',7)
),
coorte as (
  select r.id client_id from simulation_registrations r, params p where r.created_at >= p.ini and r.created_at < p.fim
  union
  select h.client_id from client_status_history h join stage_of s on s.status = h.new_status, params p
    where h.changed_at >= p.ini and h.changed_at < p.fim
  union
  select ph.registration_id from prospecting_history ph, params p
    where ph.event_type in ('claimed','prospecting_started') and coalesce(ph.details->>'source','') <> 'daily_goal'
      and ph.registration_id is not null and ph.created_at >= p.ini and ph.created_at < p.fim
  union
  select a.client_id from daily_goal_attempts a, params p
    where a.client_id is not null and a.created_at >= p.ini and a.created_at < p.fim
),
primeira_venda as (
  select c.client_id,
    coalesce(
      (select min(h.changed_at) from client_status_history h join stage_of s on s.status = h.new_status
        where h.client_id = c.client_id and s.rk = 7),
      case when exists (select 1 from stage_of s where s.status = r.status and s.rk = 7) then r.created_at end
    ) as em
  from coorte c join simulation_registrations r on r.id = c.client_id
),
rk_cliente as (
  select c.client_id,
    greatest(
      coalesce((select s.rk from stage_of s where s.status = r.status), 0),
      coalesce((select max(s.rk) from client_status_history h join stage_of s on s.status = h.new_status where h.client_id = c.client_id), 0),
      case when r.direct_broker_link then 1 else 0 end
    ) rk
  from coorte c join simulation_registrations r on r.id = c.client_id
)
select count(*) as prospeccao_base,
  count(*) filter (where rk >= 1) as atendimento,
  count(*) filter (where rk >= 2) as simulacao,
  count(*) filter (where rk >= 3) as documentacao,
  count(*) filter (where rk >= 4) as aprovacao,
  count(*) filter (where rk >= 5) as aprovado,
  count(*) filter (where rk >= 6) as reuniao,
  count(*) filter (where rk >= 7) as venda_etapa_alcancada,
  (select count(*) from primeira_venda v, params p where v.em >= p.ini and v.em < p.fim) as venda
from rk_cliente
