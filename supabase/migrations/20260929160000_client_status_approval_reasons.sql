-- Três novos status manuais dentro da aba "Aprovação" (regra do dono, 2026-09-29):
-- "Comprometimento de renda" (income_commitment), "Carta de cancelamento"
-- (cancellation_letter) e "M.O de pesquisa" (research_mo) — mesmo nível de
-- Restrição/Blindagem/Reprovado, escolhidos manualmente pelo corretor/gestor
-- no seletor de status do card do cliente. Idempotente.

alter table public.simulation_registrations drop constraint if exists simulation_registrations_status_check;
alter table public.simulation_registrations add constraint simulation_registrations_status_check check (status = any (array[
  'automated_service', 'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
  'documentation_pending', 'documents_pending', 'approval_pending', 'income_commitment', 'cancellation_letter',
  'research_mo', 'restriction', 'shielding', 'approved', 'rejected', 'meeting_pending', 'meeting_done',
  'sale_completed', 'sale_forms', 'sale_reservation', 'sale_contract', 'sale_caixa_signature', 'sale_itbi',
  'sale_registry', 'sale_payment', 'archived', 'do_not_contact'
]::text[]));

alter table public.client_status_history drop constraint if exists client_status_history_new_status_check;
alter table public.client_status_history add constraint client_status_history_new_status_check check (new_status = any (array[
  'automated_service', 'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
  'documentation_pending', 'documents_pending', 'approval_pending', 'income_commitment', 'cancellation_letter',
  'research_mo', 'restriction', 'shielding', 'approved', 'rejected', 'meeting_pending', 'meeting_done',
  'sale_completed', 'sale_forms', 'sale_reservation', 'sale_contract', 'sale_caixa_signature', 'sale_itbi',
  'sale_registry', 'sale_payment', 'archived', 'do_not_contact'
]::text[]));

alter table public.client_status_history drop constraint if exists client_status_history_previous_status_check;
alter table public.client_status_history add constraint client_status_history_previous_status_check check (previous_status is null or previous_status = any (array[
  'automated_service', 'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
  'documentation_pending', 'documents_pending', 'approval_pending', 'income_commitment', 'cancellation_letter',
  'research_mo', 'restriction', 'shielding', 'approved', 'rejected', 'meeting_pending', 'meeting_done',
  'sale_completed', 'sale_forms', 'sale_reservation', 'sale_contract', 'sale_caixa_signature', 'sale_itbi',
  'sale_registry', 'sale_payment', 'archived', 'do_not_contact'
]::text[]));
