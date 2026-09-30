-- Robustez da automação da Meta Diária (pedido detalhado do dono,
-- 2026-09-30): classificação de erro (contato x infraestrutura), retry
-- técnico sem afetar a tentativa comercial, categoria "Erro" separada de
-- "Não contactar", rotação sequencial persistente de variação de mensagem.
-- Alteração incremental sobre as estruturas já existentes (migrations
-- 20260914_daily_goal.sql e 20260929190000_daily_goal_auto_dispatch.sql).

-- "Erro" (pedido do dono): rodada que esgotou 3 falhas técnicas atribuíveis
-- ao contato (número inválido, JID inexistente...) para de ser tentada pela
-- automação, SEM virar "Não contactar" (que é do cliente, não da rodada) e
-- sem apagar nada — preserva attempt_count, histórico e o próprio cliente.
alter table public.daily_goal_rounds drop constraint if exists daily_goal_rounds_status_check;
alter table public.daily_goal_rounds add constraint daily_goal_rounds_status_check
  check (status in ('active', 'converted', 'ended_no_conversion', 'auto_error'));

alter table public.daily_goal_rounds
  add column if not exists auto_error_count integer not null default 0,
  add column if not exists auto_error_last text,
  add column if not exists auto_error_at timestamptz;

-- Qual variação (1A/1B/1C/1D...) foi usada em cada item — registrado de
-- forma confiável na hora do envio, sem depender de comparar message_text
-- (pedido do dono). Usado pela rotação sequencial e pelo histórico.
alter table public.daily_goal_auto_queue
  add column if not exists variant_index integer;

create index if not exists daily_goal_auto_queue_history_idx
  on public.daily_goal_auto_queue (broker_id, updated_at desc);

-- Cursor da rotação sequencial e persistente por corretor+tentativa
-- (1A→1B→1C→1D→1A...), sobrevive a reinício do cron/processo (pedido do
-- dono: "não quero mais sorteio, quero rotação sequencial persistente").
alter table public.daily_goal_auto_settings
  add column if not exists variant_cursor_attempt1 integer not null default 0,
  add column if not exists variant_cursor_attempt2 integer not null default 0,
  add column if not exists variant_cursor_attempt3 integer not null default 0;

-- insert_daily_goal_auto_queue_items (criada fora de migration numa sessão
-- anterior, 2026-09-30 — capturada aqui pela 1ª vez) agora também aceita
-- variant_index, mesma lógica de ON CONFLICT DO NOTHING de antes.
create or replace function public.insert_daily_goal_auto_queue_items(items jsonb)
returns integer
language plpgsql
set search_path to 'public'
as $$
declare
  inserted_count integer;
begin
  with input_rows as (
    select * from jsonb_to_recordset(items) as x(
      round_id uuid, broker_id uuid, contact_id uuid, attempt_number integer,
      message_text text, scheduled_for timestamptz, status text, variant_index integer
    )
  ), inserted as (
    insert into public.daily_goal_auto_queue (round_id, broker_id, contact_id, attempt_number, message_text, scheduled_for, status, variant_index)
    select round_id, broker_id, contact_id, attempt_number, message_text, scheduled_for, status, variant_index
    from input_rows
    on conflict (round_id, attempt_number) where status = any(array['pending','sending','sent']) do nothing
    returning 1
  )
  select count(*) into inserted_count from inserted;
  return inserted_count;
end;
$$;
