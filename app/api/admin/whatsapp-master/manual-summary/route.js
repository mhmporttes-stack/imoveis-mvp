import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { buildManualWhatsappSummary } from "@/lib/whatsapp-manual-summary";

export const runtime = "nodejs";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);
    const brokerId = searchParams.get("brokerId") || "";
    const period = searchParams.get("period") || "today";
    if (!brokerId) return NextResponse.json({ error: "Selecione um corretor." }, { status: 400 });

    const summary = await buildManualWhatsappSummary({ brokerId, period });
    return NextResponse.json(summary);
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível gerar o resumo." }, { status: error?.status || 400 });
  }
}
