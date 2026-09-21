-- WhatsApp Master > Disparo (campanhas em massa por template aprovado).
-- Reaproveita 100% da integração Meta Cloud API já existente
-- (lib/whatsapp-master.js: credenciais, webhook, sendWhatsappTemplateMessage),
-- a Base da Imobiliária já existente (prospecting_contacts com owner_user_id
-- nulo) e o pipeline de tracking de origem já existente (campaigns +
-- client_origins + campaign_link_views) — nenhuma dessas estruturas é
-- duplicada aqui. Só 3 tabelas novas (registro local de templates + lote de
-- campanha + mensagem individual) e 1 coluna aditiva em campaigns.

-- Registro local dos templates da Meta (criados por aqui OU sincronizados de
-- templates que já existiam na conta) — evita duplicidade: chave única por
-- (nome, idioma), igual à própria Meta.
create table if not exists public.whatsapp_templates (
  id uuid primary key default gen_random_uuid(),
  meta_template_id text,
  name text not null,
  language text not null default 'pt_BR',
  category text not null default 'MARKETING',
  status text not null default 'PENDING',
  components jsonb not null default '[]'::jsonb,
  variable_mapping jsonb not null default '{}'::jsonb,
  button_text text,
  raw_meta jsonb,
  created_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  last_sync_at timestamptz
);
create unique index if not exists whatsapp_templates_name_language_key on public.whatsapp_templates (lower(name), language);
create index if not exists whatsapp_templates_meta_id_idx on public.whatsapp_templates (meta_template_id) where meta_template_id is not null;

-- Destino do link (item 15 do pedido): tela pública ATUAL de /simulacao já
-- decide entre Atendimento Rápido/Simulação via LinkJourneyGate — esta coluna
-- só ensina esse mesmo componente a PULAR a tela de escolha quando o link
-- pertence a uma campanha configurada para abrir direto num dos dois
-- formulários. Default 'choice' preserva EXATAMENTE o comportamento atual
-- para toda campanha/link já existente (nunca pula a escolha sem essa
-- configuração explícita).
alter table public.campaigns
  add column if not exists link_journey text not null default 'choice'
  check (link_journey in ('quick_service', 'simulation', 'choice'));

-- Um "Disparo" = um lote/campanha de envio. Sempre associado a UMA linha em
-- campaigns (kind='custom', destination_type='roulette' — o lead cai na
-- roleta já existente) para reaproveitar 100% do link/tracking já existente
-- (buildCampaignLink, track-view, client_origins) em vez de inventar uma
-- segunda forma de rastrear origem.
create table if not exists public.whatsapp_broadcasts (
  id uuid primary key default gen_random_uuid(),
  campaign_name text not null,
  template_id uuid references public.whatsapp_templates(id),
  template_meta_id text,
  template_name text not null,
  template_category text,
  template_language text not null default 'pt_BR',
  variable_mapping jsonb not null default '{}'::jsonb,
  button_text text,
  destination_journey text not null default 'choice' check (destination_journey in ('quick_service', 'simulation', 'choice')),
  link_campaign_id uuid references public.campaigns(id),
  source_type text not null default 'base' check (source_type in ('base', 'csv')),
  status text not null default 'draft' check (status in ('draft', 'queued', 'processing', 'completed', 'failed', 'canceled')),
  created_by uuid references public.admin_users(id),
  started_by uuid references public.admin_users(id),
  created_at timestamptz not null default now(),
  started_at timestamptz,
  finished_at timestamptz,
  total_selected integer not null default 0,
  total_invalid integer not null default 0,
  total_blocked integer not null default 0,
  total_queued integer not null default 0,
  total_sent integer not null default 0,
  total_delivered integer not null default 0,
  total_read integer not null default 0,
  total_failed integer not null default 0
);
create index if not exists whatsapp_broadcasts_status_idx on public.whatsapp_broadcasts (status);
create index if not exists whatsapp_broadcasts_created_idx on public.whatsapp_broadcasts (created_at desc);

-- Um destinatário do lote. contact_id referencia prospecting_contacts quando
-- a fonte foi a Base da Imobiliária (item 11); nulo quando a fonte foi CSV
-- avulso (item 14 — CSV não vira Base da Imobiliária automaticamente).
create table if not exists public.whatsapp_broadcast_messages (
  id uuid primary key default gen_random_uuid(),
  broadcast_id uuid not null references public.whatsapp_broadcasts(id) on delete cascade,
  contact_id uuid references public.prospecting_contacts(id),
  full_name text not null,
  phone_normalized text not null,
  variables jsonb not null default '{}'::jsonb,
  whatsapp_message_id text,
  status text not null default 'queued' check (status in ('queued', 'processing', 'sent', 'delivered', 'read', 'failed')),
  attempts integer not null default 0,
  error_code text,
  error_message text,
  queued_at timestamptz not null default now(),
  sent_at timestamptz,
  delivered_at timestamptz,
  read_at timestamptz,
  failed_at timestamptz
);
create index if not exists whatsapp_broadcast_messages_broadcast_idx on public.whatsapp_broadcast_messages (broadcast_id, status);
-- Fila do cron: só precisa achar rapidamente "o que ainda falta processar",
-- de qualquer lote — índice parcial pequeno mesmo com histórico grande.
create index if not exists whatsapp_broadcast_messages_pending_idx on public.whatsapp_broadcast_messages (broadcast_id, id) where status in ('queued', 'processing');
-- whatsapp_message_id chega DEPOIS do envio (nulo em 'queued'/'processing'/
-- 'failed' sem tentativa bem-sucedida) — índice único parcial permite vários
-- nulos e ainda garante que o webhook (item 33) sempre acha no máximo 1 linha
-- por Message ID da Meta.
create unique index if not exists whatsapp_broadcast_messages_wamid_key on public.whatsapp_broadcast_messages (whatsapp_message_id) where whatsapp_message_id is not null;
