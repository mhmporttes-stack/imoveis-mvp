-- A auditoria do Chat recusava (em silêncio) as ações gravadas pelo código além de deleted/restored_*: troca de status,
-- edição e "apagar para todos" (2026-10-02) e agora Particular (2026-10-09). Amplia a lista permitida.
alter table public.whatsapp_conversation_audit drop constraint if exists whatsapp_conversation_audit_action_check;
alter table public.whatsapp_conversation_audit add constraint whatsapp_conversation_audit_action_check
  check (action in ('deleted', 'restored_by_inbound', 'restored_by_open', 'status_changed', 'message_edited', 'message_deleted_for_everyone', 'private_on', 'private_off'));
