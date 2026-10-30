-- Aba "Sem resposta" dos Chats (WA-38, dono, 2026-10-30): lista editável (admin/gestor) das frases de encerramento
-- curto e de negativa que tiram a conversa SÓ da aba quando são a última mensagem do cliente. Vale para o Chat do
-- WhatsApp e o do Marketplace. Uma linha só (id = 'default'). Sem linha = lista padrão do código
-- (lib/chat-closing-message-core.mjs). Nada é enviado; status/tags do cliente não mudam. Aditiva e idempotente.
-- RLS ligado sem policy (acesso só pelo servidor, service role).

create table if not exists public.chat_closing_phrases (
  id text primary key default 'default' check (id = 'default'),
  closing text[] not null default '{}',
  negative text[] not null default '{}',
  updated_by uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

alter table public.chat_closing_phrases enable row level security;
