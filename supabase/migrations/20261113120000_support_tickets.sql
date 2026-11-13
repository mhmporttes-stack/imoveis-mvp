-- Ajuda e chamados do painel (REGRA OFICIAL — dono, 2026-11-13). NÃO APLICADA: o código novo (/api/admin/support/**) só
-- funciona depois desta migration; sem ela o botão "?" mostra erro ao enviar (nunca perde dado).
-- Aditiva e idempotente. RLS ligado SEM policies públicas: o acesso é só por lib/support-tickets.js com a service role
-- (a autorização real — fila só do dono, autor só os próprios — é feita em código).

create table if not exists public.support_tickets (
  id uuid primary key default gen_random_uuid(),
  created_by uuid not null references public.admin_users(id) on delete cascade,
  created_at timestamptz not null default now(),
  screen_path text not null default '',
  screen_title text not null default '',
  description text not null check (length(btrim(description)) between 1 and 2000),
  -- Contexto juntado pelo CRM (usuário, perfil, alterar-conta real x efetivo, aparelho, horário, últimos erros de JS).
  context jsonb not null default '{}'::jsonb,
  -- Anexos no bucket privado `support-tickets`: [{ "path": "<id>/1.jpg", "type": "image/jpeg", "size": 123456 }]
  attachments jsonb not null default '[]'::jsonb,
  status text not null default 'open' check (status in ('open', 'answered', 'closed')),
  kind text check (kind is null or kind in ('bug', 'not_bug', 'improvement')),
  reply_text text,
  replied_at timestamptz,
  replied_by uuid references public.admin_users(id) on delete set null
);

create index if not exists support_tickets_created_by_idx on public.support_tickets (created_by, created_at desc);
create index if not exists support_tickets_status_idx on public.support_tickets (status, created_at desc);

alter table public.support_tickets enable row level security;

-- Bucket PRIVADO (nunca público): leitura só por URL assinada curta gerada no servidor.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('support-tickets', 'support-tickets', false, 1500000, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false;

-- Aviso ao corretor quando o dono responde: tipo `support_reply` liberado no sino (mesma lista de
-- lib/notification-policy-core.mjs). Corpo da função = o da migration 20261030150000 + o tipo novo.
create or replace function public.crm_notifications_policy()
returns trigger
language plpgsql
set search_path = public, extensions
as $$
begin
  if new.notification_type in ('new_client', 'scheduled_activity', 'clients_transferred', 'official_chat_assigned', 'documents_list_auto', 'marketplace_internal', 'marketplace_inbound', 'support_reply') then
    return new;
  end if;
  return null; -- descarta em silêncio (a gravação não falha)
end;
$$;
