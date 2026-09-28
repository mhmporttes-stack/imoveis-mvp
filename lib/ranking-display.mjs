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
