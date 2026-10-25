-- CLI-7c (REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-25): novo status "Aguardando contato" (awaiting_contact), logo antes
-- de "Tentando contato". Cliente transferido vai para ele (o novo corretor ainda não tentou contato); o clique no
-- WhatsApp ou a mensagem pelo Chat passa para "Tentando contato". Idempotente.
-- Enquanto esta migration não for aplicada, a transferência continua funcionando e só a troca de status falha (erro
-- 23514 no log do servidor, "[transferência] falha ao mudar o cliente para Aguardando contato").

-- 1) Status aceito no cliente e no histórico (mesma lista de 20261019180000 + awaiting_contact).
alter table public.simulation_registrations drop constraint if exists simulation_registrations_status_check;
alter table public.simulation_registrations add constraint simulation_registrations_status_check check (status = any (array[
  'automated_service', 'pending', 'auto_simulation', 'completed', 'simulation_sent', 'in_service', 'awaiting_contact',
  'awaiting_return', 'documentation_pending', 'documents_pending', 'approval_pending', 'income_commitment',
  'cancellation_letter', 'research_mo', 'restriction', 'shielding', 'approved', 'rejected', 'meeting_pending',
  'meeting_done', 'sale_completed', 'sale_forms', 'sale_reservation', 'sale_compliance', 'sale_contract',
  'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'sale_paid', 'archived', 'do_not_contact'
]::text[]));

alter table public.client_status_history drop constraint if exists client_status_history_new_status_check;
alter table public.client_status_history add constraint client_status_history_new_status_check check (new_status = any (array[
  'automated_service', 'pending', 'auto_simulation', 'completed', 'simulation_sent', 'in_service', 'awaiting_contact',
  'awaiting_return', 'documentation_pending', 'documents_pending', 'approval_pending', 'income_commitment',
  'cancellation_letter', 'research_mo', 'restriction', 'shielding', 'approved', 'rejected', 'meeting_pending',
  'meeting_done', 'sale_completed', 'sale_forms', 'sale_reservation', 'sale_compliance', 'sale_contract',
  'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'sale_paid', 'archived', 'do_not_contact'
]::text[]));

alter table public.client_status_history drop constraint if exists client_status_history_previous_status_check;
alter table public.client_status_history add constraint client_status_history_previous_status_check check (previous_status is null or previous_status = any (array[
  'automated_service', 'pending', 'auto_simulation', 'completed', 'simulation_sent', 'in_service', 'awaiting_contact',
  'awaiting_return', 'documentation_pending', 'documents_pending', 'approval_pending', 'income_commitment',
  'cancellation_letter', 'research_mo', 'restriction', 'shielding', 'approved', 'rejected', 'meeting_pending',
  'meeting_done', 'sale_completed', 'sale_forms', 'sale_reservation', 'sale_compliance', 'sale_contract',
  'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'sale_paid', 'archived', 'do_not_contact'
]::text[]));

-- 2) Minha Jornada: o novo status mostra ao cliente o mesmo texto de "Tentando contato" (o código já usa esse texto
--    como reserva). Não sobrescreve se o dono já tiver configurado.
update public.crm_settings
   set setting_value = setting_value || jsonb_build_object('awaiting_contact', setting_value->'awaiting_return')
 where id = 'client_journey_statuses'
   and setting_value ? 'awaiting_return'
   and not (setting_value ? 'awaiting_contact');
