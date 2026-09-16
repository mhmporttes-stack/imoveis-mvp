-- Corrige um efeito colateral descoberto ao testar a migration anterior
-- (20260917_link_generator_acquisition_history.sql) em produção: o trigger
-- legado merge_legacy_campaign_origin (criado em
-- 20260913140710_journey_origin_compatibility.sql, para reconciliar dados
-- ANTIGOS que já tinham campaign_id mas ainda estavam com source_kind=
-- 'unknown') forçava incondicionalmente source_kind='campaign' sempre que
-- campaign_id não era nulo — inclusive em inserts NOVOS e corretos com
-- source_kind='broker_link' (link oficial). Isso apagava, no banco, a
-- distinção Oficial x Personalizado que a correção anterior introduziu.
-- A regra agora só se aplica ao caso legado real: quando o kind que está
-- chegando já é 'unknown' (não foi possível classificar) — nunca sobrescreve
-- um kind já determinado corretamente (campaign, broker_link, roulette_link,
-- paid_link, tracked_link, site).
create or replace function public.merge_legacy_campaign_origin() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if new.campaign_id is not null and new.source_kind = 'unknown' then
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

-- Restaura, dentro da nova versão de guard_original_source (que já passou a
-- permitir client_id virar nulo), a exceção legada que permitia a
-- reconciliação acima passar pela guarda de imutabilidade — perdida ao
-- substituir a função na migration anterior.
create or replace function public.guard_original_source() returns trigger
language plpgsql set search_path=public,pg_temp as $$
begin
  if old.source_kind='unknown' and new.source_kind='campaign'
  and old.campaign_id is null and new.campaign_id is not null
  and exists(select 1 from public.campaigns c where c.id=new.campaign_id and c.name=new.campaign_name_snapshot)
  and exists(select 1 from public.simulation_registrations r where r.id=new.client_id and r.acquisition_context is null)
  then return new; end if;

  if (to_jsonb(new)-'campaign_id'-'client_id') is distinct from (to_jsonb(old)-'campaign_id'-'client_id')
  or (new.campaign_id is distinct from old.campaign_id and new.campaign_id is not null)
  or (new.client_id is distinct from old.client_id and new.client_id is not null) then
    raise exception 'Original source is immutable';
  end if;
  return new;
end $$;

-- (Nenhum backfill de linhas antigas é necessário: o bug acima só existiu na
-- janela entre a migration anterior e esta, sem tráfego real de produção
-- afetado — confirmado manualmente. Os únicos registros gravados errados
-- nessa janela foram dados de teste, removidos manualmente.)
