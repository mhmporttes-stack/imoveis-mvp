-- Rate limit REAL para formulários públicos (P-09 do pente-fino 2026-09-24):
-- as travas de hoje (app/api/leads, app/api/uploads/captacoes) usam um Map em
-- memória do processo Node — em serverless (Vercel), cada invocação pode cair
-- numa instância fria diferente, então esse Map nunca "lembra" da tentativa
-- anterior do mesmo atacante na prática. simulation-registrations,
-- quick-attendance e captacoes nunca tiveram limite nenhum. Esta tabela +
-- função RPC substituem/adicionam a trava, persistida no banco, atômica via
-- UPSERT (sem race condition de leitura-depois-escrita).

create table if not exists public.public_form_rate_limits (
  rate_key text primary key,
  window_started_at timestamptz not null,
  attempts integer not null default 1,
  updated_at timestamptz not null default now()
);

alter table public.public_form_rate_limits enable row level security;
revoke all on public.public_form_rate_limits from anon, authenticated;
grant all on public.public_form_rate_limits to service_role;

-- Devolve true (permitido) ou false (bloqueado). Janela desliza: se a última
-- tentativa registrada é mais antiga que p_window_seconds, reseta pra 1;
-- senão incrementa. UPSERT + RETURNING numa única instrução: atômico sob
-- concorrência (duas requisições simultâneas nunca "passam batido" uma da
-- outra como aconteceria com select-depois-update em JS).
create or replace function public.check_public_rate_limit(p_key text, p_window_seconds integer, p_max_attempts integer)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := now();
  v_attempts integer;
begin
  insert into public.public_form_rate_limits (rate_key, window_started_at, attempts, updated_at)
  values (p_key, v_now, 1, v_now)
  on conflict (rate_key) do update
    set attempts = case
          when public_form_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
            then 1
          else public_form_rate_limits.attempts + 1
        end,
        window_started_at = case
          when public_form_rate_limits.window_started_at <= v_now - make_interval(secs => p_window_seconds)
            then v_now
          else public_form_rate_limits.window_started_at
        end,
        updated_at = v_now
  returning attempts into v_attempts;

  return v_attempts <= p_max_attempts;
end;
$$;

revoke all on function public.check_public_rate_limit(text, integer, integer) from public, anon, authenticated;
grant execute on function public.check_public_rate_limit(text, integer, integer) to service_role;

-- Faxina: apaga entradas velhas (evita a tabela crescer pra sempre). Chamada
-- best-effort pelo mesmo cron diário de limpeza de histórico já existente
-- (limpar-historico-cron-diario) — não é crítico se não rodar num dia.
create or replace function public.cleanup_public_form_rate_limits()
returns void
language sql
security definer
set search_path = public
as $$
  delete from public.public_form_rate_limits where updated_at < now() - interval '2 days';
$$;

revoke all on function public.cleanup_public_form_rate_limits() from public, anon, authenticated;
grant execute on function public.cleanup_public_form_rate_limits() to service_role;
