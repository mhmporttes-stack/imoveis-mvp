-- Recover only the source type proved by the existing direct-link flag.
-- Filename version matches the applied Supabase migration.
-- The current responsible user is not necessarily the original recipient.
alter table public.client_origins disable trigger guard_original_source;
update public.client_origins o
set source_kind='broker_link',source_label='Link pessoal de corretor',
    initial_destination='broker',
    source_metadata=o.source_metadata || '{"evidence":"direct_broker_link"}'::jsonb
from public.simulation_registrations r
where o.client_id=r.id and o.source_kind='unknown'
  and r.direct_broker_link=true and r.acquisition_context is null;
alter table public.client_origins enable trigger guard_original_source;
