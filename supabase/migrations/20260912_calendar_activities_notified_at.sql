-- Lembrete próprio por atividade (independente do mecanismo legado em
-- simulation_registrations.scheduled_activity_notified_at) — necessário para
-- que um cliente com várias atividades futuras simultâneas receba um lembrete
-- por atividade, sem que uma "tampe" o lembrete da outra.
alter table public.calendar_activities
  add column if not exists notified_at timestamptz;

create index if not exists calendar_activities_due_notification_idx
  on public.calendar_activities (scheduled_at)
  where status = 'pending' and notified_at is null;
