-- Mensagens internas de supervisão (gestor/admin ↔ corretor) — pedido do
-- dono em 2026-10-01. NÃO tem relação com o Chat de clientes/WhatsApp
-- (whatsapp_*), com a "mensagem interna" de uma conversa do Chat
-- (crm_notifications chat_internal) nem com contatos/Google Contacts.
--
-- Uma linha por mensagem. A conversa é o PAR (sender_id, recipient_id) em
-- qualquer direção. Mensagem do gestor exige confirmação do corretor
-- (requires_ack + ack_status 'pending'); o corretor responde "OK"
-- (kind 'ack') ou com texto (kind 'reply') e a original passa para
-- 'acknowledged'/'replied'. Estados de entrega/leitura: delivered_at (o app
-- do destinatário buscou), seen_at (o destinatário viu na tela).
--
-- Pronta para expansão (sem implementar agora): corretor → gestor (kind
-- 'message' com requires_ack false), avisos ('notice'), mensagens
-- automáticas do CRM ('system', sender_id nulo) e outras origens (origin:
-- 'alexa', 'automation').
--
-- Acesso: RLS ligado e sem policy (padrão do projeto) — só o service role
-- do servidor lê/grava; a autorização é feita em lib/supervision-messages.js.
create table if not exists public.supervision_messages (
  id uuid primary key default gen_random_uuid(),
  sender_id uuid references public.admin_users(id) on delete set null,
  recipient_id uuid not null references public.admin_users(id) on delete cascade,
  body text not null check (char_length(body) between 1 and 2000),
  kind text not null default 'message' check (kind in ('message', 'reply', 'ack', 'notice', 'system')),
  requires_ack boolean not null default false,
  ack_status text not null default 'none' check (ack_status in ('none', 'pending', 'acknowledged', 'replied')),
  responded_at timestamptz,
  in_reply_to uuid references public.supervision_messages(id) on delete set null,
  origin text not null default 'crm',
  sent_by_email text,
  delivered_at timestamptz,
  seen_at timestamptz,
  created_at timestamptz not null default now()
);

-- Pendentes do corretor (balão central): poucas linhas, consultadas a cada
-- abertura do painel.
create index if not exists supervision_messages_pending_idx
  on public.supervision_messages (recipient_id, created_at)
  where ack_status = 'pending';

-- Histórico paginado do par, nas duas direções.
create index if not exists supervision_messages_pair_idx
  on public.supervision_messages (sender_id, recipient_id, created_at desc);

-- Não vistas por destinatário (badge do gestor).
create index if not exists supervision_messages_unseen_idx
  on public.supervision_messages (recipient_id, sender_id)
  where seen_at is null;

alter table public.supervision_messages enable row level security;
revoke all on public.supervision_messages from anon, authenticated;
grant all on public.supervision_messages to service_role;
