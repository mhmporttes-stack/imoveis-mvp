-- ============================================================================================
-- APLICAR A POLITICA DE DISPAROS v2 (arquivo unico, para colar no SQL Editor do Supabase)
-- Seguro para rodar mais de uma vez. Nao envia mensagem, nao toca cliente/funil/historico, nao liga automacao.
-- Passo a passo: docs/OPERACAO_DISPAROS.md secao 7.
-- ============================================================================================
begin;

-- ANTES (so leitura): estado atual
select 'ANTES' as momento,
       (select count(*) from information_schema.columns where table_schema='public' and table_name='daily_goal_auto_settings' and column_name='policy_v2_enabled') as coluna_existe,
       (select count(*) from public.daily_goal_auto_settings where enabled) as corretores_com_automacao_ligada;

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

-- DEPOIS (so leitura): confira. Esperado: coluna_existe = 1; cada corretor com automacao ligada em
-- policy_v2_enabled = true, janela 390-930 e intervalo 5-8; tabela do log existe (0 linhas e normal).
select 'DEPOIS' as momento, b.name, s.enabled, s.policy_v2_enabled, s.window_start_minutes, s.window_end_minutes, s.min_gap_minutes, s.max_gap_minutes
from public.daily_goal_auto_settings s join public.admin_users b on b.id = s.broker_id
order by s.enabled desc, b.name;
select count(*) as linhas_no_log_do_corte from public.daily_goal_policy_trim_log;

commit;
