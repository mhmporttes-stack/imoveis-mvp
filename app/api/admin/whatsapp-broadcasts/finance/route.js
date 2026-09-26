import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { isGeneralAdminAuth } from "@/lib/admin-profiles";
import { formatWhatsappBroadcastError } from "@/lib/whatsapp-broadcasts";
import { getBroadcastFinanceReport, saveWhatsappPricing } from "@/lib/whatsapp-broadcast-finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Gastos e desempenho dos disparos (admin/gestor — a checagem real fica no lib).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const days = Number(new URL(request.url).searchParams.get("days") || 0);
    const report = await getBroadcastFinanceReport({ days: [7, 30, 90].includes(days) ? days : 0 }, auth);
    return NextResponse.json({ ...report, canEditPricing: isGeneralAdminAuth(auth) });
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}

// Tabela de preços por mensagem (só o administrador geral).
export async function PUT(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    return NextResponse.json({ pricing: await saveWhatsappPricing(body?.rates || {}, auth) });
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}
