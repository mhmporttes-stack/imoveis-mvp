-- Fluxo de clientes que esfriaram (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-16). Só ACRESCENTA; idempotente.
-- Um caso por "esfriamento": cliente de corretor/associado/gestora com mais de 3 dias sem contato e sem atividade
-- futura. Passo 1: o corretor escreve o motivo (janela obrigatória da Central de Alertas). Passo 2: a decisora
-- (gestora da equipe ou o dono) transfere pela roleta, aplica um status negativo ou devolve UMA vez.
-- Regras: lib/cooled-clients-core.mjs; servidor: lib/cooled-clients.js.

create table if not exists public.cooled_client_cases (
  id uuid primary key default gen_random_uuid(),
  client_id uuid not null references public.simulation_registrations(id) on delete cascade,
  broker_id uuid references public.admin_users(id) on delete set null,
  decider_id uuid references public.admin_users(id) on delete set null,
  client_status_at_open text,
  status text not null default 'awaiting_reason'
    check (status in ('awaiting_reason', 'awaiting_decision', 'closed', 'canceled')),
  opened_at timestamptz not null default now(),
  first_reason text,
  first_reason_by uuid references public.admin_users(id) on delete set null,
  first_reason_at timestamptz,
  returned_text text,
  returned_by uuid references public.admin_users(id) on delete set null,
  returned_at timestamptz,
  second_reason text,
  second_reason_by uuid references public.admin_users(id) on delete set null,
  second_reason_at timestamptz,
  decision text check (decision is null or decision in ('transferred', 'status')),
  decision_status text,
  decided_by uuid references public.admin_users(id) on delete set null,
  decided_at timestamptz,
  transferred_to uuid references public.admin_users(id) on delete set null,
  -- Resumo + mensagem sugerida por IA para o novo corretor (gerado UMA vez por transferência).
  handoff jsonb,
  handoff_generated_at timestamptz,
  canceled_reason text,
  closed_at timestamptz,
  updated_at timestamptz not null default now()
);

-- Uma pendência por cliente por esfriamento: nunca dois casos abertos do mesmo cliente.
create unique index if not exists cooled_client_cases_one_open_per_client
  on public.cooled_client_cases (client_id)
  where status in ('awaiting_reason', 'awaiting_decision');

create index if not exists cooled_client_cases_decider_open_idx
  on public.cooled_client_cases (decider_id, status)
  where status = 'awaiting_decision';

create index if not exists cooled_client_cases_opened_idx
  on public.cooled_client_cases (opened_at desc);

-- Padrão do projeto: RLS ligado, sem policy pública; acesso só pelo servidor (service role).
alter table public.cooled_client_cases enable row level security;
revoke all on public.cooled_client_cases from anon, authenticated;

-- Liga/desliga do fluxo: nasce DESLIGADO (o dono liga quando avisar a equipe).
insert into public.crm_settings (id, setting_value, updated_at)
values ('cooled_clients_flow', '{"enabled": false}'::jsonb, now())
on conflict (id) do nothing;
