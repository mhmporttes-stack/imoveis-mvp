alter table public.simulation_registrations drop constraint if exists simulation_registrations_status_check;

update public.simulation_registrations registration
set status = 'do_not_contact', last_status_change_at = coalesce(contact.do_not_contact_at, registration.last_status_change_at, now())
from public.prospecting_contacts contact
where contact.registration_id = registration.id
  and contact.status = 'do_not_contact';

update public.simulation_registrations set status = 'sale_registry' where status in ('sale_itbi', 'sale_payment');

alter table public.simulation_registrations add constraint simulation_registrations_status_check check (
  status in (
    'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
    'documentation_pending', 'documents_pending', 'approval_pending', 'restriction', 'shielding',
    'approved', 'rejected', 'sale_completed', 'sale_forms', 'sale_reservation',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived', 'do_not_contact'
  )
);

alter table public.client_status_history drop constraint if exists client_status_history_previous_status_check;
alter table public.client_status_history drop constraint if exists client_status_history_new_status_check;
alter table public.client_status_history add constraint client_status_history_previous_status_check check (
  previous_status is null or previous_status in (
    'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
    'documentation_pending', 'documents_pending', 'approval_pending', 'restriction', 'shielding',
    'approved', 'rejected', 'sale_completed', 'sale_forms', 'sale_reservation',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived', 'do_not_contact'
  )
);
alter table public.client_status_history add constraint client_status_history_new_status_check check (
  new_status in (
    'pending', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
    'documentation_pending', 'documents_pending', 'approval_pending', 'restriction', 'shielding',
    'approved', 'rejected', 'sale_completed', 'sale_forms', 'sale_reservation',
    'sale_caixa_signature', 'sale_itbi', 'sale_registry', 'sale_payment', 'archived', 'do_not_contact'
  )
);
