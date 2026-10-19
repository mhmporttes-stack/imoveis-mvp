-- SIM-AUTO (regra do dono, 2026-10-19): novo status "Simulação automática" (auto_simulation), logo depois de
-- "Aguardando simulação". O cadastro do site elegível ao MCMV já sai com a simulação automática gravada (novo + usado)
-- e o link da apresentação pronto; o corretor ainda confirma no simulador da Caixa. Idempotente.
-- Enquanto esta migration não for aplicada, o código mantém o cliente em "Aguardando simulação" (erro 23514 tratado).

-- 1) Status aceito no cliente e no histórico (mesma lista de 20261001200000 + auto_simulation).
alter table public.simulation_registrations drop constraint if exists simulation_registrations_status_check;
alter table public.simulation_registrations add constraint simulation_registrations_status_check check (status = any (array[
  'automated_service', 'pending', 'auto_simulation', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
  'documentation_pending', 'documents_pending', 'approval_pending', 'income_commitment', 'cancellation_letter',
  'research_mo', 'restriction', 'shielding', 'approved', 'rejected', 'meeting_pending', 'meeting_done',
  'sale_completed', 'sale_forms', 'sale_reservation', 'sale_compliance', 'sale_contract', 'sale_caixa_signature',
  'sale_itbi', 'sale_registry', 'sale_payment', 'sale_paid', 'archived', 'do_not_contact'
]::text[]));

alter table public.client_status_history drop constraint if exists client_status_history_new_status_check;
alter table public.client_status_history add constraint client_status_history_new_status_check check (new_status = any (array[
  'automated_service', 'pending', 'auto_simulation', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
  'documentation_pending', 'documents_pending', 'approval_pending', 'income_commitment', 'cancellation_letter',
  'research_mo', 'restriction', 'shielding', 'approved', 'rejected', 'meeting_pending', 'meeting_done',
  'sale_completed', 'sale_forms', 'sale_reservation', 'sale_compliance', 'sale_contract', 'sale_caixa_signature',
  'sale_itbi', 'sale_registry', 'sale_payment', 'sale_paid', 'archived', 'do_not_contact'
]::text[]));

alter table public.client_status_history drop constraint if exists client_status_history_previous_status_check;
alter table public.client_status_history add constraint client_status_history_previous_status_check check (previous_status is null or previous_status = any (array[
  'automated_service', 'pending', 'auto_simulation', 'completed', 'simulation_sent', 'in_service', 'awaiting_return',
  'documentation_pending', 'documents_pending', 'approval_pending', 'income_commitment', 'cancellation_letter',
  'research_mo', 'restriction', 'shielding', 'approved', 'rejected', 'meeting_pending', 'meeting_done',
  'sale_completed', 'sale_forms', 'sale_reservation', 'sale_compliance', 'sale_contract', 'sale_caixa_signature',
  'sale_itbi', 'sale_registry', 'sale_payment', 'sale_paid', 'archived', 'do_not_contact'
]::text[]));

-- 2) Roleta: "lead novo aguardando contato" (ROL-2) também vale para quem está em "Simulação automática" — a mesma
--    função de hoje, trocando só a comparação de status (sem reescrever o resto à mão).
do $$
declare
  definition text;
begin
  select pg_get_functiondef('public.pick_round_robin_broker(uuid)'::regprocedure) into definition;
  if position($q$r.status = 'pending'$q$ in definition) > 0 then
    execute replace(definition, $q$r.status = 'pending'$q$, $q$r.status in ('pending', 'auto_simulation')$q$);
  end if;
end $$;

-- 3) Minha Jornada: o novo status mostra ao cliente o mesmo texto de "Aguardando simulação" ("Preparando sua
--    simulação") — a simulação final ainda é do corretor. Não sobrescreve se o dono já tiver configurado.
update public.crm_settings
   set setting_value = setting_value || jsonb_build_object('auto_simulation', setting_value->'pending')
 where id = 'client_journey_statuses'
   and setting_value ? 'pending'
   and not (setting_value ? 'auto_simulation');
