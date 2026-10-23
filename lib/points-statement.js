import "server-only";
import { AdminPermissionError, isManagerProfile, isOwnerAdminEmail } from "./admin-profiles";
import { getPointsLedger } from "./performance-overview";
import { getTodayInSaoPaulo } from "./daily-report";
import { buildPointsStatement, normalizeStatementPeriod } from "./points-statement-core.mjs";
import { isBrokerInScope, resolveTeamMetaScope } from "./team-meta-scope-core.mjs";

// Extrato dos pontos de UM corretor (clique no selo "X pts · Nº lugar" do card da Meta Diária da equipe).
// Mesmo escopo da tela: dono = todos; gestora = só a equipe dela (managedUserIds); demais perfis = 403.
// A decisão é do backend (mesma resolução de resolveTeamScopeOrThrow em lib/daily-goal.js), nunca só da tela.
//
// Fonte dos pontos: getPointsLedger SEM brokerId — o Ranking (selo) calcula com os eventos de TODOS os
// corretores (histórico de status global); pedir o extrato "só deste corretor" carregaria só os clientes
// atuais dele e poderia somar diferente do selo. Por isso carrega o conjunto completo e filtra aqui.
export async function getBrokerPointsStatement(brokerId, params = {}, auth = null) {
  const scope = resolveTeamMetaScope({
    isManager: isManagerProfile(auth?.profile),
    isOwner: isOwnerAdminEmail(auth?.user?.email),
    profileId: auth?.profile?.id,
    managedUserIds: auth?.profile?.managedUserIds
  });
  const id = String(brokerId || "").trim();
  if (scope.mode === "denied") throw new AdminPermissionError("Apenas o administrador principal ou a gestora da equipe pode acessar esta área.");
  if (!isBrokerInScope(scope, id)) throw new AdminPermissionError("Este corretor não faz parte da sua equipe.");

  const period = normalizeStatementPeriod(params.period);
  const ledger = await getPointsLedger({ period }, auth);
  const own = ledger.rows.filter((row) => row.brokerId === id);
  const statement = buildPointsStatement(own, { brokerId: id, todayYmd: getTodayInSaoPaulo() });
  return {
    brokerId: id,
    range: { period, startDate: ledger.range.startDate, endDate: ledger.range.endDate, label: ledger.range.label },
    ...statement
  };
}
