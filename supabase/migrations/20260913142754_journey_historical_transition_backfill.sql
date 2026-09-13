-- Reconstruct a previous/current transition only when the latest recorded
-- Filename version matches the applied Supabase migration.
-- status event agrees with the current CRM status. Never use migration time.
with transitions as (
 select j.client_id, h.previous_status, h.changed_at,
 least(j.progress,greatest(
   coalesce((s.setting_value->h.previous_status->>'progress')::integer,0),
   coalesce((select max((s.setting_value->p.new_status->>'progress')::integer)
     from public.client_status_history p where p.client_id=j.client_id and p.changed_at<h.changed_at),0)
 )) as previous_progress
 from public.client_journeys j
 join public.simulation_registrations r on r.id=j.client_id
 cross join public.crm_settings s
 join lateral (
   select previous_status,new_status,changed_at from public.client_status_history
   where client_id=j.client_id order by changed_at desc,id desc limit 1
 ) h on h.new_status=r.status
 where s.id='client_journey_statuses' and j.changed_at is null and j.version=1
 and not exists(select 1 from public.client_journey_events e where e.client_id=j.client_id)
)
update public.client_journeys j set previous_status=t.previous_status,
 previous_progress=t.previous_progress,changed_at=t.changed_at
from transitions t where j.client_id=t.client_id;
