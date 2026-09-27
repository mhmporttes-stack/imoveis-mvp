-- REGRA OBRIGATÓRIA DOS DISPAROS: contato sem nome de verdade nunca pode ser sorteado numa campanha. Nunca
-- inventamos/preenchemos nome — só filtramos quem não tem um usável (null, vazio, só espaço, ou um placeholder como
-- "Sem Nome", ".", "-", "teste"). Mesma regra do lado do servidor em lib/contact-name.mjs (isUsableContactName).
--
-- Aditiva: 1 função nova + o sorteio (pick_broadcast_base_contacts) passa a exigir nome usável nos dois grupos.

create or replace function public.is_usable_contact_name(p_name text)
returns boolean
language sql
immutable
set search_path = public
as $$
  select p_name is not null
    and length(trim(p_name)) >= 2
    and p_name ~ '[[:alpha:]]'  -- tem pelo menos uma letra (não é só dígito/pontuação, ex.: ".", "-", telefone digitado)
    and lower(trim(regexp_replace(p_name, '\s+', ' ', 'g'))) not in (
      'sem nome', 'sem-nome', 'semnome', 'desconhecido', 'desconhecida', 'nao informado', 'não informado',
      'n/a', 'na', 'cliente', 'teste', 'test', 'cliente whatsapp', 'usuario', 'usuário', 'anonimo', 'anônimo'
    );
$$;

revoke all on function public.is_usable_contact_name(text) from public, anon, authenticated;
grant execute on function public.is_usable_contact_name(text) to service_role;

create or replace function public.pick_broadcast_base_contacts(
  p_limit integer,
  p_min_days integer default 60,
  p_free_owner_ids uuid[] default '{}'
)
returns table (contact_id uuid, name text, phone text, tier integer, last_contact_at timestamptz)
language plpgsql
set search_path = public
as $$
declare
  v_limit integer := greatest(coalesce(p_limit, 0), 0);
  v_got integer := 0;
begin
  if v_limit = 0 then
    return;
  end if;

  return query
  select p.id, p.name, p.phone_normalized, 1, null::timestamptz
  from prospecting_contacts p
  where p.owner_user_id is null
    and p.status = 'available'
    and p.registration_id is null
    and p.last_attempt_at is null
    and coalesce(p.phone_normalized, '') <> ''
    and is_usable_contact_name(p.name)
    and not exists (select 1 from whatsapp_broadcast_messages b where b.phone_normalized = p.phone_normalized)
    and not exists (select 1 from simulation_registrations r where r.phone_normalized = p.phone_normalized)
    and not exists (select 1 from whatsapp_conversations c where c.contact_phone = p.phone_normalized and c.deleted_at is null)
  order by random()
  limit v_limit;
  get diagnostics v_got = row_count;

  if v_got >= v_limit then
    return;
  end if;

  return query
  with candidates as (
    select p.id, p.name, p.phone_normalized as phone,
      greatest(
        p.last_attempt_at,
        (select max(coalesce(b.sent_at, b.queued_at)) from whatsapp_broadcast_messages b where b.phone_normalized = p.phone_normalized),
        (select max(c.last_message_at) from whatsapp_conversations c where c.contact_phone = p.phone_normalized and c.deleted_at is null),
        (select max(coalesce(r.last_whatsapp_contact_at, r.updated_at)) from simulation_registrations r where r.phone_normalized = p.phone_normalized)
      ) as last_contact
    from prospecting_contacts p
    where p.owner_user_id is null
      and (p.status = 'available' or (p.status = 'recent_attempt' and (p.available_after is null or p.available_after <= now())))
      and coalesce(p.phone_normalized, '') <> ''
      and is_usable_contact_name(p.name)
      and not (p.registration_id is null and p.last_attempt_at is null
               and not exists (select 1 from whatsapp_broadcast_messages b where b.phone_normalized = p.phone_normalized)
               and not exists (select 1 from simulation_registrations r where r.phone_normalized = p.phone_normalized)
               and not exists (select 1 from whatsapp_conversations c where c.contact_phone = p.phone_normalized and c.deleted_at is null))
      and not exists (
        select 1 from simulation_registrations r
        where r.phone_normalized = p.phone_normalized
          and (r.status in ('do_not_contact', 'sale_completed')
               or (r.responsible_user_id is not null and not (r.responsible_user_id = any (p_free_owner_ids))))
      )
  )
  select c.id, c.name, c.phone, 2, c.last_contact
  from candidates c
  where c.last_contact is null or c.last_contact < now() - make_interval(days => greatest(coalesce(p_min_days, 60), 0))
  order by c.last_contact asc nulls first, random()
  limit (v_limit - v_got);
end;
$$;

revoke all on function public.pick_broadcast_base_contacts(integer, integer, uuid[]) from public, anon, authenticated;
grant execute on function public.pick_broadcast_base_contacts(integer, integer, uuid[]) to service_role;
