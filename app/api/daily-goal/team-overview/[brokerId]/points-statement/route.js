import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { isAdminPermissionError } from "@/lib/admin-access";
import { formatPerformanceOverviewError } from "@/lib/performance-overview";
import { getBrokerPointsStatement } from "@/lib/points-statement";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Extrato dos pontos de um corretor (selo do card da Meta Diária da equipe). Dono = todos; gestora = só a equipe dela
// (checado em getBrokerPointsStatement, no backend). Somente leitura.
export async function GET(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { brokerId } = await params;
    const url = new URL(request.url);
    const statement = await getBrokerPointsStatement(brokerId, { period: url.searchParams.get("period") || "today" }, auth);
    return NextResponse.json({ statement });
  } catch (error) {
    console.error("Erro ao carregar extrato dos pontos:", error);
    return NextResponse.json({ error: formatPerformanceOverviewError(error) }, { status: isAdminPermissionError(error) ? 403 : 400 });
  }
}
