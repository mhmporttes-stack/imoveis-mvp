import "server-only";
import { getWeeklyRankingWinner } from "../../weekly-ranking";
import { readOverview } from "../../crm-metrics/overview";
import { readTeamGoal } from "../../crm-metrics/team-goal";
import { deriveConversao, deriveRanking, deriveResultados } from "../../crm-metrics/overview-core.mjs";
import { firstNameOf } from "../text.mjs";

// Resultados (vendas, aprovações, desempenho, conversão) e Ranking: leem o
// cache da MESMA função das telas (getPerformanceOverview) — a voz nunca a
// chama. Venda = os 8 status de venda (Desempenho/Celebrações).
function withStale(view, staleMinutes) {
  if (!view) return null;
  return staleMinutes ? { ...view, staleMinutes } : view;
}

export async function resultadosProvider(q) {
  if (q.topic === "conversao") {
    const meta = await readTeamGoal(q.periodo);
    return meta ? withStale(deriveConversao(meta.payload), meta.staleMinutes) : null;
  }
  const entry = await readOverview(q.periodo);
  if (!entry) return null;
  return withStale(deriveResultados(entry.payload, q.topic), entry.staleMinutes);
}

export async function rankingProvider(q) {
  if (q.topic === "campeao_semana") {
    const winner = await getWeeklyRankingWinner();
    return winner ? { name: firstNameOf(winner.name), gender: winner.gender || "", points: winner.points || 0 } : { name: "", points: 0 };
  }
  const entry = await readOverview(q.periodo);
  if (!entry) return null;
  return withStale(deriveRanking(entry.payload, q.topic, q.corretor), entry.staleMinutes);
}
