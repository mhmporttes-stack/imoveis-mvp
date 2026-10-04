-- ============================================================================================
-- CARTEIRA DE NO MAXIMO 30 — REVERTER UMA EXECUCAO DO REBALANCEAMENTO.
-- Use o run_id devolvido por carteira-30-aplicar-rebalanceamento.sql (ou consulte a lista abaixo).
-- Devolve rodadas, contatos, clientes e itens da fila ao estado do backup (daily_goal_wallet_trim_backup), mas SO
-- o que ainda esta como o rebalanceamento deixou: contato que outra pessoa ja assumiu depois nao e desfeito
-- (aparece em "rounds_skipped"). Nao apaga a auditoria nem o historico. Rodar duas vezes nao faz nada na segunda.
-- ATENCAO: reverter faz o corretor voltar a ter mais de 30 (e o card volta a mostrar o numero antigo).
-- ============================================================================================

-- 1) Execucoes disponiveis (somente leitura)
select l.run_id, min(l.created_at) as executada_em, sum(l.returned) as devolvidos, sum(l.zombies_ended) as zumbis, max(l.reverted_at) as revertida_em
from public.daily_goal_wallet_trim_log l group by l.run_id order by executada_em desc;

-- 2) Reverter (troque o valor)
begin;
select public.daily_goal_wallet_trim_revert('00000000-0000-0000-0000-000000000000'::uuid) as resultado;
commit;
