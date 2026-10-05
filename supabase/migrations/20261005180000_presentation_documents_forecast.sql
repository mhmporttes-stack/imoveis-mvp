-- Apresentação interativa, round 4: "previsão de envio dos documentos" (data + período escolhidos pelo cliente).
-- ADITIVA e idempotente: só acrescenta colunas em simulation_presentations (não altera nem remove nada existente) e um índice
-- único parcial em calendar_activities. Pode ser reaplicada sem erro. Nenhum dado existente é lido, movido ou apagado.
-- Documentação: docs/DATABASE.md (simulation_presentations, calendar_activities) e docs/BUSINESS_RULES.md (PRES-17).

-- 1) Compromisso do cliente, gravado na linha da apresentação (a data NÃO é mostrada ao cliente depois da confirmação).
alter table public.simulation_presentations
  add column if not exists docs_forecast_date date,
  add column if not exists docs_forecast_period text,
  add column if not exists docs_forecast_at timestamptz,
  add column if not exists docs_forecast_count smallint not null default 0;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'simulation_presentations_docs_forecast_period_check'
       and conrelid = 'public.simulation_presentations'::regclass
  ) then
    alter table public.simulation_presentations
      add constraint simulation_presentations_docs_forecast_period_check
      check (docs_forecast_period is null or docs_forecast_period in ('manha', 'tarde', 'noite'));
  end if;
end $$;

-- 2) No máximo UMA atividade pendente "documentos" criada pelo sistema (created_by nulo) por cliente: fecha a corrida de duas
-- confirmações quase simultâneas. NÃO atinge o reagendamento do corretor (a atividade nova dele tem created_by preenchido) nem
-- as atividades manuais ou de automação de outros tipos. Se já existir duplicidade (não deveria: o tipo é novo), o índice é
-- pulado com aviso em vez de falhar; o código continua sem duplicar (procura antes de inserir).
do $$
begin
  if exists (
    select 1
      from public.calendar_activities
     where activity_type = 'documentos' and status = 'pending' and created_by is null and client_id is not null
     group by client_id
    having count(*) > 1
  ) then
    raise notice 'calendar_activities_documents_forecast_one_pending_idx NAO criado: ha atividades duplicadas do tipo documentos.';
  else
    create unique index if not exists calendar_activities_documents_forecast_one_pending_idx
      on public.calendar_activities (client_id)
      where activity_type = 'documentos' and status = 'pending' and created_by is null;
  end if;
end $$;
