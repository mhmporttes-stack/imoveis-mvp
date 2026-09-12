import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { formatPerformanceOverviewError, getBrokerPerformanceOverview, getPerformanceOverview } from "@/lib/performance-overview";

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
      period: url.searchParams.get("period") || "today",
      startDate: url.searchParams.get("startDate") || "",
      endDate: url.searchParams.get("endDate") || "",
      brokerIds: url.searchParams.get("brokerIds") || ""
    };
    const brokerId = url.searchParams.get("brokerId") || "";

    const overview = brokerId
      ? await getBrokerPerformanceOverview(brokerId, params, auth)
      : await getPerformanceOverview(params, auth);

    return NextResponse.json({ overview });
  } catch (error) {
    console.error("Erro ao carregar painel de desempenho:", error);
    const status = error?.status === 403 ? 403 : 400;
    return NextResponse.json({ error: formatPerformanceOverviewError(error) }, { status });
  }
}
