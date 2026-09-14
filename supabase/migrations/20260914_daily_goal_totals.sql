-- Total de atividades previstas no dia (novos + 2º contato + 3ª tentativa),
-- congelado quando a Meta Diária daquele dia é montada/revisitada — permite
-- reportar "previstas x realizadas" num período sem recalcular o histórico.
alter table public.daily_goals add column if not exists total_due integer not null default 0;
