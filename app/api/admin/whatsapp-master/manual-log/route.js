import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { listManualWhatsappLog, logManualWhatsappAction } from "@/lib/whatsapp-manual-summary";

export const runtime = "nodejs";

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);
    const limit = Number(searchParams.get("limit") || 20);
    const log = await listManualWhatsappLog({ limit });
    return NextResponse.json({ log });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível carregar o histórico." }, { status: error?.status || 400 });
  }
}

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await request.json();
    await logManualWhatsappAction({
      brokerId: body.brokerId,
      performedBy: auth.profile?.id || null,
      summaryType: body.summaryType,
      action: body.action
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível registrar a ação." }, { status: error?.status || 400 });
  }
}
