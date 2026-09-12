-- Fecha a versão vigente e abre a nova em uma única transação (a função inteira
-- é atômica): evita que uma falha de rede entre os dois passos deixe a regra
-- sem nenhuma versão vigente (o que faria o evento pontuar 0 até alguém notar).
create or replace function public.set_scoring_rule_version(
  p_rule_key text,
  p_points integer,
  p_active boolean,
  p_changed_by uuid
) returns public.scoring_rule_versions
language plpgsql
security invoker
set search_path = public
as $$
declare
  result public.scoring_rule_versions;
begin
  update public.scoring_rule_versions
    set effective_to = now()
    where rule_key = p_rule_key
      and effective_to is null;

  insert into public.scoring_rule_versions (rule_key, points, active, effective_from, effective_to, changed_by)
  values (p_rule_key, p_points, p_active, now(), null, p_changed_by)
  returning * into result;

  return result;
end;
$$;

revoke all on function public.set_scoring_rule_version(text, integer, boolean, uuid) from public, anon, authenticated;
grant execute on function public.set_scoring_rule_version(text, integer, boolean, uuid) to service_role;
