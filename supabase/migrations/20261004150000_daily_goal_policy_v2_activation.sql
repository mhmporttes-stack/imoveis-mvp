-- ATIVAÇÃO da política de disparos v2 do WhatsApp (REGRA OFICIAL — dono, 2026-10-04; autorização expressa em chat 04/10).
-- Substitui/completa 20261004130000_daily_goal_policy_v2.sql (que NÃO tinha sido aplicada). Pode ser aplicada com ou sem ela.
-- ADITIVA e IDEMPOTENTE. Não toca cliente, funil, histórico, mensagens nem a fila (a limpeza do excesso da fila é feita
-- pelo próprio código do servidor, no primeiro ciclo do cron e na reconexão, e fica registrada em daily_goal_policy_trim_log).
-- NÃO liga a automação de ninguém (a coluna "enabled" não é alterada).
--
-- 1) policy_v2_enabled: padrão TRUE (v2 vigente). Só "false" explícito (interruptor do corretor na tela) é opt-out.
-- 2) Tabela de auditoria da limpeza do excesso (append-only).
-- 3) Alinha a configuração persistida de quem tem a automação LIGADA: janela 06:30–15:30, intervalo 5–8 min.
--    (O código já usa as constantes da política como autoridade; isto só deixa o banco e a tela coerentes.)

do $$
declare
  v_first_run boolean := to_regclass('public.daily_goal_policy_trim_log') is null;
  v_column_existed boolean;
begin
  select exists (
    select 1 from information_schema.columns
    where table_schema = 'public' and table_name = 'daily_goal_auto_settings' and column_name = 'policy_v2_enabled'
  ) into v_column_existed;

  -- Coluna nova já nasce TRUE para todas as linhas (corretor com automação desligada que ligar depois já cai na v2).
  alter table public.daily_goal_auto_settings
    add column if not exists policy_v2_enabled boolean not null default true;
  alter table public.daily_goal_auto_settings
    alter column policy_v2_enabled set default true;

  -- Se a coluna já existia com o padrão antigo (false), só na PRIMEIRA execução desta migration promove a true
  -- quem tem a automação ligada. Reexecuções nunca desfazem um opt-out explícito feito depois.
  if v_column_existed and v_first_run then
    update public.daily_goal_auto_settings
       set policy_v2_enabled = true, updated_at = now()
     where enabled = true and policy_v2_enabled = false;
  end if;
end $$;

comment on column public.daily_goal_auto_settings.policy_v2_enabled is
  'Política de disparos v2 (2026-10-04), VIGENTE por padrão: 30 msgs/dia (10/10/10 sem empréstimo), 06:30-15:30 seg-sáb, intervalo 5-8 min, pausa 15-30 min a cada 8-12 envios. false explícito = opt-out do corretor.';

create table if not exists public.daily_goal_policy_trim_log (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  attempt_number smallint not null check (attempt_number between 1 and 3),
  kept integer not null,
  trimmed integer not null,
  trimmed_at timestamptz not null default now(),
  policy text not null default 'policy_v2'
);
create index if not exists daily_goal_policy_trim_log_broker_idx
  on public.daily_goal_policy_trim_log (broker_id, trimmed_at desc);
alter table public.daily_goal_policy_trim_log enable row level security;
comment on table public.daily_goal_policy_trim_log is
  'Auditoria append-only da limpeza do excesso da fila da Meta Diária (política v2): quantos itens ficaram (kept) e quantos foram retirados (trimmed) por corretor e tentativa. Os itens retirados ficam em daily_goal_auto_queue com status canceled e skip_reason policy_v2_trim_excess.';

-- Alinha a configuração persistida (só quem tem a automação ligada; idempotente).
update public.daily_goal_auto_settings
   set window_start_minutes = 390,   -- 06:30
       window_end_minutes = 930,     -- 15:30
       min_gap_minutes = 5,
       max_gap_minutes = 8,
       updated_at = now()
 where enabled = true
   and (window_start_minutes <> 390 or window_end_minutes <> 930 or min_gap_minutes <> 5 or max_gap_minutes <> 8);
