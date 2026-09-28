import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatPerformanceOverviewError, getDailyTeamRankingSnapshot } from "@/lib/performance-overview";
import { getWeeklyRankingWinner } from "@/lib/weekly-ranking";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Sem restrição de admin/gestor de propósito: o widget "Top 1 do dia" é
// global e precisa aparecer para qualquer corretor autenticado. Fonte única:
// getDailyTeamRankingSnapshot reaproveita getPerformanceOverview (a mesma
// função de "Ranking da Equipe"), nunca um cálculo próprio.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const [daily, weekly] = await Promise.allSettled([getDailyTeamRankingSnapshot(auth), getWeeklyRankingWinner()]);
    if (daily.status === "rejected") throw daily.reason;
    if (weekly.status === "rejected") console.error("Falha ao carregar Melhor da Semana.", weekly.reason);
    return NextResponse.json({ ...daily.value, weeklyTop1: weekly.status === "fulfilled" ? weekly.value : null });
  } catch (error) {
    return NextResponse.json({ error: formatPerformanceOverviewError(error) }, { status: error?.status || 400 });
  }
}
