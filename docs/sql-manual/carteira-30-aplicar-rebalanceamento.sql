-- ============================================================================================
-- CARTEIRA DE NO MAXIMO 30 — APLICAR O REBALANCEAMENTO (arquivo unico, uma transacao).
-- Quem executa: a Central. Pre-requisito: migration 20261004200000_meta_diaria_carteira_30.sql ja aplicada.
-- Seguro para rodar mais de uma vez (a segunda vez nao muda nada). Nao envia mensagem, nao apaga nada,
-- nao marca ninguem como contatado, nao altera funil/etapas/historico de tentativas/pontos, nao liga cron.
-- Reverter: docs/sql-manual/carteira-30-reverter-rebalanceamento.sql (usa o run_id devolvido aqui).
-- Antes de rodar, confira o plano: docs/sql-manual/carteira-30-dry-run.sql (somente leitura).
--
-- O que faz, por corretor com mais de 30 rodadas ativas (a "Carteira ativa N/30" do card):
--   a) encerra as rodadas "zumbi" (o contato JA tinha voltado para a fila, mas a rodada continuava contando);
--   b) mantem 30 pela prioridade (protegidos > mais avancado na cadencia > contato mais recente > mais antigo);
--   c) devolve o excedente a Prospecção pelo mecanismo existente: nunca tentado -> 'available'; ja tentado ->
--      'recent_attempt' com trava de 30 dias; o cliente (se ja existir) fica SEM responsavel, na mesma etapa;
--   d) cancela so os itens PENDENTES da fila automatica das rodadas que saem (nunca ressuscita item cancelado).
-- Backup: daily_goal_wallet_trim_backup (linha inteira antes de mudar). Auditoria: daily_goal_wallet_trim_log.
-- ============================================================================================
begin;

do $$
begin
  if to_regprocedure('public.daily_goal_wallet_trim(integer, uuid)') is null then
    raise exception 'Aplique primeiro a migration 20261004200000_meta_diaria_carteira_30.sql';
  end if;
end $$;

-- Fotografia ANTES (o sistema esta no ar: cliente/contato/tentativa novos podem entrar durante a execucao,
-- por isso as contagens abaixo so podem CRESCER, nunca diminuir).
create temp table _carteira30_antes on commit drop as
select (select count(*) from public.simulation_registrations) as clientes,
       (select count(*) from public.prospecting_contacts) as contatos,
       (select count(*) from public.daily_goal_rounds) as rodadas,
       (select count(*) from public.daily_goal_attempts) as tentativas,
       (select count(*) from public.daily_goal_auto_queue where status = 'canceled') as fila_cancelada;

select 'ANTES' as momento, u.name as corretor, p.wallet_before as carteira_ativa,
       count(*) filter (where p.kind = 'zombie') as zumbis, count(*) filter (where p.kind = 'return') as voltam
from public.daily_goal_wallet_trim_plan() p join public.admin_users u on u.id = p.broker_id
group by u.name, p.wallet_before order by p.wallet_before desc;

-- APLICAR (le o teto do banco: 30). Guarda o run_id para a reversao e para as conferencias.
create temp table _carteira30_run on commit drop as
select public.daily_goal_wallet_trim() as resultado;
select resultado from _carteira30_run;

-- Conferencias DEPOIS: qualquer falha desfaz tudo (rollback automatico da transacao); se falhar por causa de
-- uma mudanca concorrente (sistema no ar), basta rodar o arquivo de novo.
do $$
declare
  a record;
  v_run uuid := (select (resultado->>'run_id')::uuid from _carteira30_run);
  v_restante integer;
  v_acima integer;
begin
  select * into a from _carteira30_antes;

  select count(*) into v_restante from public.daily_goal_wallet_trim_plan() where kind in ('zombie', 'return');
  if v_restante > 0 then raise exception 'CONFERENCIA: ainda sobram % rodadas a devolver/encerrar (rode de novo)', v_restante; end if;

  -- ninguem acima do teto, exceto por rodadas PROTEGIDAS (negocio em andamento)
  select count(*) into v_acima from (
    select p.broker_id from public.daily_goal_wallet_trim_plan() p
    group by p.broker_id having count(*) > greatest(max(p.limit_value), count(*) filter (where p.protected))
  ) x;
  if v_acima > 0 then raise exception 'CONFERENCIA: % corretor(es) ainda acima do teto', v_acima; end if;

  -- nada foi apagado
  if (select count(*) from public.simulation_registrations) < a.clientes then raise exception 'CONFERENCIA: clientes diminuiram'; end if;
  if (select count(*) from public.prospecting_contacts) < a.contatos then raise exception 'CONFERENCIA: contatos diminuiram'; end if;
  if (select count(*) from public.daily_goal_rounds) < a.rodadas then raise exception 'CONFERENCIA: rodadas diminuiram'; end if;
  if (select count(*) from public.daily_goal_attempts) < a.tentativas then raise exception 'CONFERENCIA: tentativas diminuiram'; end if;
  if (select count(*) from public.daily_goal_auto_queue where status = 'canceled') < a.fila_cancelada then raise exception 'CONFERENCIA: item cancelado da fila foi reaberto'; end if;

  -- esta execucao nao mudou etapa de cliente, nem attempt_count, nem last_attempt_at de contato
  if exists (select 1 from public.daily_goal_wallet_trim_backup b join public.simulation_registrations s on s.id = b.row_id
             where b.run_id = v_run and b.source_table = 'simulation_registrations' and s.status is distinct from b.original->>'status') then
    raise exception 'CONFERENCIA: etapa de cliente mudou';
  end if;
  if exists (select 1 from public.daily_goal_wallet_trim_backup b join public.daily_goal_rounds r on r.id = b.row_id
             where b.run_id = v_run and b.source_table = 'daily_goal_rounds' and r.attempt_count is distinct from (b.original->>'attempt_count')::integer) then
    raise exception 'CONFERENCIA: attempt_count mudou';
  end if;
  if exists (select 1 from public.daily_goal_wallet_trim_backup b join public.prospecting_contacts c on c.id = b.row_id
             where b.run_id = v_run and b.source_table = 'prospecting_contacts' and c.last_attempt_at is distinct from (b.original->>'last_attempt_at')::timestamptz) then
    raise exception 'CONFERENCIA: last_attempt_at de contato mudou';
  end if;
end $$;

select 'DEPOIS' as momento, u.name as corretor, count(*) as carteira_ativa
from public.daily_goal_rounds r join public.admin_users u on u.id = r.broker_id
where r.status = 'active' group by u.name order by 3 desc;

-- Auditoria desta execucao.
select u.name as corretor, l.limit_value, l.wallet_before, l.zombies_ended, l.kept, l.returned, l.returned_untouched,
       l.returned_with_attempts, l.clients_unassigned, l.queue_canceled, l.details, l.run_id
from public.daily_goal_wallet_trim_log l join public.admin_users u on u.id = l.broker_id
where l.run_id = (select (resultado->>'run_id')::uuid from _carteira30_run) order by l.wallet_before desc;

commit;
