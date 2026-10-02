-- [REGRA OFICIAL — dono, 2026-10-02, refina WA-13] Cliente DESARQUIVADO não
-- recupera a conversa antiga: o histórico do Chat dele é APAGADO e a próxima
-- mensagem/abertura começa uma conversa nova, como se nunca tivesse existido.
-- Escopo: só o Chat (whatsapp_conversations ocultas do cliente e, em
-- cascata, whatsapp_messages e o progresso do Guia). Card, funil, histórico
-- de status, atividades, documentos, Prospecção e Meta Diária não mudam.
-- Fica um registro de auditoria (só contagem, sem conteúdo).
-- Substitui o "desarquivar devolve as conversas" da 20261002320000.

create or replace function public.whatsapp_sync_archived_client_conversations()
 returns trigger
 language plpgsql
 set search_path to 'public'
as $function$
begin
  if new.status = 'archived' and old.status is distinct from 'archived' then
    with hidden as (
      update public.whatsapp_conversations c set
        deleted_at = now(), deleted_by = null, unread_count = 0,
        origin = coalesce(c.origin, '{}'::jsonb) || jsonb_build_object('archived_hidden_at', now()),
        updated_at = now()
      where c.client_id = new.id and c.deleted_at is null
      returning c.id, c.contact_phone
    )
    insert into public.whatsapp_conversation_audit (conversation_id, client_id, contact_phone, action, detail)
    select id, new.id, contact_phone, 'deleted', jsonb_build_object('reason', 'cliente arquivado', 'archived_client', true) from hidden;
  elsif old.status = 'archived' and new.status is distinct from 'archived' then
    insert into public.whatsapp_conversation_audit (conversation_id, client_id, contact_phone, action, detail)
    select c.id, new.id, c.contact_phone, 'deleted',
           jsonb_build_object('purged', true, 'reason', 'cliente desarquivado — histórico do Chat apagado',
                              'messages', (select count(*) from public.whatsapp_messages m where m.conversation_id = c.id))
      from public.whatsapp_conversations c
     where c.client_id = new.id and c.deleted_at is not null;
    delete from public.whatsapp_conversations c
     where c.client_id = new.id and c.deleted_at is not null;
  end if;
  return new;
end;
$function$;

revoke all on function public.whatsapp_sync_archived_client_conversations() from public, anon, authenticated;
