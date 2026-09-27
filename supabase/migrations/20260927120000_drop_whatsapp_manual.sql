-- Remove o WhatsApp Manual (feature descontinuada, pedido do dono em 2026-09-27):
-- apaga o histórico de cliques manuais e os modelos de texto salvos. Nenhuma outra
-- tabela referencia whatsapp_manual_log (sem FK de fora). Idempotente.
drop table if exists public.whatsapp_manual_log;
delete from public.crm_settings where id = 'whatsapp_manual_templates';
