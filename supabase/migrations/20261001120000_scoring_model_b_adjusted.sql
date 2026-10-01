-- Modelo B Ajustado (auditorias de ranking 2026-09-30/10-01, aprovado pelo
-- dono): novos pesos por atividade, aplicados RETROATIVAMENTE desde
-- 28/09/2026 00:00 (horário de Brasília = 2026-09-28T03:00:00Z). A vigência
-- existente (scoring_rule_versions / getRulePointsAt) garante que todo evento
-- ANTERIOR a esse instante continua pontuando com o peso antigo — nenhum
-- evento de client_status_history/simulation_registrations/daily_goal_*  é
-- alterado, duplicado ou tem a data mexida; só a REGRA aplicada a cada
-- instante passado a existir.
--
-- Regras cujo valor vigente já existia antes de 28/09 (new_client, service,
-- simulation, documentation, sent_for_approval, approval, sale): fecha a
-- versão antiga exatamente no corte e abre a nova a partir dele.
with cutover as (
  select '2026-09-28T03:00:00+00:00'::timestamptz as at
), targets(rule_key, new_points) as (
  values
    ('new_client', 2),
    ('service', 8),
    ('simulation', 15),
    ('documentation', 20),
    ('sent_for_approval', 25),
    ('approval', 50),
    ('sale', 150)
)
update scoring_rule_versions srv
set effective_to = cutover.at
from cutover, targets
where srv.rule_key = targets.rule_key
  and srv.effective_to is null;

with cutover as (
  select '2026-09-28T03:00:00+00:00'::timestamptz as at
), targets(rule_key, new_points) as (
  values
    ('new_client', 2),
    ('service', 8),
    ('simulation', 15),
    ('documentation', 20),
    ('sent_for_approval', 25),
    ('approval', 50),
    ('sale', 150)
)
insert into scoring_rule_versions (rule_key, points, active, effective_from, effective_to)
select targets.rule_key, targets.new_points, true, cutover.at, null
from cutover, targets;

-- Prospecção: valor por evento (+1) já é o correto desde 2026-09-12 — não
-- muda. O teto de 200% da Meta Diária é uma regra de AGREGAÇÃO por dia,
-- aplicada em código (lib/performance-overview.js), não em
-- scoring_rule_versions.

-- Presença: "Tempo online" e "Mais tempo online" só passaram a existir em
-- 28/09 (effective_from já é esse mesmo dia, 03:44:46Z) — não há versão
-- anterior para fechar; ajusta a própria versão vigente em vez de criar uma
-- divisão de duração zero.
update scoring_rule_versions set points = 1 where rule_key = 'presence_10min' and effective_to is null;
update scoring_rule_versions set active = false where rule_key = 'presence_top_bonus' and effective_to is null;

-- Meta Diária não concluída (-50) permanece inalterada (regra explícita do
-- dono) — já vigente desde 28/09, nenhuma ação necessária.
