-- Excluir usuário (corretor) falhava quando havia registros de auditoria/autoria apontando para ele (caso real
-- 2026-10-07: Luana Souza — 26 em daily_goal_do_not_contact_log e 6 em daily_goal_abuse_flags). Essas FKs não tinham
-- "on delete", então o DELETE em admin_users era recusado. Passam a "on delete set null": o registro histórico
-- continua existindo, só perde o vínculo com o usuário removido (mesmo padrão das demais FKs de autoria).
-- Só colunas anuláveis. Não mexe nas FKs NOT NULL (Neural, do dono) nem nas da Academia (restrict, intencional).
do $$
declare r record;
begin
  for r in
    select c.conname, c.conrelid::regclass::text as tbl, a.attname as col
    from pg_constraint c
    join pg_attribute a on a.attrelid = c.conrelid and a.attnum = c.conkey[1]
    where c.confrelid = 'public.admin_users'::regclass and c.contype = 'f' and c.confdeltype = 'a'
      and array_length(c.conkey, 1) = 1 and not a.attnotnull
  loop
    execute format('alter table %s drop constraint %I', r.tbl, r.conname);
    execute format('alter table %s add constraint %I foreign key (%I) references public.admin_users(id) on delete set null', r.tbl, r.conname, r.col);
  end loop;
end $$;
