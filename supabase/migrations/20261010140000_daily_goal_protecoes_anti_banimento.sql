-- Proteções anti-banimento da automação da Meta Diária (REGRA OFICIAL — dono, 2026-10-10). SÓ ACRESCENTA e é
-- idempotente (add column if not exists + insert ... on conflict do nothing). Não altera linha existente de
-- clientes, funil, fila, tentativas, sessões nem pontuação. NÃO envia nada.
--
-- 1) daily_goal_auto_settings.slot_controls (jsonb): estado POR NÚMERO (chave "1" | "2") — pausa automática por
--    403/logout (retomada manual) e início do aquecimento (warm-up) de número novo/reconectado após bloqueio:
--      { "1": { "phone", "dispatch", "warmupStart": "AAAA-MM-DD"|null, "paused", "pausedAt", "pausedKind",
--               "pausedCode", "pausedReason", "episodeAt", "alertedAt" } }
--    Linha sem entrada para um número = número já estabelecido (sem aquecimento). O código funciona SEM esta coluna
--    (ele a detecta): sem ela, 403/logout pausa o corretor inteiro (paused/paused_reason) e não há aquecimento.
-- 2) Duas definições na Central de Alertas (crm_alert_definitions): "número pausado" (importante, vai ao corretor e à
--    gestora responsável) e "problema na fila de disparos" (informativo: item parado ou erros seguidos do mesmo tipo).
--    Os destinatários são escolhidos pelo detector (lib/daily-goal-auto-alerts.js), não pela audiência. Sem estas
--    linhas o código não entrega o aviso (registra no log), mas a pausa continua funcionando.

alter table public.daily_goal_auto_settings
  add column if not exists slot_controls jsonb not null default '{}'::jsonb;

insert into public.crm_alert_definitions (key, title, body_template, kind, audience, trigger, enabled)
values (
  'daily_goal_number_paused',
  'Disparos pausados por segurança',
  '{corretor}: {motivo} A fila foi guardada e nada será enviado por este número até alguém retomar manualmente em Gestão > Meta Diária > Automação.',
  'important',
  '{"type":"system"}'::jsonb,
  '{"type":"system","source":"daily_goal_number_paused"}'::jsonb,
  true
)
on conflict (key) do nothing;

insert into public.crm_alert_definitions (key, title, body_template, kind, audience, trigger, enabled)
values (
  'daily_goal_queue_problem',
  'Disparos automáticos com problema',
  '{corretor}: {motivo}',
  'informative',
  '{"type":"system"}'::jsonb,
  '{"type":"system","source":"daily_goal_queue_problem"}'::jsonb,
  true
)
on conflict (key) do nothing;
