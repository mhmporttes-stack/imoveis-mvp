-- Protege o Supabase: a atualização do cache da voz em horário comercial passa
-- de 5 em 5 para 10 em 10 minutos (validade do cache de "hoje": 15 min).
select cron.alter_job(
  job_id := (select jobid from cron.job where jobname = 'crm-cache-refresh-business'),
  schedule := '*/10 10-23 * * 1-6'
);
