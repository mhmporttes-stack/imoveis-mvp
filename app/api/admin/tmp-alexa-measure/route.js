import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getPerformanceOverview, getCachedTodayOverviewForRanking } from "@/lib/performance-overview";
import { getOwnerTeamDailyOverview, getDailyGoalPerformance } from "@/lib/daily-goal";
import { getTeamPresence } from "@/lib/admin-presence";
import { getSimulationClientCounters, getPendingClientsCount, getUnattendedClientIds } from "@/lib/simulation-list-query";
import { getDailyReport } from "@/lib/daily-report";

// TEMPORÁRIA (Alexa V2, etapa 0): cronometra funções candidatas e conta as
// requisições ao Supabase de cada uma. Somente leitura. Será removida.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

async function measure(label, fn) {
  const original = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = (...args) => {
    const url = String(args[0]?.url || args[0] || "");
    if (url.includes("supabase")) calls += 1;
    return original(...args);
  };
  const started = Date.now();
  let ok = true;
  let error = "";
  let bytes = 0;
  try {
    const result = await fn();
    bytes = JSON.stringify(result ?? null).length;
  } catch (caught) {
    ok = false;
    error = String(caught?.message || caught).slice(0, 120);
  }
  globalThis.fetch = original;
  return { label, ms: Date.now() - started, supabaseCalls: calls, ok, error, bytes };
}

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const results = [];
  results.push(await measure("funil: getSimulationClientCounters", () => getSimulationClientCounters({ auth })));
  results.push(await measure("pendentes: getPendingClientsCount", () => getPendingClientsCount({ auth })));
  results.push(await measure("sem atendimento: getUnattendedClientIds", () => getUnattendedClientIds(auth)));
  results.push(await measure("presenca: getTeamPresence", () => getTeamPresence(auth)));
  results.push(await measure("meta: getDailyGoalPerformance(today)", () => getDailyGoalPerformance({ period: "today" }, auth)));
  results.push(await measure("overview(today) frio", () => getPerformanceOverview({ period: "today" }, auth)));
  results.push(await measure("overview(today) cache 90s", () => getCachedTodayOverviewForRanking()));
  results.push(await measure("meta equipe: getOwnerTeamDailyOverview(today)", () => getOwnerTeamDailyOverview({ period: "today" }, auth)));
  results.push(await measure("overview(yesterday)", () => getPerformanceOverview({ period: "yesterday" }, auth)));
  results.push(await measure("overview(last7)", () => getPerformanceOverview({ period: "last7" }, auth)));
  results.push(await measure("overview(month)", () => getPerformanceOverview({ period: "month" }, auth)));
  results.push(await measure("relatorio do dia: getDailyReport(today)", () => getDailyReport({ period: "today" }, auth)));

  return NextResponse.json({ at: new Date().toISOString(), note: "chamadas ao Supabase contadas por fetch global; trafego paralelo de outros usuarios pode somar", results });
}
