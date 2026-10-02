-- Meta Diária: dia "impactado por restrição validada do WhatsApp" (REGRA OFICIAL — dono, 2026-10-02).
-- Definido no FECHAMENTO do dia (closeDailyGoalDay) quando, mesmo com a janela compensada, era
-- matematicamente impossível concluir a meta com a cadência segura. Dia impactado NÃO recebe a
-- penalidade daily_goal_penalty (ver loadDailyGoalPenaltyScoring). Migration ADITIVA e idempotente:
-- só acrescenta colunas com padrão; nenhuma linha existente muda de significado (todas ficam false/0).
alter table public.daily_goals
  add column if not exists impacted_by_restriction boolean not null default false,
  add column if not exists impact_minutes integer not null default 0;

comment on column public.daily_goals.impacted_by_restriction is 'Dia fechado com a meta impactada por restrição VALIDADA do WhatsApp (sem penalidade).';
comment on column public.daily_goals.impact_minutes is 'Minutos de janela perdidos por restrição validada naquele dia (informativo).';
