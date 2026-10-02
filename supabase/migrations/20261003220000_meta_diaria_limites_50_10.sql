-- Pedido do dono (2026-10-02): reduzir pela metade o volume da Meta Diária.
-- (1) Carteira ativa: 100 -> 50.  (2) Novos contatos/dia exigidos: 20 -> 10.
-- Não remove ninguém da carteira: a RPC daily_goal_reserve_wallet_slots já devolve
-- greatest(limite - atual, 0), então acima de 50 nada é adicionado e nada é retirado.
-- Valores antigos: wallet_limit 100, quota 20 (daily_goals/rounds já gravados não mudam).
-- Idempotente: só mexe se o valor ainda for o antigo.

alter table public.daily_goal_wallet_config alter column wallet_limit set default 50;

update public.daily_goal_wallet_config
set wallet_limit = 50, updated_at = now()
where id = 'default' and wallet_limit = 100;

do $$
begin
  if exists (select 1 from public.daily_goal_quota_versions where effective_to is null and quota = 20) then
    update public.daily_goal_quota_versions set effective_to = now() where effective_to is null and quota = 20;
    insert into public.daily_goal_quota_versions (quota, effective_from, effective_to, changed_by)
    values (10, now(), null, null);
  end if;
end $$;
