-- DOIS números de WhatsApp individual por corretor — PARTE 2 (ver 20261008160000).
-- Aplicar DEPOIS do deploy do código novo (que grava com ON CONFLICT (user_id, slot) e
-- (contact_phone, session_key, session_slot)). Não apaga nenhuma linha nem credencial:
--   1) a chave primária da sessão passa de (user_id) para (user_id, slot), reaproveitando o índice único
--      criado na parte 1 — sem isso o Número 2 não consegue gravar a própria linha;
--   2) sai o UNIQUE (contact_phone, session_key) da conversa — o novo (com session_slot) já existe.
-- Idempotente: só troca a PK se ela ainda for só (user_id).

do $$
declare
  v_pk_name text;
  v_pk_def text;
begin
  select c.conname, pg_get_constraintdef(c.oid)
    into v_pk_name, v_pk_def
    from pg_constraint c
   where c.conrelid = 'public.whatsapp_individual_sessions'::regclass
     and c.contype = 'p';

  if v_pk_def = 'PRIMARY KEY (user_id)' then
    execute format('alter table public.whatsapp_individual_sessions drop constraint %I', v_pk_name);
    alter table public.whatsapp_individual_sessions
      add constraint whatsapp_individual_sessions_pkey primary key using index whatsapp_individual_sessions_user_slot_uidx;
  end if;
end $$;

drop index if exists public.whatsapp_conversations_phone_session_uidx;
