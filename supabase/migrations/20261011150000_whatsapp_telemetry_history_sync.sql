-- Telemetria: evento 'history_sync' (2026-10-11) — por lote de histórico recebido ao parear: quantas mensagens o WhatsApp
-- mandou, quantas viraram itens e quantos lotes o CRM aceitou. Sem conteúdo nem telefone.
alter table public.whatsapp_session_telemetry drop constraint if exists whatsapp_session_telemetry_event_type_check;
alter table public.whatsapp_session_telemetry
  add constraint whatsapp_session_telemetry_event_type_check check (event_type in (
    'service_boot', 'service_shutdown', 'resume_skipped', 'resume_done',
    'cycle_start', 'cycle_end', 'connect_attempt', 'connected', 'disconnected',
    'retry_scheduled', 'interrupted_limit', 'intervention_required',
    'lease_acquired', 'lease_waiting', 'lease_released', 'lease_lost', 'lease_unavailable',
    'session_reconciled', 'history_sync'
  ));
