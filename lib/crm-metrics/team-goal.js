import "server-only";
import { getOwnerTeamDailyOverview } from "../daily-goal";
import { getDailyGoalPendingProgress } from "../daily-goal-pending";
import { getTodayInSaoPaulo } from "../daily-report";
import { resolvePeriod } from "../alexa-v2/periods.mjs";
import { firstNameOf } from "../alexa-v2/text.mjs";
import { getOwnerAuth } from "./owner-auth";
import { readCache } from "./cache";
import { slimTeamGoal, TEAM_GOAL_CACHE_KEYS, TEAM_GOAL_VALID_MINUTES } from "./team-goal-core.mjs";

// Meta da Equipe e Pendências pré-calculadas para a voz. A conta é SEMPRE a
// da tela (getOwnerTeamDailyOverview / getDailyGoalPendingProgress): aqui só
// se agenda, se reduz e se guarda no cache.

export function paramsForPeriod(periodId, today) {
  if (periodId === "hoje") return { period: "today" };
  if (periodId === "ontem") return { period: "yesterday" };
  const range = resolvePeriod(periodId, today);
  return { period: "custom", startDate: range.startDate, endDate: range.endDate };
}

export function rangeKeyFor(periodId, today = getTodayInSaoPaulo()) {
  const range = resolvePeriod(periodId, today);
  return `${range.startDate}_${range.endDate}`;
}

export async function computeTeamGoal(periodId) {
  const today = getTodayInSaoPaulo();
  const auth = await getOwnerAuth();
  const overview = await getOwnerTeamDailyOverview(paramsForPeriod(periodId, today), auth);
  return { ...slimTeamGoal(overview), periodId, rangeKey: rangeKeyFor(periodId, today) };
}

// Pendências de hoje por corretor (regra da Meta Diária), a partir dos
// corretores que a Meta da Equipe já listou.
export async function computePendencias() {
  const today = getTodayInSaoPaulo();
  const meta = await readCache(TEAM_GOAL_CACHE_KEYS.hoje, TEAM_GOAL_VALID_MINUTES.hoje);
  const brokers = (meta?.payload?.brokers || []).filter((broker) => broker.pending);
  const result = [];
  for (const broker of brokers) {
    const progress = await getDailyGoalPendingProgress(broker.id, today, { createIfMissing: false, withClients: true });
    if (!progress) continue;
    result.push({
      id: broker.id,
      name: broker.name,
      remaining: progress.remaining || 0,
      moreClients: progress.moreClients || 0,
      clients: (progress.clients || []).map((client) => ({ name: firstNameOf(client.fullName) || "Cliente", days: client.daysWithoutContact || 0 }))
    });
  }
  return { brokers: result, date: today, capturedAt: new Date().toISOString() };
}

// Leitura para a voz. Devolve null se não houver valor (cache ainda vazio) ou
// se o dado "de hoje" for de outro dia (virada da meia-noite antes da
// próxima atualização).
export async function readTeamGoal(periodId) {
  const key = TEAM_GOAL_CACHE_KEYS[periodId];
  if (!key) return null;
  const entry = await readCache(key, TEAM_GOAL_VALID_MINUTES[periodId]);
  if (!entry?.payload?.brokers) return null;
  if (periodId === "hoje" && entry.payload.range?.startDate !== getTodayInSaoPaulo()) return null;
  return { payload: entry.payload, staleMinutes: entry.fresh ? 0 : entry.ageMinutes || 0 };
}

export async function readPendencias() {
  const entry = await readCache("pendencias:hoje", 10);
  if (!entry?.payload?.brokers) return null;
  if (entry.payload.date !== getTodayInSaoPaulo()) return null;
  return { payload: entry.payload, staleMinutes: entry.fresh ? 0 : entry.ageMinutes || 0 };
}

// Corretores conhecidos (para reconhecer "Izabela", "Izabela Silvério", "e o Eduardo?"):
// vêm do último cache do Desempenho (nome completo, gênero e papel do cadastro);
// se ele ainda não existir, da Meta Diária. Apelidos ficam em broker-aliases.mjs.
export async function loadBrokerList() {
  const overview = await readCache("overview:hoje", 100000);
  const team = (overview?.payload?.team || []).filter((row) => row.id && row.role !== "admin");
  if (team.length) return team.map((row) => ({ id: row.id, name: row.name, fullName: row.fullName || row.name, gender: row.gender || "" }));
  const entry = await readCache(TEAM_GOAL_CACHE_KEYS.hoje, 100000);
  return (entry?.payload?.brokers || []).map((broker) => ({ id: broker.id, name: broker.name, fullName: broker.name }));
}
