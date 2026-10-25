-- Messenger oficial da Página do Facebook (MSG-1, REGRA OFICIAL — dono, 2026-10-25), fase 1: receber e responder pelo
-- CRM. As conversas entram no Chat Marketplace (marketplace_conversations/marketplace_messages) com
-- thread_key = 'messenger:<PSID>' (o PSID já é único pelo unique de thread_key; a mensagem é idempotente pelo mid no
-- índice único (conversation_id, external_id) que já existe). Aqui só as marcas próprias do Messenger:
--   messenger_ad_referral_at  última mensagem que veio de anúncio de clique para o Messenger (janela de até 7 dias)
--   messenger_delivered_at    marca d'água de entrega da Meta (nossas mensagens até aqui foram entregues)
--   messenger_read_at         marca d'água de leitura da Meta (nossas mensagens até aqui foram lidas)
-- Aditiva e idempotente; sem DROP; nenhuma linha existente muda (colunas nulas no Marketplace). Código:
-- lib/messenger.js, lib/messenger-core.mjs, lib/marketplace-chat.js. Aplicar ANTES de configurar o webhook na Meta.

alter table public.marketplace_conversations add column if not exists messenger_ad_referral_at timestamptz;
alter table public.marketplace_conversations add column if not exists messenger_delivered_at timestamptz;
alter table public.marketplace_conversations add column if not exists messenger_read_at timestamptz;

comment on column public.marketplace_conversations.messenger_ad_referral_at is 'MSG-1: última mensagem do cliente vinda de anúncio de clique para o Messenger (janela de resposta de até 7 dias). Só conversas messenger:<PSID>.';
comment on column public.marketplace_conversations.messenger_delivered_at is 'MSG-1: marca d''água de entrega do Messenger (webhook message_deliveries).';
comment on column public.marketplace_conversations.messenger_read_at is 'MSG-1: marca d''água de leitura do Messenger (webhook message_reads).';
