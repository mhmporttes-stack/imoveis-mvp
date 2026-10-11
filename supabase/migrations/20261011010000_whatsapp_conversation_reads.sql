-- "Não lidas" da aba Particular (pedido do dono, 2026-10-11): leitura POR PESSOA (o dono acompanha o que já viu
-- nas conversas particulares dos corretores, sem mexer no "não lida" do corretor). Uma linha por (conversa, usuário).
create table if not exists public.whatsapp_conversation_reads (
  conversation_id uuid not null references public.whatsapp_conversations(id) on delete cascade,
  user_id uuid not null references public.admin_users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (conversation_id, user_id)
);
create index if not exists whatsapp_conversation_reads_user_idx on public.whatsapp_conversation_reads (user_id);
alter table public.whatsapp_conversation_reads enable row level security;
