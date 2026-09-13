-- Older deployed clients may still write campaign attribution immediately
-- Filename version matches the applied Supabase migration.
-- after registration. Merge that evidence only into an unknown origin.
create or replace function public.guard_original_source() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if old.source_kind='unknown' and new.source_kind='campaign'
 and old.campaign_id is null and new.campaign_id is not null
 and exists(select 1 from public.campaigns c where c.id=new.campaign_id and c.name=new.campaign_name_snapshot)
 and exists(select 1 from public.simulation_registrations r where r.id=new.client_id and r.acquisition_context is null)
 then return new; end if;
 if (to_jsonb(new)-'campaign_id') is distinct from (to_jsonb(old)-'campaign_id')
 or (new.campaign_id is distinct from old.campaign_id and new.campaign_id is not null) then
  raise exception 'Original source is immutable';
 end if;
 return new;
end $$;
create or replace function public.merge_legacy_campaign_origin() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
 if new.campaign_id is not null then
  new.source_kind := 'campaign';
  new.source_label := new.campaign_name_snapshot;
  update public.client_origins set campaign_id=new.campaign_id,
    campaign_name_snapshot=new.campaign_name_snapshot,source_kind='campaign',source_label=new.campaign_name_snapshot
  where client_id=new.client_id and source_kind='unknown'
    and exists(select 1 from public.simulation_registrations r where r.id=new.client_id and r.acquisition_context is null);
  if found then return null; end if;
 end if;
 return new;
end $$;
drop trigger if exists merge_legacy_campaign_origin on public.client_origins;
create trigger merge_legacy_campaign_origin before insert on public.client_origins for each row execute function public.merge_legacy_campaign_origin();
