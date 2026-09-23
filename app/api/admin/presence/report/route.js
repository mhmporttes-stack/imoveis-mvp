import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { formatAdminPresenceError, getPresenceReport } from "@/lib/admin-presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Relatório de horas no CRM (online/ausente por dia) — mesmo gate da aba
// Online (admin geral ou gestor); getPresenceReport reforça isso por dentro e
// só devolve quem está no escopo de equipe do chamador.
export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const params = new URL(request.url).searchParams;

  try {
    return NextResponse.json(await getPresenceReport({
      period: params.get("period") || "today",
      startDate: params.get("startDate") || "",
      endDate: params.get("endDate") || ""
    }, auth));
  } catch (error) {
    return NextResponse.json({ error: formatAdminPresenceError(error) }, { status: 400 });
  }
}
