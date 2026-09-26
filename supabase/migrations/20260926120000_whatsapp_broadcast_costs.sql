-- Disparo: gastos, desempenho e campanhas no Chat.
-- (1) a Meta informa em cada evento de status se a mensagem é COBRADA e a categoria (pricing);
--     guardamos isso na linha do destinatário;
-- (2) tabela de preços por categoria (editável, em crm_settings);
-- (3) funções de leitura: chave de telefone, respostas ao disparo e relatório por campanha.
-- Idempotente. Não altera nenhuma regra de envio.

alter table public.whatsapp_broadcast_messages
  add column if not exists billable boolean,
  add column if not exists pricing_category text;

-- Preenche o que já existe a partir dos eventos de status guardados.
update public.whatsapp_broadcast_messages m
   set billable = e.is_billable,
       pricing_category = e.category
  from (
    select distinct on (message_id)
           message_id,
           (raw_payload->'status'->'pricing'->>'billable')::boolean as is_billable,
           lower(raw_payload->'status'->'pricing'->>'category') as category
      from public.whatsapp_master_events
     where direction = 'outbound'
       and raw_payload->'status'->'pricing' is not null
     order by message_id, event_at
  ) e
 where m.whatsapp_message_id = e.message_id
   and m.billable is null;

-- Preço por mensagem (R$) por categoria. Valores ESTIMADOS (faixas públicas da Meta no Brasil):
-- o dono ajusta na tela Disparo > Gastos conforme a fatura real.
insert into public.crm_settings (id, setting_value)
values ('whatsapp_pricing', jsonb_build_object(
  'currency', 'BRL',
  'estimated', true,
  'rates', jsonb_build_object('marketing', 0.35, 'utility', 0.05, 'authentication', 0.17, 'service', 0)
))
on conflict (id) do nothing;

-- Chave para comparar telefones em qualquer formato (com/sem +55, com/sem 9º dígito): DDD + últimos 8 dígitos.
create or replace function public.whatsapp_phone_key(p text)
returns text
language sql
immutable
as $$
  select case when length(d) < 10 then null else substr(d, 1, 2) || right(d, 8) end
  from (
    select case
             when length(regexp_replace(coalesce(p, ''), '\D', '', 'g')) > 11
              and regexp_replace(coalesce(p, ''), '\D', '', 'g') like '55%'
             then substr(regexp_replace(coalesce(p, ''), '\D', '', 'g'), 3)
             else regexp_replace(coalesce(p, ''), '\D', '', 'g')
           end as d
  ) x
$$;

-- Quem RESPONDEU a um disparo: 1ª mensagem recebida do contato até 7 dias depois do envio.
create or replace function public.whatsapp_broadcast_replies(p_broadcast_id uuid)
returns table (broadcast_message_id uuid, replied_at timestamptz, conversation_id uuid)
language sql
stable
security definer
set search_path = public
as $$
  select m.id, r.first_at, r.conversation_id
    from public.whatsapp_broadcast_messages m
    join lateral (
      select min(wm.message_at) as first_at, (array_agg(c.id order by wm.message_at))[1] as conversation_id
        from public.whatsapp_conversations c
        join public.whatsapp_messages wm on wm.conversation_id = c.id and wm.direction = 'inbound'
       where c.deleted_at is null
         and public.whatsapp_phone_key(c.contact_phone) = public.whatsapp_phone_key(m.phone_normalized)
         and wm.message_at > m.sent_at
         and wm.message_at <= m.sent_at + interval '7 days'
    ) r on r.first_at is not null
   where m.broadcast_id = p_broadcast_id
     and m.sent_at is not null
$$;

-- Relatório por campanha (uma linha por disparo): envios, cobrança por categoria, respostas, aberturas
-- do link e cadastros gerados pelo link.
create or replace function public.whatsapp_broadcast_report(p_ids uuid[] default null)
returns table (
  broadcast_id uuid,
  billable_marketing integer,
  billable_utility integer,
  billable_authentication integer,
  billable_service integer,
  replied integer,
  link_views integer,
  registrations integer
)
language sql
stable
security definer
set search_path = public
as $$
  select b.id,
         coalesce(bill.marketing, 0)::integer,
         coalesce(bill.utility, 0)::integer,
         coalesce(bill.authentication, 0)::integer,
         coalesce(bill.service, 0)::integer,
         coalesce(rep.replied, 0)::integer,
         coalesce(v.views, 0)::integer,
         coalesce(o.regs, 0)::integer
    from public.whatsapp_broadcasts b
    left join lateral (
      select count(*) filter (where cat = 'marketing') as marketing,
             count(*) filter (where cat = 'utility') as utility,
             count(*) filter (where cat = 'authentication') as authentication,
             count(*) filter (where cat = 'service') as service
        from (
          select lower(coalesce(m.pricing_category, b.template_category, 'marketing')) as cat
            from public.whatsapp_broadcast_messages m
           where m.broadcast_id = b.id
             and m.status in ('delivered', 'read')
             and coalesce(m.billable, true)
        ) x
    ) bill on true
    left join lateral (
      select count(*) as replied from public.whatsapp_broadcast_replies(b.id)
    ) rep on true
    left join lateral (
      select count(*) as views
        from public.campaign_link_views cv
       where cv.campaign_id = b.link_campaign_id
         and cv.created_at >= coalesce(b.started_at, b.created_at)
    ) v on b.link_campaign_id is not null
    left join lateral (
      select count(distinct co.client_id) as regs
        from public.client_origins co
       where co.campaign_id = b.link_campaign_id
         and co.created_at >= coalesce(b.started_at, b.created_at)
    ) o on b.link_campaign_id is not null
   where p_ids is null or b.id = any(p_ids)
$$;

revoke all on function public.whatsapp_phone_key(text) from public, anon, authenticated;
revoke all on function public.whatsapp_broadcast_replies(uuid) from public, anon, authenticated;
revoke all on function public.whatsapp_broadcast_report(uuid[]) from public, anon, authenticated;
grant execute on function public.whatsapp_phone_key(text) to service_role;
grant execute on function public.whatsapp_broadcast_replies(uuid) to service_role;
grant execute on function public.whatsapp_broadcast_report(uuid[]) to service_role;
