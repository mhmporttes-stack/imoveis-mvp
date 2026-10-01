import "server-only";
import { getPerformanceOverview } from "../performance-overview";
import { getTodayInSaoPaulo } from "../daily-report";
import { getOwnerAuth } from "./owner-auth";
import { readCache } from "./cache";
import { paramsForPeriod, rangeKeyFor } from "./team-goal";
import { OVERVIEW_CACHE_KEYS, OVERVIEW_VALID_MINUTES, slimOverview } from "./overview-core.mjs";

// Desempenho/Ranking pré-calculados para a voz. A conta é SEMPRE a da tela
// (getPerformanceOverview, a mesma do Desempenho e do Ranking), com a
// visão do dono; aqui só se agenda, se reduz e se guarda no cache.
export async function computeOverview(periodId) {
  const today = getTodayInSaoPaulo();
  const auth = await getOwnerAuth();
  const overview = await getPerformanceOverview(paramsForPeriod(periodId, today), auth);
  return { ...slimOverview(overview), periodId, rangeKey: rangeKeyFor(periodId, today) };
}

export async function readOverview(periodId) {
  const key = OVERVIEW_CACHE_KEYS[periodId];
  if (!key) return null;
  const entry = await readCache(key, OVERVIEW_VALID_MINUTES[periodId]);
  if (!entry?.payload?.metrics) return null;
  if (periodId === "hoje" && entry.payload.range?.startDate !== getTodayInSaoPaulo()) return null;
  return { payload: entry.payload, staleMinutes: entry.fresh ? 0 : entry.ageMinutes || 0 };
}
