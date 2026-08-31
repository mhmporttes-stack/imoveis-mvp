alter table public.simulation_registrations
  drop constraint if exists simulation_registrations_status_check;

alter table public.simulation_registrations
  add constraint simulation_registrations_status_check check (
    status in (
      'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
      'documentation_pending', 'documents_pending', 'approval_pending', 'shielding',
      'approved', 'rejected', 'sale_completed', 'sale_forms', 'sale_reservation',
      'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived'
    )
  );

alter table public.client_status_history
  drop constraint if exists client_status_history_previous_status_check;

alter table public.client_status_history
  drop constraint if exists client_status_history_new_status_check;

alter table public.client_status_history
  add constraint client_status_history_previous_status_check check (
    previous_status is null or previous_status in (
      'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
      'documentation_pending', 'documents_pending', 'approval_pending', 'shielding',
      'approved', 'rejected', 'sale_completed', 'sale_forms', 'sale_reservation',
      'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived'
    )
  );

alter table public.client_status_history
  add constraint client_status_history_new_status_check check (
    new_status in (
      'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
      'documentation_pending', 'documents_pending', 'approval_pending', 'shielding',
      'approved', 'rejected', 'sale_completed', 'sale_forms', 'sale_reservation',
      'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived'
    )
  );
