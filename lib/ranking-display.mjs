export function canCompeteInRanking(profile) {
  return profile?.role !== "manager";
}

export function dailyRankingLeader(ranking) {
  return ranking?.[0]?.points > 0 ? ranking[0] : null;
}

export function weeklyChampionTitle(gender) {
  if (gender === "female") return "Campeã da Semana";
  if (gender === "male") return "Campeão da Semana";
  return "Campeão(ã) da Semana";
}

// Pontos e posição de cada corretor no Ranking oficial (lista já ordenada de getPerformanceOverview: `overview.ranking`).
// Só LÊ o resultado do Ranking — nenhuma fórmula de pontuação aqui (card da Meta Diária da equipe, 2026-10-22).
export function buildRankingPositionMap(ranking) {
  const list = Array.isArray(ranking) ? ranking : [];
  const total = list.length;
  return new Map(list.map((row, index) => [row.profile.id, { points: row.points, position: index + 1, total }]));
}

// Texto do selo "X pts · Nº lugar" do card da Meta Diária da equipe. `ranking` = item de buildRankingPositionMap (ou null).
export function formatRankingBadge(ranking, periodLabel = "") {
  if (!ranking || !Number.isFinite(ranking.points) || !Number.isFinite(ranking.position)) return null;
  const period = periodLabel ? ` (${String(periodLabel).toLowerCase()})` : "";
  return {
    text: `${ranking.points} pts · ${ranking.position}º lugar`,
    title: `Ranking oficial${period}: ${ranking.points} pontos, ${ranking.position}º entre ${ranking.total} no ranking. Mesmos números da tela Ranking.`,
    first: ranking.position === 1 && ranking.points > 0
  };
}
