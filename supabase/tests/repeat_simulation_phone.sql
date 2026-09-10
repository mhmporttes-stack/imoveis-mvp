-- Run in a test database or SQL editor. All test rows are rolled back.
begin;
do $$
declare
  owner_id uuid;
  saved_owner uuid;
  attempt integer;
begin
  for owner_id in select id from public.admin_users where status = 'active' loop
    for attempt in 1..2 loop
      insert into public.simulation_registrations (
        full_name, phone, phone_normalized, simulation_type, oldest_birth_date,
        primary_income_type, primary_profession, primary_monthly_income,
        primary_marital_status, has_over_three_years_registered_work,
        has_children_under_18, has_residential_property,
        available_purchase_resource, responsible_user_id
      ) values (
        'Auditoria temporaria', '(11) 99999-0000', '+5511999990000',
        'individual', '1990-01-01', 'registered_employment', 'Teste',
        3800, 'single', false, false, false, 0, owner_id
      ) returning responsible_user_id into saved_owner;
      assert saved_owner = owner_id, 'Registration owner changed';
    end loop;
  end loop;
end $$;
rollback;
