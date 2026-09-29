-- Mensagens de reconhecimento com animação (pedido do dono, 2026-09-29):
-- popup privado, só para o corretor que gerou o evento, nunca anunciado pro
-- time. Reaproveita o padrão já usado em daily_message_* (banco de
-- textos editável + log de "já visto" com constraint única contra
-- duplicidade) em vez de inventar mecanismo novo.

-- Liga/desliga cada gatilho + parâmetros configuráveis (minutos de
-- segurança do 1º lugar, resultado mínimo, horário de início, listas de
-- marcos). Não precisa de vigência histórica (não é pontuação retroativa):
-- é só o estado atual de configuração, uma linha por gatilho.
create table if not exists public.celebration_triggers (
  key text primary key,
  enabled boolean not null default true,
  config jsonb not null default '{}'::jsonb,
  updated_by uuid references public.admin_users(id) on delete set null,
  updated_at timestamptz not null default now()
);

-- Banco de textos por gatilho (várias variações, sorteadas sem repetir a
-- última usada). Editável pelo admin, nunca fixo no código.
create table if not exists public.celebration_message_templates (
  id uuid primary key default gen_random_uuid(),
  trigger_key text not null references public.celebration_triggers(key) on delete cascade,
  template text not null,
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists celebration_message_templates_trigger_idx
  on public.celebration_message_templates (trigger_key, active);

create unique index if not exists celebration_message_templates_unique_idx
  on public.celebration_message_templates (trigger_key, template);

-- Log de cada disparo — é a proteção contra duplicidade (mesmo marco não
-- repete no mesmo dia, mesmo com reload ou outro dispositivo) e o histórico
-- de qual texto/animação cada corretor recebeu. event_key identifica de
-- forma única a INSTÂNCIA do marco (ex.: 'daily_goal_150:2026-09-29',
-- 'mcmv_contract:<client_status_history.id>') — a constraint única
-- (broker_id, event_key) é quem garante "uma vez só".
create table if not exists public.broker_celebration_events (
  id uuid primary key default gen_random_uuid(),
  broker_id uuid not null references public.admin_users(id) on delete cascade,
  trigger_key text not null references public.celebration_triggers(key),
  event_key text not null,
  template_id uuid references public.celebration_message_templates(id) on delete set null,
  message text not null,
  animation text not null check (animation in ('confete', 'fogos', 'moedas', 'coroa', 'combo_200')),
  status text not null default 'pending' check (status in ('pending', 'shown')),
  shown_at timestamptz,
  created_at timestamptz not null default now(),
  unique (broker_id, event_key)
);

create index if not exists broker_celebration_events_pending_idx
  on public.broker_celebration_events (broker_id, status, created_at);

-- Estado do 1º lugar do ranking diário (linha única — só existe um líder por
-- vez). O cron de celebration-ranking atualiza a cada execução: se o líder
-- mudou, reinicia leading_since; se o líder já está há tempo suficiente
-- (config.holdMinutes) e ainda não foi notificado NESTE turno, dispara o
-- evento e grava em notified_broker_id/notified_turn_key.
create table if not exists public.celebration_ranking_lead_state (
  id integer primary key default 1 check (id = 1),
  leader_broker_id uuid references public.admin_users(id) on delete set null,
  leading_since timestamptz,
  notified_broker_id uuid references public.admin_users(id) on delete set null,
  notified_turn_key text,
  updated_at timestamptz not null default now()
);

insert into public.celebration_ranking_lead_state (id)
values (1)
on conflict (id) do nothing;

-- Data de nascimento e de admissão do corretor (pedido do dono: aniversário
-- e "tempo de casa"). Ficam vazias até o admin preencher em Corretores —
-- sem isso os dois gatilhos correspondentes nunca disparam.
alter table public.admin_users
  add column if not exists birth_date date,
  add column if not exists hired_at date;

-- "Chaves entregues" não existe como status do funil (é o fim da jornada,
-- não muda o pipeline comercial) — marcador simples e independente, no
-- mesmo espírito de client_cca_status_history: nunca escreve em
-- simulation_registrations.status.
alter table public.simulation_registrations
  add column if not exists keys_delivered_at timestamptz;

alter table public.celebration_triggers enable row level security;
alter table public.celebration_message_templates enable row level security;
alter table public.broker_celebration_events enable row level security;
alter table public.celebration_ranking_lead_state enable row level security;

revoke all on public.celebration_triggers from anon, authenticated;
revoke all on public.celebration_message_templates from anon, authenticated;
revoke all on public.broker_celebration_events from anon, authenticated;
revoke all on public.celebration_ranking_lead_state from anon, authenticated;

grant all on public.celebration_triggers to service_role;
grant all on public.celebration_message_templates to service_role;
grant all on public.broker_celebration_events to service_role;
grant all on public.celebration_ranking_lead_state to service_role;

-- Seed: os 16 gatilhos pedidos, todos ligados por padrão, com os textos-base
-- (3 a 4 variações cada, com [nome]) e os parâmetros configuráveis.
insert into public.celebration_triggers (key, enabled, config) values
  ('daily_goal_100', true, '{}'),
  ('daily_goal_150', true, '{}'),
  ('daily_goal_200', true, '{}'),
  ('ranking_no1', true, '{"holdMinutes": 10, "minResult": 1, "startHour": 12}'),
  ('goal_streak', true, '{"thresholds": [3, 5, 10]}'),
  ('personal_record', true, '{}'),
  ('first_of_day', true, '{}'),
  ('sales_month_milestone', true, '{"thresholds": [5, 10, 15, 20]}'),
  ('weekly_goal_met', true, '{}'),
  ('monthly_goal_met', true, '{}'),
  ('mcmv_approved', true, '{}'),
  ('mcmv_contract', true, '{}'),
  ('mcmv_keys', true, '{}'),
  ('rank_climb', true, '{"startHour": 12}'),
  ('birthday', true, '{}'),
  ('work_anniversary', true, '{}')
on conflict (key) do nothing;

insert into public.celebration_message_templates (trigger_key, template) values
  ('daily_goal_100', 'Meta batida, [nome]! Missão cumprida hoje. 🎯'),
  ('daily_goal_100', 'Meta 100% concluída, [nome]! Fechou com chave de ouro. 🔑'),
  ('daily_goal_100', 'Parabéns, [nome] — meta do dia batida! 🎯'),
  ('daily_goal_150', '150% da meta! Você está jogando em outro nível, [nome]. 🔥'),
  ('daily_goal_150', '[nome], 150%! Ninguém te segura hoje. 🔥'),
  ('daily_goal_150', 'Meta estourada em 150%, [nome]! Que ritmo. 🔥'),
  ('daily_goal_200', '200%! O dobro da meta. Hoje o dia é seu, [nome]. 🏆'),
  ('daily_goal_200', '[nome], 200% da meta! Um dia histórico. 🏆'),
  ('daily_goal_200', 'Dobrou a meta, [nome]! Simplesmente incrível. 🏆'),
  ('ranking_no1', 'Você acabou de assumir o 1º lugar, [nome]! 👑 Segure a liderança até o fim do dia.'),
  ('ranking_no1', '[nome] na liderança! 👑 Agora é manter o ritmo.'),
  ('ranking_no1', 'Liderança é sua, [nome]! 👑 Bora sustentar.'),
  ('goal_streak', '[N] dias seguidos batendo a meta, [nome]! Isso é consistência. 🔥'),
  ('goal_streak', '[nome], [N] dias seguidos na meta! Virou hábito. 🔥'),
  ('goal_streak', 'Sequência de [N] dias, [nome]! Consistência é o que separa os melhores. 🔥'),
  ('personal_record', 'Seu melhor dia até hoje, [nome]! Você se superou. 🚀'),
  ('personal_record', '[nome], novo recorde pessoal! Você se superou. 🚀'),
  ('personal_record', 'Recorde batido, [nome]! Nunca produziu tanto num dia só. 🚀'),
  ('first_of_day', 'Saiu na frente, [nome]! A primeira do dia é sua. ⚡'),
  ('first_of_day', '[nome] abriu o placar do dia! ⚡'),
  ('first_of_day', 'Primeira do dia, [nome]! Bora emplacar mais. ⚡'),
  ('sales_month_milestone', '[N] vendas no mês, [nome]! Você está construindo um mês forte. 💪'),
  ('sales_month_milestone', '[nome], [N] vendas neste mês! Ritmo de campeão. 💪'),
  ('sales_month_milestone', 'Marco de [N] vendas no mês, [nome]! 💪'),
  ('weekly_goal_met', 'Meta da semana batida, [nome]! Parabéns. 🏅'),
  ('weekly_goal_met', '[nome], semana fechada com a meta batida! 🏅'),
  ('monthly_goal_met', 'Meta do mês batida! Parabéns, [nome]! 🏅'),
  ('monthly_goal_met', '[nome], mês fechado com a meta batida! 🏅'),
  ('mcmv_approved', 'Crédito aprovado, [nome]! Mais um passo importante. 💰'),
  ('mcmv_approved', '[nome], aprovação sai! Excelente trabalho. 💰'),
  ('mcmv_contract', 'Contrato assinado, [nome]! Mais uma etapa vencida. 💰'),
  ('mcmv_contract', '[nome], contrato na mão! Parabéns pela conquista. 💰'),
  ('mcmv_keys', 'Mais uma família com a chave na mão graças a você, [nome]! 🏠'),
  ('mcmv_keys', '[nome], chaves entregues! Você mudou a vida de uma família. 🏠'),
  ('rank_climb', '[nome], você superou a média do time hoje! 📈'),
  ('rank_climb', 'Acima da média do time, [nome]! Ótimo ritmo hoje. 📈'),
  ('birthday', 'Feliz aniversário, [nome]! Que seu novo ciclo venha cheio de conquistas. 🎂'),
  ('birthday', 'Parabéns pelo seu dia, [nome]! 🎂'),
  ('work_anniversary', '[nome], mais um ano de casa! Obrigado por fazer parte disso. 🎉'),
  ('work_anniversary', 'Parabéns pelo seu tempo de casa, [nome]! 🎉')
on conflict (trigger_key, template) do nothing;

-- Acompanha quem está em 1º no ranking do dia e dispara o reconhecimento ao
-- completar o tempo mínimo de liderança (config.holdMinutes). De 2 em 2
-- minutos, mesmo padrão dos outros crons deste projeto (frequência reduzida
-- desde 2026-09-27 por custo/carga no banco).
select cron.unschedule('celebration-ranking-tick') where exists (
  select 1 from cron.job where jobname = 'celebration-ranking-tick'
);

select cron.schedule(
  'celebration-ranking-tick',
  '*/2 * * * *',
  $$
  select net.http_get(
    url := 'https://imoveis-mvp.vercel.app/api/cron/celebrations-ranking',
    headers := jsonb_build_object(
      'Authorization',
      'Bearer ' || (select decrypted_secret from vault.decrypted_secrets where name = 'crm_automation_cron_token')
    ),
    timeout_milliseconds := 20000
  );
  $$
);
