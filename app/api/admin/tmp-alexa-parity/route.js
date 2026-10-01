import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { getOwnerTeamDailyOverview } from "@/lib/daily-goal";
import { getSimulationClientCounters } from "@/lib/simulation-list-query";
import { readCache } from "@/lib/crm-metrics/cache";
import { fetchStatusCounts } from "@/lib/crm-metrics/funnel-stock";
import { computePendencias, paramsForPeriod, readPendencias, readTeamGoal } from "@/lib/crm-metrics/team-goal";
import { deriveMeta, derivePendencias, deriveProspeccao, slimTeamGoal } from "@/lib/crm-metrics/team-goal-core.mjs";
import { getTodayInSaoPaulo } from "@/lib/daily-report";

// TEMPORÁRIA (Alexa V2, etapas 3-4): paridade entre o que a voz lê (cache) e a
// função da TELA chamada ao vivo com a sessão real do dono. Somente leitura.
export const dynamic = "force-dynamic";
export const runtime = "nodejs";
export const maxDuration = 60;

const META_TOPICS = ["meta_equipe", "meta_bateram", "meta_faltam", "meta_cada", "meta_lider"];
const PROS_TOPICS = ["prospeccao_equipe", "prospeccao_ranking", "prospeccao_vs_meta", "sem_prospeccao"];

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const which = new URL(request.url).searchParams.get("only") || "meta";
  const report = { at: new Date().toISOString() };

  if (which === "meta" || which === "all") {
    const periodId = new URL(request.url).searchParams.get("periodo") || "hoje";
    const live = slimTeamGoal(await getOwnerTeamDailyOverview(paramsForPeriod(periodId, getTodayInSaoPaulo()), auth));
    const cached = await readTeamGoal(periodId);
    report.meta = { periodId, cachedAt: cached?.payload?.capturedAt || null, staleMinutes: cached?.staleMinutes ?? null, topics: {} };
    for (const topic of META_TOPICS) {
      const a = JSON.stringify(deriveMeta(live, topic));
      const b = cached ? JSON.stringify(deriveMeta(cached.payload, topic)) : null;
      report.meta.topics[topic] = { equal: a === b, live: JSON.parse(a), cache: b ? JSON.parse(b) : null };
    }
    for (const topic of PROS_TOPICS) {
      const a = JSON.stringify(deriveProspeccao(live, topic));
      const b = cached ? JSON.stringify(deriveProspeccao(cached.payload, topic)) : null;
      report.meta.topics[topic] = { equal: a === b, live: JSON.parse(a), cache: b ? JSON.parse(b) : null };
    }
  }

  if (which === "pendencias" || which === "all") {
    const live = await computePendencias();
    const cached = await readPendencias();
    report.pendencias = { cachedAt: cached?.payload?.capturedAt || null, topics: {} };
    for (const topic of ["pendencias", "pendencias_ranking", "sem_contato"]) {
      const a = JSON.stringify(derivePendencias(live, topic));
      const b = cached ? JSON.stringify(derivePendencias(cached.payload, topic)) : null;
      report.pendencias.topics[topic] = { equal: a === b, live: JSON.parse(a), cache: b ? JSON.parse(b) : null };
    }
  }

  if (which === "funil" || which === "all") {
    const screen = await getSimulationClientCounters({ auth });
    const mine = await fetchStatusCounts();
    const cache = await readCache("funil:estoque", 10);
    report.funil = {
      byStatusEqual: JSON.stringify(Object.fromEntries(Object.entries(screen.byStatus).sort())) === JSON.stringify(Object.fromEntries(Object.entries(mine.byStatus).sort())),
      byGroupEqual: JSON.stringify(Object.fromEntries(Object.entries(screen.byGroup).sort())) === JSON.stringify(Object.fromEntries(Object.entries(mine.byGroup).sort())),
      screen: { all: screen.all, byGroup: screen.byGroup },
      mine: { total: mine.total, byGroup: mine.byGroup },
      cacheAgeMinutes: cache?.ageMinutes ?? null
    };
  }

  return NextResponse.json(report);
}
