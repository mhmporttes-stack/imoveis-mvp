-- Meta Diária: consome a fila compartilhada de prospecção já existente
-- (public.prospecting_contacts) de forma estruturada (FIFO + cadência de 3
-- tentativas), sem criar um pool de clientes paralelo.

-- Posição real na fila, independente de created_at: entra com o valor de
-- created_at (fila nasce em ordem de chegada) e é empurrada para o futuro
-- sempre que uma rodada termina sem conversão (ver claim_daily_goal_contacts
-- e o "fim de rodada" em lib/daily-goal.js) — garante que quem já passou por
-- uma rodada completa nunca volte ao início da fila.
alter table public.prospecting_contacts
  add column if not exists queue_sort_at timestamptz not null default now();
update public.prospecting_contacts set queue_sort_at = created_at where queue_sort_at is null;
create index if not exists prospecting_contacts_queue_sort_idx on public.prospecting_contacts (queue_sort_at);

-- Vigência da quantidade diária de novos clientes (mesmo padrão de
-- scoring_rule_versions/set_scoring_rule_version): mudar a quantidade só
-- afeta as próximas gerações, nunca as metas já geradas.
create table if not exists public.daily_goal_quota_versions (
  id uuid primary key default gen_random_uuid(),
  quota integer not null check (quota > 0 and quota <= 500),
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  changed_by uuid references public.admin_users(id) on delete set null
);
create index if not exists daily_goal_quota_versions_current_idx on public.daily_goal_quota_versions (effective_from) where effective_to is null;
insert into public.daily_goal_quota_versions (quota, effective_from, effective_to)
select 30, now(), null
where not exists (select 1 from public.daily_goal_quota_versions);

create or replace function public.set_daily_goal_quota(
  p_quota integer,
  p_changed_by uuid
) returns public.daily_goal_quota_versions
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.daily_goal_quota_versions;
begin
  update public.daily_goal_quota_versions set effective_to = now() where effective_to is null;
  insert into public.daily_goal_quota_versions (quota, effective_from, effective_to, changed_by)
  values (p_quota, now(), null, p_changed_by)
  returning * into result;
  return result;
end;
$$;
revoke all on function public.set_daily_goal_quota(integer, uuid) from public, anon, authenticated;
grant execute on function public.set_daily_goal_quota(integer, uuid) to service_role;

-- Marca "a meta do dia já foi gerada para este corretor" (chave da
-- idempotência: gerar de novo é só ler esta linha) e congela o total de
-- novos contatos realmente atribuídos naquele dia (denominador estável).
create table if not exists public.daily_goals (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  goal_date date not null,
  new_quota integer not null,
  new_assigned_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (broker_id, goal_date)
);

-- Uma rodada = um ciclo de até 3 tentativas de um corretor com um contato da
-- fila. status: active | converted | ended_no_conversion.
create table if not exists public.daily_goal_rounds (
  id uuid primary key default gen_random_uuid(),
  prospecting_contact_id uuid not null references public.prospecting_contacts(id) on delete cascade,
  client_id uuid references public.simulation_registrations(id) on delete cascade,
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  round_started_at date not null,
  attempt_count integer not null default 0 check (attempt_count between 0 and 3),
  status text not null default 'active' check (status in ('active', 'converted', 'ended_no_conversion')),
  converted_attempt integer check (converted_attempt between 1 and 3),
  converted_at timestamptz,
  ended_at timestamptz,
  created_at timestamptz not null default now()
);
-- Nunca duas rodadas ativas para o mesmo contato ao mesmo tempo.
create unique index if not exists daily_goal_rounds_active_contact_idx on public.daily_goal_rounds (prospecting_contact_id) where status = 'active';
create index if not exists daily_goal_rounds_broker_date_idx on public.daily_goal_rounds (broker_id, round_started_at, status);
create index if not exists daily_goal_rounds_client_idx on public.daily_goal_rounds (client_id);

-- Uma tentativa = um clique real em WhatsApp (a "atividade" da Meta Diária).
-- Guarda o texto efetivamente usado (snapshot), não uma referência ao
-- template — alterar o template depois não pode mudar o que já foi contado.
create table if not exists public.daily_goal_attempts (
  id uuid primary key default gen_random_uuid(),
  round_id uuid not null references public.daily_goal_rounds(id) on delete cascade,
  client_id uuid references public.simulation_registrations(id) on delete cascade,
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  attempt_number integer not null check (attempt_number between 1 and 3),
  goal_date date not null,
  message_used text not null,
  is_personalized boolean not null default false,
  created_at timestamptz not null default now(),
  unique (round_id, attempt_number)
);
create index if not exists daily_goal_attempts_broker_date_idx on public.daily_goal_attempts (broker_id, goal_date, attempt_number);

-- Reivindicação atômica da fila (FIFO, mais antigo primeiro): usa
-- "FOR UPDATE SKIP LOCKED" para que corretores acessando ao mesmo tempo nunca
-- recebam o mesmo contato — cada chamada trava e consome sua própria fatia,
-- pulando o que outra transação concorrente já está processando.
create or replace function public.claim_daily_goal_contacts(
  p_broker_id uuid,
  p_quota integer
) returns setof public.prospecting_contacts
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_now timestamptz := now();
begin
  return query
    update public.prospecting_contacts
    set status = 'claimed', assigned_user_id = p_broker_id, last_broker_id = p_broker_id, updated_at = v_now
    where id in (
      select id from public.prospecting_contacts
      where assigned_user_id is null
        and (status = 'available' or (status = 'recent_attempt' and available_after <= v_now))
      order by queue_sort_at asc
      limit p_quota
      for update skip locked
    )
    returning *;
end;
$$;
revoke all on function public.claim_daily_goal_contacts(uuid, integer) from public, anon, authenticated;
grant execute on function public.claim_daily_goal_contacts(uuid, integer) to service_role;

alter table public.daily_goal_quota_versions enable row level security;
alter table public.daily_goals enable row level security;
alter table public.daily_goal_rounds enable row level security;
alter table public.daily_goal_attempts enable row level security;
revoke all on public.daily_goal_quota_versions from anon, authenticated;
revoke all on public.daily_goals from anon, authenticated;
revoke all on public.daily_goal_rounds from anon, authenticated;
revoke all on public.daily_goal_attempts from anon, authenticated;
grant all on public.daily_goal_quota_versions to service_role;
grant all on public.daily_goals to service_role;
grant all on public.daily_goal_rounds to service_role;
grant all on public.daily_goal_attempts to service_role;
