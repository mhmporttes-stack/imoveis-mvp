import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatDailyReportError, getDailyReport } from "@/lib/daily-report";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  try {
    const url = new URL(request.url);
    const report = await getDailyReport({
      period: url.searchParams.get("period") || "today",
      startDate: url.searchParams.get("startDate") || "",
      endDate: url.searchParams.get("endDate") || ""
    }, auth);

    return NextResponse.json({ report });
  } catch (error) {
    console.error("Erro ao carregar relatorio diario:", error);
    return NextResponse.json({ error: formatDailyReportError(error) }, { status: 400 });
  }
}
