-- Ponte ChatGPT -> Central de Comando (fase 1). Aditiva e isolada: so cria objetos novos.
-- Fila de tarefas; so o service_role acessa (RLS ligado, sem policy).

create table if not exists public.central_tasks (
  id uuid primary key default gen_random_uuid(),
  status text not null default 'AGUARDANDO'
    check (status in ('AGUARDANDO','EM_EXECUCAO','AGUARDANDO_DECISAO','CONCLUIDA','ERRO')),
  tipo text not null check (tipo in ('consulta','escrita','eco')),
  origem text not null default 'chatgpt',
  payload jsonb not null,
  resultado text,
  erro text,
  idempotency_key text,
  attempts integer not null default 0,
  max_attempts integer not null default 3,
  locked_by text,
  locked_at timestamptz,
  lease_expires_at timestamptz,
  approved_at timestamptz,
  decided_by text,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now()
);

create unique index if not exists central_tasks_origem_idem_uidx
  on public.central_tasks (origem, idempotency_key) where idempotency_key is not null;
create index if not exists central_tasks_status_created_idx
  on public.central_tasks (status, created_at);

create or replace function public.central_tasks_touch_updated_at()
returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

drop trigger if exists central_tasks_touch_updated_at on public.central_tasks;
create trigger central_tasks_touch_updated_at
  before update on public.central_tasks
  for each row execute function public.central_tasks_touch_updated_at();

alter table public.central_tasks enable row level security;

-- Claim atomico: recupera leases expirados e entrega a proxima tarefa elegivel.
-- Elegivel = AGUARDANDO e (tipo consulta/eco OU aprovada pelo canal de aprovacao).
create or replace function public.central_claim_task(p_worker text, p_lease_seconds integer default 120)
returns setof public.central_tasks
language plpgsql security invoker as $$
declare v_id uuid;
begin
  update public.central_tasks
     set status = case when attempts >= max_attempts then 'ERRO' else 'AGUARDANDO' end,
         erro = case when attempts >= max_attempts then 'Lease expirada; tentativas esgotadas.' else erro end,
         completed_at = case when attempts >= max_attempts then now() else completed_at end,
         locked_by = null, locked_at = null, lease_expires_at = null
   where status = 'EM_EXECUCAO' and lease_expires_at < now();

  select t.id into v_id from public.central_tasks t
   where t.status = 'AGUARDANDO'
     and (t.tipo in ('consulta','eco') or t.approved_at is not null)
   order by t.created_at
   for update skip locked
   limit 1;
  if v_id is null then return; end if;

  return query
  update public.central_tasks
     set status = 'EM_EXECUCAO', attempts = attempts + 1,
         locked_by = p_worker, locked_at = now(),
         lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 10)),
         started_at = coalesce(started_at, now())
   where id = v_id
  returning *;
end $$;

-- Resultado: so quem detem o lease, so enquanto EM_EXECUCAO (impede resultado duplicado).
create or replace function public.central_complete_task(
  p_id uuid, p_worker text, p_status text, p_resultado text, p_erro text)
returns setof public.central_tasks
language sql security invoker as $$
  update public.central_tasks
     set status = p_status, resultado = p_resultado, erro = p_erro,
         completed_at = now(), locked_by = null, locked_at = null, lease_expires_at = null
   where id = p_id and status = 'EM_EXECUCAO' and locked_by = p_worker
     and p_status in ('CONCLUIDA','ERRO')
  returning *;
$$;

create or replace function public.central_renew_lease(p_id uuid, p_worker text, p_lease_seconds integer default 120)
returns setof public.central_tasks
language sql security invoker as $$
  update public.central_tasks
     set lease_expires_at = now() + make_interval(secs => greatest(p_lease_seconds, 10))
   where id = p_id and status = 'EM_EXECUCAO' and locked_by = p_worker
  returning *;
$$;

-- Na partida do poller: devolve a fila os leases PROPRIOS ja expirados.
create or replace function public.central_requeue_own(p_worker text)
returns integer
language plpgsql security invoker as $$
declare v_n integer;
begin
  update public.central_tasks
     set status = case when attempts >= max_attempts then 'ERRO' else 'AGUARDANDO' end,
         erro = case when attempts >= max_attempts then 'Lease expirada; tentativas esgotadas.' else erro end,
         completed_at = case when attempts >= max_attempts then now() else completed_at end,
         locked_by = null, locked_at = null, lease_expires_at = null
   where status = 'EM_EXECUCAO' and locked_by = p_worker and lease_expires_at < now();
  get diagnostics v_n = row_count;
  return v_n;
end $$;

-- Decisao externa (canal de aprovacao): unica transicao AGUARDANDO_DECISAO -> AGUARDANDO/ERRO.
create or replace function public.central_decide_task(p_id uuid, p_approve boolean, p_by text)
returns setof public.central_tasks
language sql security invoker as $$
  update public.central_tasks
     set status = case when p_approve then 'AGUARDANDO' else 'ERRO' end,
         approved_at = case when p_approve then now() else null end,
         erro = case when p_approve then erro else 'Rejeitada na decisao.' end,
         completed_at = case when p_approve then null else now() end,
         decided_by = p_by
   where id = p_id and status = 'AGUARDANDO_DECISAO'
  returning *;
$$;

revoke all on public.central_tasks from public, anon, authenticated;
revoke all on function public.central_tasks_touch_updated_at() from public, anon, authenticated;
revoke all on function public.central_claim_task(text, integer) from public, anon, authenticated;
revoke all on function public.central_complete_task(uuid, text, text, text, text) from public, anon, authenticated;
revoke all on function public.central_renew_lease(uuid, text, integer) from public, anon, authenticated;
revoke all on function public.central_requeue_own(text) from public, anon, authenticated;
revoke all on function public.central_decide_task(uuid, boolean, text) from public, anon, authenticated;
grant all on public.central_tasks to service_role;
grant execute on function public.central_claim_task(text, integer) to service_role;
grant execute on function public.central_complete_task(uuid, text, text, text, text) to service_role;
grant execute on function public.central_renew_lease(uuid, text, integer) to service_role;
grant execute on function public.central_requeue_own(text) to service_role;
grant execute on function public.central_decide_task(uuid, boolean, text) to service_role;
