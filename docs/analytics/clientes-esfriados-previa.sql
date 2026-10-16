-- Prévia do fluxo de clientes que esfriaram (dono, 2026-10-16): quantos casos seriam ABERTOS ao ligar o fluxo,
-- por responsável (quem recebe a janela obrigatória) e por decisora. Somente leitura. Reproduz a regra de
-- lib/cooled-clients-core.mjs (isCooledCandidate) — a fonte de verdade é o código; no servidor,
-- runCooledClientsFlow({ dryRun: true }) (lib/cooled-clients.js) devolve a mesma contagem.
-- Diferença conhecida: aqui "admin geral" = role 'admin'; o código também exclui os e-mails do dono (OWNER_ADMIN_EMAILS).
with users as (
  select id, name, role, status, manager_id, linked_broker_id from public.admin_users
), eligible as (
  select * from users where status = 'active' and role in ('broker', 'associate', 'manager')
), cal as (
  select client_id, max(scheduled_at) as latest from public.calendar_activities where status = 'pending' group by client_id
), base as (
  select sr.id, sr.status, sr.responsible_user_id,
    greatest(coalesce(case when sr.scheduled_activity_completed_at is null then sr.scheduled_activity_at end, '-infinity'::timestamptz),
             coalesce(cal.latest, '-infinity'::timestamptz)) as latest_activity,
    case when sr.status = 'awaiting_return' and sr.last_status_change_at is not null
      then greatest(coalesce(sr.last_whatsapp_contact_at, sr.created_at), sr.last_status_change_at)
      else coalesce(sr.last_whatsapp_contact_at, sr.created_at) end as ref_at
  from public.simulation_registrations sr
  join eligible e on e.id = sr.responsible_user_id
  left join cal on cal.client_id = sr.id
  where sr.private_contact_at is null
    and (sr.responsible_changed_at is null or sr.responsible_changed_at <= now() - interval '3 days')
    and sr.status in ('automated_service','pending','completed','simulation_sent','in_service','awaiting_return',
                      'documentation_pending','documents_pending','approval_pending','shielding','approved',
                      'meeting_pending','meeting_done')
), cases as (
  select b.* from base b
  where b.latest_activity <= now()
    and b.ref_at < now() - interval '3 days'
    and (b.status <> 'awaiting_return' or exists (
      select 1 from public.client_status_history h
      where h.client_id = b.id
        and ((h.new_status is not null and h.new_status <> 'awaiting_return')
          or (h.previous_status is not null and h.previous_status <> 'awaiting_return'))))
), with_decider as (
  select c.*, r.name as responsavel, r.role,
    case
      when r.role = 'manager' then 'Dono'
      else coalesce((select m.name from users m
                     where m.id = (case when r.role = 'associate' then (select b2.manager_id from users b2 where b2.id = r.linked_broker_id) else r.manager_id end)
                       and m.role = 'manager' and m.status = 'active'), 'Dono')
    end as decisora
  from cases c join users r on r.id = c.responsible_user_id
)
select 'responsavel' as grupo, responsavel as pessoa, count(*) as casos from with_decider group by responsavel
union all
select 'decisora', decisora, count(*) from with_decider group by decisora
order by grupo, casos desc;
