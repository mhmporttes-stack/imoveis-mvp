-- Código curto do link de cada usuário (2026-10-05): /s/{short_ref} e /v/{short_ref}. O simulation_ref/captacao_ref
-- longos continuam sendo o identificador de atribuição (e os links antigos ?ref=<longo> seguem valendo); o código curto
-- só resolve para eles. Matheus = 'mhm'; os demais recebem um número (1, 2, 3…) por ordem de cadastro; novos usuários
-- pegam o próximo número da sequência (DEFAULT).
alter table public.admin_users add column if not exists short_ref text;

update public.admin_users set short_ref = 'mhm' where lower(email) = 'mhmporttes@gmail.com' and short_ref is null;

with numbered as (
  select id, row_number() over (order by created_at, id) as n
    from public.admin_users
   where short_ref is null
)
update public.admin_users u set short_ref = numbered.n::text from numbered where u.id = numbered.id;

create sequence if not exists public.admin_users_short_ref_seq;
select setval('public.admin_users_short_ref_seq', greatest(coalesce((select max(short_ref::int) from public.admin_users where short_ref ~ '^[0-9]+$'), 0), 1));
alter table public.admin_users alter column short_ref set default nextval('public.admin_users_short_ref_seq')::text;

create unique index if not exists admin_users_short_ref_key on public.admin_users (short_ref);
