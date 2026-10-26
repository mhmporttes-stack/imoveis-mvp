-- [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-26] ROL-2j Trava até contatar.
-- "O corretor NÃO recebe nenhum cliente novo (roleta de leads novos, Marketplace e fila de clientes frios) enquanto tiver
-- um cliente recebido por distribuição ainda sem contato. Quando o prazo de 10 min vence sem contato, o cliente é
-- redistribuído e a trava sai."
--
-- Ponto central: roulette_user_extra_eligible (usado por pick_round_robin_broker e pela reserva assign_round_robin_lead —
-- formulário, Chat/contato direto, anúncio, fila de espera, REDISTRIBUIÇÃO, "Devolver para a roleta", Fluxos, Marketplace/
-- Messenger, SIM-AUTO-ENVIO) ganha roulette_contact_lock_ok. A fila de reativação (clientes frios, FUN-15l) e a contagem da
-- fila de espera usam a mesma função por roulette_contact_lock_ok_ids (listOnlineRouletteBrokerIds, lib/lead-distribution.js).
-- Travado = pulado sem perder o lugar (como offline/pausa ROL-2h); ninguém liberado -> o cliente espera na fila e vai
-- para o próximo que liberar (nada se perde).
--
-- Travado = existe cliente que:
--   (1) está com o corretor agora (responsible_user_id) e fora da fila de espera (pending_distribution_at nulo);
--   (2) chegou a ele pela DISTRIBUIÇÃO: o último registro de lead_distribution_history do cliente (assigned /
--       auto_transferred, sem toWaitingQueue/heldByOwner) é para ele e é da mesma troca de responsável (até 5 min do
--       responsible_changed_at) — transferência manual depois disso não trava;
--   (3) foi recebido depois que esta regra entrou (crm_settings roulette_contact_lock.since, gravado ao aplicar: não
--       retroativo) e há menos de roulette_contact_lock_max_age() (rede de segurança, 24 h — A CONFIRMAR com o dono);
--   (4) não está em status fora da roleta (negativos + venda concluída/paga = ROULETTE_INELIGIBLE_STATUSES,
--       lib/client-distribution-core.mjs; trava tests/roleta-trava-ate-contatar.test.mjs);
--   (5) não teve CONTATO desde o recebimento. Contato = a mesma régua do prazo da roleta/fila de reativação: mensagem
--       humana enviada ao cliente (whatsapp_conversations.last_human_reply_at, gravado só por registerHumanContact /
--       isHumanContactMessage — clique no botão do WhatsApp NÃO conta) ou, no Marketplace/Messenger, resposta humana
--       (marketplace_conversations.last_human_reply_at ou saída com sender_user_id, MKT-2e).
-- Sai sozinha quando o cliente é contatado, redistribuído (muda de responsável), vai para a fila de espera, muda para
-- status fora da roleta ou passa de 24 h.
--
-- NÃO aplicada automaticamente (DECISÃO NECESSÁRIA). Sem ela, o código JS segue como antes (RPC ausente = sem trava).
-- Idempotente; o único dado gravado é a marca de início (crm_settings), sem sobrescrever.

insert into public.crm_settings (id, setting_value)
values ('roulette_contact_lock', jsonb_build_object('since', now()))
on conflict (id) do nothing;

create or replace function public.roulette_contact_lock_since()
returns timestamptz
language sql
stable
set search_path to 'public'
as $function$
  select coalesce(
    (select (s.setting_value->>'since')::timestamptz from public.crm_settings s where s.id = 'roulette_contact_lock'),
    'infinity'::timestamptz
  );
$function$;

create or replace function public.roulette_contact_lock_max_age()
returns interval
language sql
immutable
as $function$
  select interval '24 hours';
$function$;

-- Corretor liberado pela trava (nenhum cliente da distribuição sem contato com ele).
create or replace function public.roulette_contact_lock_ok(p_user_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select not exists (
    select 1
    from public.simulation_registrations r
    cross join lateral (select coalesce(r.responsible_changed_at, r.created_at) as received_at) rc
    cross join lateral (
      select h.to_user_id, h.created_at, h.details
      from public.lead_distribution_history h
      where h.registration_id = r.id
        and h.event_type in ('assigned', 'auto_transferred')
      order by h.created_at desc
      limit 1
    ) last_dist
    where r.responsible_user_id = p_user_id
      and r.pending_distribution_at is null
      and r.status not in ('archived', 'do_not_contact', 'restriction', 'rejected', 'income_commitment', 'sale_completed', 'sale_paid')
      and rc.received_at >= public.roulette_contact_lock_since()
      and rc.received_at >= now() - public.roulette_contact_lock_max_age()
      and last_dist.to_user_id = p_user_id
      and coalesce(last_dist.details->>'toWaitingQueue', 'false') <> 'true'
      and coalesce(last_dist.details->>'heldByOwner', 'false') <> 'true'
      and last_dist.created_at >= rc.received_at - interval '5 minutes'
      and not exists (
        select 1 from public.whatsapp_conversations c
        where c.client_id = r.id and c.last_human_reply_at >= rc.received_at
      )
      and not exists (
        select 1 from public.marketplace_conversations mc
        where mc.client_id = r.id
          and (
            mc.last_human_reply_at >= rc.received_at
            or exists (
              select 1 from public.marketplace_messages m
              where m.conversation_id = mc.id
                and m.direction = 'outbound'
                and m.sender_user_id is not null
                and m.created_at >= rc.received_at
            )
          )
      )
  );
$function$;

create or replace function public.roulette_contact_lock_ok_ids(p_user_ids uuid[])
returns setof uuid
language sql
stable
set search_path to 'public'
as $function$
  select u from unnest(p_user_ids) as u where public.roulette_contact_lock_ok(u);
$function$;

-- Mesmo corpo da migration 20261019235900 + a trava (ROL-2j).
create or replace function public.roulette_user_extra_eligible(p_user_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select public.whatsapp_user_has_active_number(p_user_id)
    and not exists (
      select 1 from public.whatsapp_restrictions r
      where r.user_id = p_user_id and r.ended_at is null
    )
    and public.office_presence_ok(p_user_id)
    and public.roulette_contact_lock_ok(p_user_id);
$function$;

-- Só o servidor (service_role) chama estas funções; nunca pelo navegador.
revoke execute on function public.roulette_contact_lock_since() from public, anon, authenticated;
revoke execute on function public.roulette_contact_lock_max_age() from public, anon, authenticated;
revoke execute on function public.roulette_contact_lock_ok(uuid) from public, anon, authenticated;
revoke execute on function public.roulette_contact_lock_ok_ids(uuid[]) from public, anon, authenticated;
revoke execute on function public.roulette_user_extra_eligible(uuid) from public, anon, authenticated;
grant execute on function public.roulette_contact_lock_since() to service_role;
grant execute on function public.roulette_contact_lock_max_age() to service_role;
grant execute on function public.roulette_contact_lock_ok(uuid) to service_role;
grant execute on function public.roulette_contact_lock_ok_ids(uuid[]) to service_role;
grant execute on function public.roulette_user_extra_eligible(uuid) to service_role;
