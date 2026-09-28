create table if not exists public.document_ai_rules (
  id uuid primary key default gen_random_uuid(),
  category text not null,
  title text not null,
  instruction text not null,
  rule_key text unique,
  policy jsonb not null default '{}'::jsonb,
  active boolean not null default true,
  created_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists document_ai_rules_active_idx on public.document_ai_rules (active, category);
alter table public.document_ai_rules enable row level security;
revoke all on public.document_ai_rules from anon, authenticated;
grant all on public.document_ai_rules to service_role;

insert into public.document_ai_rules (category, title, instruction, rule_key, policy)
values (
  'Comprovante de residência',
  'Titularidade conforme a renda',
  'Identifique primeiro o tipo de renda no cadastro. Renda informal: o comprovante deve estar no nome do próprio cliente. CLT ou declarante de IR: pode estar em nome de terceiro. Se a renda ou o nome não puder ser confirmado, peça validação; não presuma uma pendência.',
  'residence_income_ownership',
  '{"self_employed_unregistered":"titular_only","registered_employment":"third_party_allowed","income_tax_declarant":"third_party_allowed"}'::jsonb
)
on conflict (rule_key) do nothing;
