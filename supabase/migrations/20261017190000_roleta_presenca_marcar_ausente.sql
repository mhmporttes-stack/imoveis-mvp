-- ROL-2f "Marcar ausente" (regra do dono, 2026-10-17): o inverso do "Liberar hoje". O dono (todos) ou a gestora (só a
-- própria equipe) marca uma pessoa como AUSENTE até o fim de um dia (hoje, até domingo ou data escolhida). Enquanto
-- vale, a pessoa NÃO conta como presente na imobiliária mesmo que o Wi-Fi detecte o aparelho dela (caso real: notebook
-- da corretora usado por outro corretor). Os check-ins NUNCA são apagados: só ignorados. Um check-in é ignorado quando
-- foi feito até o fim da ausência (first_seen_at <= absent_until) e ainda valia quando ela foi marcada
-- (valid_until > marked_at) — assim a chegada daquele dia deixa de valer e a de sábado não "volta" na segunda antes
-- das 9h. "Desfazer" grava cleared_at/cleared_by (a linha fica como histórico) e os check-ins voltam a valer.
-- Só tem efeito com a regra LIGADA (igual ao resto da ROL-2f).

create table if not exists public.office_presence_absences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.admin_users(id) on delete cascade,
  marked_at timestamptz not null default now(),
  absent_until timestamptz not null,
  marked_by uuid references public.admin_users(id) on delete set null,
  cleared_at timestamptz,
  cleared_by uuid references public.admin_users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (absent_until > marked_at)
);
create index if not exists office_presence_absences_user_idx on public.office_presence_absences (user_id, absent_until desc) where cleared_at is null;
alter table public.office_presence_absences enable row level security;
revoke all on public.office_presence_absences from anon, authenticated;
grant all on public.office_presence_absences to service_role;

-- Apto pela regra da imobiliária (sempre true com a regra desligada): precisa de uma chegada que ainda vale e que não
-- foi anulada por uma ausência marcada.
create or replace function public.office_presence_ok(p_user_id uuid)
returns boolean
language sql
stable
set search_path to 'public'
as $function$
  select not public.office_presence_rule_enabled()
      or exists (
        select 1
        from public.office_presence_checkins c
        where c.user_id = p_user_id
          and c.valid_until > now()
          and not exists (
            select 1
            from public.office_presence_absences a
            where a.user_id = c.user_id
              and a.cleared_at is null
              and c.first_seen_at <= a.absent_until
              and c.valid_until > a.marked_at
          )
      );
$function$;

revoke execute on function public.office_presence_ok(uuid) from public, anon, authenticated;
grant execute on function public.office_presence_ok(uuid) to service_role;
