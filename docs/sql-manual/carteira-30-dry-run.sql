-- ============================================================================================
-- CARTEIRA DE NO MAXIMO 30 — SIMULACAO (DRY-RUN). SOMENTE LEITURA: nao grava nada.
-- Pre-requisito: migration 20261004200000_meta_diaria_carteira_30.sql ja aplicada (cria o plano).
-- Mostra, por corretor: carteira hoje, quantos ficam, quantos voltam a Prospecção e de que tipo.
-- Regra e prioridade: docs/BUSINESS_RULES.md MD-14.
-- ============================================================================================

-- 1) Resumo por corretor (limite 30; troque o 30 para simular outro teto)
select u.name as corretor, u.status as situacao,
       p.wallet_before as carteira_hoje,
       count(*) filter (where p.kind = 'zombie') as rodadas_zumbi_a_encerrar,   -- contato ja voltou para a fila; so a rodada sai da conta
       count(*) filter (where p.kind = 'keep') as ficam,
       count(*) filter (where p.kind = 'return') as voltam,
       count(*) filter (where p.kind = 'return' and p.attempt_count = 0) as voltam_sem_tentativa,
       count(*) filter (where p.kind = 'return' and p.attempt_count = 1) as voltam_com_1_tentativa,
       count(*) filter (where p.kind = 'return' and p.attempt_count = 2) as voltam_com_2_tentativas,
       count(*) filter (where p.protected) as protegidos,
       count(*) filter (where p.kind = 'return' and p.client_status is not null and p.client_status <> 'awaiting_return') as voltam_em_etapa_avancada
from public.daily_goal_wallet_trim_plan(30) p
join public.admin_users u on u.id = p.broker_id
group by u.name, u.status, p.wallet_before
order by p.wallet_before desc;

-- 2) Totais
select kind, count(*) as rodadas, count(distinct broker_id) as corretores
from public.daily_goal_wallet_trim_plan(30)
group by kind order by kind;

-- 3) Quem fica, por etapa da cadência (para conferir a prioridade)
select u.name as corretor, p.attempt_count as tentativas_feitas, count(*) filter (where p.kind = 'keep') as ficam, count(*) filter (where p.kind = 'return') as voltam
from public.daily_goal_wallet_trim_plan(30) p join public.admin_users u on u.id = p.broker_id
where p.kind in ('keep', 'return')
group by u.name, p.attempt_count order by u.name, p.attempt_count desc;
