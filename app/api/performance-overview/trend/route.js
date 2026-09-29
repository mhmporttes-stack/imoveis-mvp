import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { formatPerformanceOverviewError, getPerformanceTrend } from "@/lib/performance-overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(request.url);
    const params = {
      granularity: url.searchParams.get("granularity") || "month",
      brokerIds: url.searchParams.get("brokerIds") || ""
    };

    const trend = await getPerformanceTrend(params, auth);
    return NextResponse.json({ trend });
  } catch (error) {
    console.error("Erro ao carregar o histórico do painel de desempenho:", error);
    const status = error?.status === 403 ? 403 : 400;
    return NextResponse.json({ error: formatPerformanceOverviewError(error) }, { status });
  }
}
