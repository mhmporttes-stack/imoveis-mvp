-- Achado real, pente-fino 2026-09-30: as versões antigas (2 argumentos, sem
-- p_today) de claim_daily_goal_contacts e claim_single_prospecting_contact
-- nunca foram removidas quando as versões novas (3 argumentos) passaram a
-- existir, em 20260919143000_daily_goal_wallet_atomic_reserve_fix.sql e
-- 20260928200000_daily_goal_claim_guards.sql respectivamente. Como Postgres
-- permite sobrecarga por número de argumentos, "create or replace function"
-- com uma assinatura diferente NUNCA substitui a antiga — cria uma segunda
-- função separada. As duas ficaram coexistindo: a nova (3 args, chamada por
-- todo o código atual) tem a trava de "não contactar"/"venda concluída" e
-- cria a rodada atomicamente; a antiga (2 args) não tem nenhuma das duas
-- proteções. Nenhum código hoje chama a versão de 2 args — mas é uma
-- armadilha real para qualquer chamada futura (ou copiada de uma versão
-- antiga) que passe só 2 argumentos: ela silenciosamente usaria a função
-- insegura sem nenhum aviso.
drop function if exists public.claim_daily_goal_contacts(p_broker_id uuid, p_quota integer);
drop function if exists public.claim_single_prospecting_contact(p_contact_id uuid, p_broker_id uuid);
