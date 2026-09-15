-- Mensagens personalizadas por corretor na Meta Diária: quando a mensagem
-- padrão (crm_settings id="daily_goal_messages") permite personalização, o
-- corretor pode editar o texto antes de enviar. Antes, essa edição valia só
-- para aquele envio; agora a ÚLTIMA edição de cada corretor fica salva aqui e
-- vira o novo texto-padrão DELE (só dele, nunca some o padrão da imobiliária
-- para os demais), pré-preenchendo o campo da próxima vez.
create table if not exists public.daily_goal_broker_messages (
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  message_key text not null check (message_key in ('message1', 'message2', 'message3')),
  text text not null,
  updated_at timestamptz not null default now(),
  primary key (broker_id, message_key)
);

alter table public.daily_goal_broker_messages enable row level security;
revoke all on public.daily_goal_broker_messages from anon, authenticated;
grant all on public.daily_goal_broker_messages to service_role;
