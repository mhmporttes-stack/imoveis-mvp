export function canCompeteInRanking(profile) {
  return profile?.role !== "manager";
}

export function weeklyChampionTitle(gender) {
  if (gender === "female") return "Campeã da Semana";
  if (gender === "male") return "Campeão da Semana";
  return "Campeão(ã) da Semana";
}
