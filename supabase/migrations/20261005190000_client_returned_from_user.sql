-- Cliente devolvido à fila DEPOIS de um disparo (2026-10-05): a Prospecção
-- (retorno automático, hibernação, "Devolver", rebalanceamento da carteira 30)
-- tira o responsável do cliente (responsible_user_id = null, regra P-05). Quem
-- disparou deixava de ENCONTRAR o cliente — pesquisa por telefone/nome vazia —
-- e não conseguia marcar "Não contactar" quando a resposta era "número errado".
-- Esta coluna guarda QUEM era o responsável na devolução; o app a usa só para
-- dar acesso (busca, ficha, status) enquanto o cliente continua sem responsável.
-- Gatilho em vez de mudar cada caminho de devolução: cobre os caminhos em JS e
-- a função SQL daily_goal_wallet_trim. Aditiva e idempotente.

alter table public.simulation_registrations
  add column if not exists returned_from_user_id uuid;

comment on column public.simulation_registrations.returned_from_user_id is
  'Quem era o responsável quando a Prospecção devolveu o cliente à fila (responsible_user_id nulo). Só dá acesso (busca/ficha) ao corretor que disparou; zera quando alguém vira responsável.';

create index if not exists simulation_registrations_returned_from_idx
  on public.simulation_registrations (returned_from_user_id)
  where responsible_user_id is null and returned_from_user_id is not null;

create or replace function public.client_returned_from_user()
returns trigger
language plpgsql
as $$
begin
  if new.responsible_user_id is not null then
    new.returned_from_user_id := null;
  elsif old.responsible_user_id is not null and new.status = 'awaiting_return' then
    new.returned_from_user_id := old.responsible_user_id;
  end if;
  return new;
end;
$$;

drop trigger if exists client_returned_from_user on public.simulation_registrations;
create trigger client_returned_from_user
  before update of responsible_user_id on public.simulation_registrations
  for each row execute function public.client_returned_from_user();

-- Já devolvidos antes desta migration: o corretor do contato (last_broker_id)
-- é quem fez o último disparo.
update public.simulation_registrations r
   set returned_from_user_id = c.last_broker_id
  from public.prospecting_contacts c
 where c.id = r.prospecting_contact_id
   and r.responsible_user_id is null
   and r.status = 'awaiting_return'
   and r.returned_from_user_id is null
   and c.last_broker_id is not null
   and c.status = 'recent_attempt';
