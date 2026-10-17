-- Fila de reativação dos clientes TRANSFERIDOS pelo fluxo de clientes que esfriaram (FUN-15l).
-- [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-17] "Os clientes devem seguir a regra da roleta, volte todos que não foram
-- contactados para a fila, quem fica on-line recebe 1 e depois de 3 minutos recebe outro depois de 3 minutos se não
-- for enviada nenhuma mensagem ele volta para a roleta para o final da fila de distribuição e espera outro corretor
-- ficar online". Só ACRESCENTA colunas (nulas = caso antigo, fora da fila); idempotente.
-- Regras: lib/cooled-clients-reactivation-core.mjs; servidor: lib/cooled-clients-reactivation.js.
-- O código tolera esta migration ainda não aplicada: sem as colunas, a transferência segue o caminho antigo
-- (roleta direta) e a rotina da fila não roda.

alter table public.cooled_client_cases
  add column if not exists reactivation_status text,
  add column if not exists reactivation_queued_at timestamptz,
  add column if not exists reactivation_offered_to uuid references public.admin_users(id) on delete set null,
  add column if not exists reactivation_offered_at timestamptz,
  add column if not exists reactivation_kept_at timestamptz,
  add column if not exists reactivation_rounds integer not null default 0;

do $$
begin
  if not exists (select 1 from pg_constraint where conname = 'cooled_client_cases_reactivation_status_check') then
    alter table public.cooled_client_cases
      add constraint cooled_client_cases_reactivation_status_check
      check (reactivation_status is null or reactivation_status in ('queued', 'offered', 'kept', 'left'));
  end if;
end $$;

-- Fila (ordem de chegada) e prazos em andamento.
create index if not exists cooled_client_cases_reactivation_open_idx
  on public.cooled_client_cases (reactivation_status, reactivation_queued_at)
  where reactivation_status in ('queued', 'offered');

-- Espaçamento de 3 min por corretor (última entrega de cada um).
create index if not exists cooled_client_cases_reactivation_offer_idx
  on public.cooled_client_cases (reactivation_offered_to, reactivation_offered_at desc)
  where reactivation_offered_at is not null;
