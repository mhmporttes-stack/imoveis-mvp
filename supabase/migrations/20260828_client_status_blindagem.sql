do $$
begin
  if to_regclass('public.simulation_registrations') is not null then
    if exists (
      select 1
      from pg_constraint
      where conname = 'simulation_registrations_status_check'
        and conrelid = 'public.simulation_registrations'::regclass
    ) then
      alter table public.simulation_registrations
        drop constraint simulation_registrations_status_check;
    end if;

    alter table public.simulation_registrations
      add constraint simulation_registrations_status_check
      check (
        status in (
          'pending',
          'completed',
          'documentation_pending',
          'documents_pending',
          'approval_pending',
          'shielding',
          'approved',
          'rejected',
          'sale_completed',
          'archived'
        )
      );
  end if;

  if to_regclass('public.client_status_history') is not null then
    if exists (
      select 1
      from pg_constraint
      where conname = 'client_status_history_previous_status_check'
        and conrelid = 'public.client_status_history'::regclass
    ) then
      alter table public.client_status_history
        drop constraint client_status_history_previous_status_check;
    end if;

    if exists (
      select 1
      from pg_constraint
      where conname = 'client_status_history_new_status_check'
        and conrelid = 'public.client_status_history'::regclass
    ) then
      alter table public.client_status_history
        drop constraint client_status_history_new_status_check;
    end if;

    alter table public.client_status_history
      add constraint client_status_history_previous_status_check
      check (
        previous_status is null or previous_status in (
          'pending',
          'completed',
          'documentation_pending',
          'documents_pending',
          'approval_pending',
          'shielding',
          'approved',
          'rejected',
          'sale_completed',
          'archived'
        )
      );

    alter table public.client_status_history
      add constraint client_status_history_new_status_check
      check (
        new_status in (
          'pending',
          'completed',
          'documentation_pending',
          'documents_pending',
          'approval_pending',
          'shielding',
          'approved',
          'rejected',
          'sale_completed',
          'archived'
        )
      );
  end if;
end $$;
