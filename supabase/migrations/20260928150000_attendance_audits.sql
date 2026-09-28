-- Auditoria de Atendimento (Gestão > Desempenho > Auditoria).
-- Guarda cada auditoria gerada permanentemente (nunca recalculada
-- automaticamente): métricas objetivas (calculadas pelo próprio sistema) +
-- resultado estruturado da IA (qualitativo, sobre as conversas reais do
-- período) + a comparação com a auditoria imediatamente anterior do mesmo
-- corretor, congelada no momento da geração.
create table if not exists attendance_audits (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references admin_users(id) on delete cascade,
  period_start date not null,
  period_end date not null,
  generated_by uuid references admin_users(id) on delete set null,
  generated_at timestamptz not null default now(),
  metrics jsonb not null,
  ai_result jsonb,
  comparison jsonb,
  previous_audit_id uuid references attendance_audits(id) on delete set null,
  created_at timestamptz not null default now()
);

create index if not exists attendance_audits_broker_period_idx
  on attendance_audits (broker_id, period_end desc);

alter table attendance_audits enable row level security;
