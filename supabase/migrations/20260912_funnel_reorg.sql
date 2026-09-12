-- Reorganização do funil comercial (8 macroetapas): adiciona os 2 novos status
-- de Reunião (aditivo — nenhum status/valor existente é removido ou renomeado
-- no banco; os 8 status legados de venda continuam válidos por compatibilidade
-- histórica e todos contam como a macroetapa "Venda" na aplicação).
alter table public.simulation_registrations drop constraint if exists simulation_registrations_status_check;
alter table public.simulation_registrations add constraint simulation_registrations_status_check check (
  status in (
    'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
    'documentation_pending', 'documents_pending', 'approval_pending', 'restriction', 'shielding',
    'approved', 'rejected', 'meeting_pending', 'meeting_done',
    'sale_completed', 'sale_forms', 'sale_reservation', 'sale_contract',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived', 'do_not_contact'
  )
);

alter table public.client_status_history drop constraint if exists client_status_history_previous_status_check;
alter table public.client_status_history drop constraint if exists client_status_history_new_status_check;
alter table public.client_status_history add constraint client_status_history_previous_status_check check (
  previous_status is null or previous_status in (
    'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
    'documentation_pending', 'documents_pending', 'approval_pending', 'restriction', 'shielding',
    'approved', 'rejected', 'meeting_pending', 'meeting_done',
    'sale_completed', 'sale_forms', 'sale_reservation', 'sale_contract',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived', 'do_not_contact'
  )
);
alter table public.client_status_history add constraint client_status_history_new_status_check check (
  new_status in (
    'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
    'documentation_pending', 'documents_pending', 'approval_pending', 'restriction', 'shielding',
    'approved', 'rejected', 'meeting_pending', 'meeting_done',
    'sale_completed', 'sale_forms', 'sale_reservation', 'sale_contract',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived', 'do_not_contact'
  )
);

-- Origem do registro de histórico (ex.: 'automatico_por_venda', quando o
-- corretor pula direto para Venda sem passar por Reunião) — null = manual,
-- como sempre foi.
alter table public.client_status_history add column if not exists source text;
