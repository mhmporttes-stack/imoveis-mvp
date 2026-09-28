-- WhatsApp INDIVIDUAL (camada de transporte nova, adicionada ao Chat já
-- existente): número oficial da Meta foi banido em 28/09/2026 — cada
-- corretor pode conectar o PRÓPRIO WhatsApp pessoal via QR Code (como o
-- WhatsApp Web), através de um microsserviço externo (Baileys, hospedado
-- fora da Vercel). Esta migration só cria a tabela de estado da sessão e
-- prepara whatsapp_messages para registrar por qual canal cada mensagem
-- passou. Não mexe em cliente, responsável, histórico nem no Chat existente.

create table if not exists public.whatsapp_individual_sessions (
  user_id uuid primary key references public.admin_users(id) on delete cascade,
  status text not null default 'disconnected'
    check (status in ('disconnected', 'connecting', 'qr_required', 'connected', 'reconnecting', 'error')),
  phone_number text,
  qr_data text,
  qr_expires_at timestamptz,
  last_connected_at timestamptz,
  last_error text,
  -- Credenciais do Baileys (auth state), criptografadas com AES-256-GCM pelo
  -- microsserviço antes de gravar (SESSION_ENCRYPTION_KEY) — NUNCA texto
  -- puro, NUNCA lidas/expostas pelo Next.js/frontend. Só o microsserviço
  -- (service_role) lê e escreve esta coluna.
  session_creds_encrypted text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);

comment on table public.whatsapp_individual_sessions is
  'Estado da sessão pessoal de WhatsApp (Baileys) de cada corretor. Credenciais só em session_creds_encrypted, criptografadas.';
comment on column public.whatsapp_individual_sessions.session_creds_encrypted is
  'Auth state do Baileys cifrado (AES-256-GCM). Nunca exposto ao frontend.';

alter table public.whatsapp_individual_sessions enable row level security;
revoke all on public.whatsapp_individual_sessions from anon, authenticated;
grant all on public.whatsapp_individual_sessions to service_role;

-- whatsapp_messages passa a registrar por qual canal a mensagem foi
-- enviada/recebida. Default mantém todas as linhas já existentes (e as que o
-- número oficial da Meta continuar gerando enquanto ainda funcionar para
-- alguém) como 'whatsapp_cloud_api' — nenhuma linha existente muda de
-- significado.
alter table public.whatsapp_messages
  add column if not exists channel text not null default 'whatsapp_cloud_api'
    check (channel in ('whatsapp_cloud_api', 'whatsapp_individual'));

-- Qual sessão individual (corretor) enviou ou recebeu esta mensagem
-- especificamente. NULL quando channel = 'whatsapp_cloud_api'.
alter table public.whatsapp_messages
  add column if not exists session_user_id uuid references public.admin_users(id) on delete set null;

create index if not exists whatsapp_messages_channel_idx
  on public.whatsapp_messages (channel);

-- Idempotência do canal individual: a Meta Cloud API tem meta_message_id
-- (índice único já existente); o canal individual (Baileys) não tem esse ID
-- — o dedupe usa o id de mensagem do WhatsApp gravado em
-- metadata->>'wa_message_id'. Índice único PARCIAL (só linhas do canal
-- individual com esse campo preenchido) para nunca colidir com o canal
-- oficial nem travar linhas sem esse dado.
create unique index if not exists whatsapp_messages_individual_wa_id_uidx
  on public.whatsapp_messages (channel, (metadata->>'wa_message_id'))
  where channel = 'whatsapp_individual' and (metadata->>'wa_message_id') is not null;
