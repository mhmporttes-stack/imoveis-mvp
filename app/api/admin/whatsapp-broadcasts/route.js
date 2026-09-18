import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { createBroadcast, formatWhatsappBroadcastError, listBroadcastHistory } from "@/lib/whatsapp-broadcasts";
import { resolveOverviewRange } from "@/lib/performance-overview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Histórico (item 36) — filtros simples de período/template/status (item 38).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const url = new URL(request.url);
    const periodParam = url.searchParams.get("period") || "";
    const period = periodParam ? resolveOverviewRange({ period: periodParam }) : null;
    const broadcasts = await listBroadcastHistory({
      period,
      templateId: url.searchParams.get("templateId") || "",
      status: url.searchParams.get("status") || ""
    }, auth);
    return NextResponse.json({ broadcasts });
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}

// Cria o lote (item 10) — status 'draft', ainda não dispara nada (ver
// [id]/dispatch/route.js para o "Disparar agora").
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    return NextResponse.json({ broadcast: await createBroadcast(body, auth) });
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}
