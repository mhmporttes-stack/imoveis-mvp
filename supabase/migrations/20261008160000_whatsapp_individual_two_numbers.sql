-- DOIS números de WhatsApp individual por corretor (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-08).
-- PARTE 1 (aditiva, idempotente, compatível com o código ANTERIOR): aplicar ANTES do deploy do código novo.
-- Nada é apagado nem reescrito; toda linha existente vira o "Número 1" pelo default (slot = 1), com as
-- MESMAS chaves de hoje (user_id da sessão, session_key/session_user_id = id do corretor). Credenciais,
-- lease e sessões conectadas não são tocados.
-- A troca da chave primária (user_id -> user_id + slot) e a saída do UNIQUE antigo da conversa ficam na
-- PARTE 2 (20261008160100), aplicada DEPOIS do deploy do código novo (o código antigo usa ON CONFLICT (user_id)).

-- 1) Sessões: número (1/2), apelido e chave "Usar para disparo" (NULL = padrão: ligado no 1, desligado no 2).
alter table public.whatsapp_individual_sessions
  add column if not exists slot smallint not null default 1,
  add column if not exists label text,
  add column if not exists dispatch_enabled boolean;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_individual_sessions_slot_check') then
    alter table public.whatsapp_individual_sessions
      add constraint whatsapp_individual_sessions_slot_check check (slot in (1, 2));
  end if;
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_individual_sessions_label_check') then
    alter table public.whatsapp_individual_sessions
      add constraint whatsapp_individual_sessions_label_check check (label is null or char_length(label) <= 30);
  end if;
end $$;

-- Hoje user_id já é único (PK), então este índice nunca falha na criação. Vira a PK na parte 2.
create unique index if not exists whatsapp_individual_sessions_user_slot_uidx
  on public.whatsapp_individual_sessions (user_id, slot);

comment on column public.whatsapp_individual_sessions.slot is
  '1 = Número 1 (id da sessão no microsserviço = user_id, igual a antes); 2 = Número 2 (id "<user_id>:2").';
comment on column public.whatsapp_individual_sessions.dispatch_enabled is
  'Usar para disparo (Meta Diária automática). NULL = padrão do número: ligado no 1, desligado no 2.';

-- 2) Conversa: identidade passa a ser (telefone, session_key, session_slot). session_key continua = dono.
alter table public.whatsapp_conversations
  add column if not exists session_slot smallint not null default 1;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'whatsapp_conversations_session_slot_check') then
    alter table public.whatsapp_conversations
      add constraint whatsapp_conversations_session_slot_check check (session_slot in (1, 2)) not valid;
  end if;
end $$;

-- Aditivo: o UNIQUE (contact_phone, session_key) antigo continua valendo (mais restritivo) até a parte 2.
create unique index if not exists whatsapp_conversations_phone_session_slot_uidx
  on public.whatsapp_conversations (contact_phone, session_key, session_slot);

comment on column public.whatsapp_conversations.session_slot is
  'Número do WhatsApp pessoal do dono da sessão (1/2). Conversas do número oficial ficam com 1 (sem significado).';

-- 3) Mensagem: por qual número do corretor saiu/chegou (1 = tudo que existia antes).
alter table public.whatsapp_messages
  add column if not exists session_slot smallint not null default 1;

-- 4) Fila da Meta Diária automática: por qual número cada envio saiu (NULL = antes desta mudança / ainda não enviado).
alter table if exists public.daily_goal_auto_queue
  add column if not exists session_slot smallint;

-- 5) Telemetria de conexão: o número (1/2) de cada evento.
alter table if exists public.whatsapp_session_telemetry
  add column if not exists session_slot smallint not null default 1;
