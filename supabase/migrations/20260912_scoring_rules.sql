create extension if not exists pgcrypto;

-- Regras de pontuação do ranking da equipe (Gestão > Desempenho > Pontuação).
-- Cada alteração de pontos/ativação fecha a versão vigente (effective_to) e
-- abre uma nova (effective_from = now()), preservando o valor que estava em
-- vigor quando cada evento antigo aconteceu — o ranking de um período passado
-- sempre usa a regra que valia naquele momento, nunca a regra atual.
create table if not exists public.scoring_rule_versions (
  id uuid primary key default gen_random_uuid(),
  rule_key text not null check (rule_key in (
    'new_client', 'prospecting', 'service', 'simulation',
    'documentation', 'sent_for_approval', 'approval', 'sale'
  )),
  points integer not null check (points >= 0),
  active boolean not null default true,
  effective_from timestamptz not null default now(),
  effective_to timestamptz,
  changed_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists scoring_rule_versions_rule_key_from_idx
  on public.scoring_rule_versions (rule_key, effective_from desc);

-- Garante no máximo uma versão "aberta" (vigente) por atividade.
create unique index if not exists scoring_rule_versions_open_idx
  on public.scoring_rule_versions (rule_key)
  where effective_to is null;

alter table public.scoring_rule_versions enable row level security;
revoke all on public.scoring_rule_versions from anon, authenticated;
grant all on public.scoring_rule_versions to service_role;

-- Ajustes manuais de pontos (Gestão > Desempenho > Pontuação > Ajuste manual).
-- Ficam separados dos eventos reais de produção para nunca alterar/apagar uma
-- atividade real só para mexer no ranking — cada ajuste é um lançamento próprio,
-- auditável, e uma correção de ajuste deve ser um novo lançamento compensatório.
create table if not exists public.scoring_manual_adjustments (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  points integer not null check (points <> 0),
  reason text not null check (char_length(btrim(reason)) > 0),
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists scoring_manual_adjustments_broker_idx
  on public.scoring_manual_adjustments (broker_id, created_at desc);

alter table public.scoring_manual_adjustments enable row level security;
revoke all on public.scoring_manual_adjustments from anon, authenticated;
grant all on public.scoring_manual_adjustments to service_role;

-- Seed: reproduz exatamente a pontuação já usada hoje pelo ranking (pesos que
-- estavam fixos no código em lib/performance-overview.js), valendo desde uma
-- data muito anterior a qualquer evento do sistema — nenhum número já
-- consolidado muda com esta migration.
insert into public.scoring_rule_versions (rule_key, points, active, effective_from, effective_to)
values
  ('new_client', 5, true, '2000-01-01T00:00:00Z', null),
  ('prospecting', 2, true, '2000-01-01T00:00:00Z', null),
  ('service', 5, true, '2000-01-01T00:00:00Z', null),
  ('simulation', 10, true, '2000-01-01T00:00:00Z', null),
  ('approval', 25, true, '2000-01-01T00:00:00Z', null),
  ('sale', 100, true, '2000-01-01T00:00:00Z', null)
on conflict (rule_key) where effective_to is null do nothing;

-- "Documentação recebida" e "Cliente enviado para aprovação" são atividades
-- novas no ranking (não pontuavam antes): passam a valer a partir de agora,
-- sem pontuar retroativamente eventos que já aconteceram.
insert into public.scoring_rule_versions (rule_key, points, active, effective_from, effective_to)
values
  ('documentation', 10, true, now(), null),
  ('sent_for_approval', 15, true, now(), null)
on conflict (rule_key) where effective_to is null do nothing;
