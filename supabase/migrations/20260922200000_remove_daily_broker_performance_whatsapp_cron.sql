-- Remove o resumo diário de desempenho por WhatsApp (pedido do dono,
-- 2026-09-22): desativa o cron agendado em
-- 20260915_daily_broker_performance_whatsapp_cron.sql. A rota
-- /api/cron/daily-broker-performance e lib/daily-goal-performance-whatsapp.js
-- foram removidas do código junto com esta migration.
select cron.unschedule('daily-broker-performance-whatsapp-once-a-day');

delete from public.crm_settings where id = 'daily_goal_performance_whatsapp_dispatch';
