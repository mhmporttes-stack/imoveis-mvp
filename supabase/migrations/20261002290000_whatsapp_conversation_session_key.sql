-- Chat do WhatsApp: a conversa passa a ser identificada por (telefone do
-- contato + SESSÃO/número do WhatsApp que conversa com ele), não só pelo
-- telefone. Causa raiz do cruzamento entre corretores (2026-10-02): havia UMA
-- conversa por telefone (UNIQUE(contact_phone)) compartilhada por todas as
-- sessões — preview, não lidas, atribuição e envio viravam do "último que
-- falou". Mesmo cliente falando com dois WhatsApps = duas conversas.
--
-- PARTE 1 (aditiva, compatível com o código antigo): coluna + índice novo +
-- classificação das conversas que já são de uma só linha. A separação das
-- conversas misturadas e a troca do UNIQUE antigo ficam na PARTE 2
-- (20261002290100), aplicada DEPOIS do deploy do código novo.

alter table public.whatsapp_conversations
  add column if not exists session_key uuid not null default '00000000-0000-0000-0000-000000000000';

comment on column public.whatsapp_conversations.session_key is
  'Sessão do WhatsApp desta conversa: 00000000-0000-0000-0000-000000000000 = número oficial/sem sessão pessoal; senão admin_users.id do dono do WhatsApp pessoal. Identidade da conversa = (contact_phone, session_key).';

create index if not exists whatsapp_conversations_session_key_idx
  on public.whatsapp_conversations (session_key);

-- Aditivo: o UNIQUE(contact_phone) antigo ainda vale (mais restritivo), então
-- este índice nunca falha na criação.
create unique index if not exists whatsapp_conversations_phone_session_uidx
  on public.whatsapp_conversations (contact_phone, session_key);

-- Classifica as conversas do número oficial (chave vazia) que na verdade são
-- de UM WhatsApp pessoal. Critério (evidência = message.session_user_id, gravado
-- pela sessão que recebeu/enviou):
--   1) o atribuído da conversa é uma das sessões que falou nela -> é a linha dele;
--   2) senão, se não há mensagem do número oficial, a sessão da mensagem mais
--      recente é a dona;
--   3) senão (há mensagem do oficial e o atribuído não é sessão): continua oficial.
-- Idempotente; só mexe em conversas ainda com chave vazia.
create or replace function public.whatsapp_classify_conversation_sessions()
returns integer
language plpgsql
as $$
declare
  v_count integer;
begin
  with stats as (
    select c.id,
           c.assigned_user_id,
           array_agg(distinct m.session_user_id) filter (where m.session_user_id is not null) as sessions,
           coalesce(bool_or(m.channel = 'whatsapp_cloud_api' and m.direction <> 'internal'), false) as has_official,
           (array_agg(m.session_user_id order by m.message_at desc) filter (where m.session_user_id is not null))[1] as latest_session
      from public.whatsapp_conversations c
      join public.whatsapp_messages m on m.conversation_id = c.id
     where c.session_key = '00000000-0000-0000-0000-000000000000'
     group by c.id, c.assigned_user_id
  ), pick as (
    select id,
           case
             when assigned_user_id = any(sessions) then assigned_user_id
             when not has_official then latest_session
             else null
           end as keeper
      from stats
     where sessions is not null
  )
  update public.whatsapp_conversations c
     set session_key = p.keeper
    from pick p
   where c.id = p.id
     and p.keeper is not null;
  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

select public.whatsapp_classify_conversation_sessions();

-- Cliente transferido: só as conversas do número oficial acompanham o novo
-- responsável. A conversa do WhatsApp pessoal do corretor anterior continua
-- dele (é o número dele); o novo responsável abre a própria conversa.
create or replace function public.sync_whatsapp_conversation_assignee()
returns trigger
language plpgsql
as $$
begin
  if new.responsible_user_id is distinct from old.responsible_user_id then
    update public.whatsapp_conversations
       set assigned_user_id = new.responsible_user_id,
           updated_at = now()
     where client_id = new.id
       and session_key in ('00000000-0000-0000-0000-000000000000', coalesce(new.responsible_user_id, '00000000-0000-0000-0000-000000000000'));
  end if;
  return new;
end;
$$;
