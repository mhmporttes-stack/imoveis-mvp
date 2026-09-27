import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatWhatsappBroadcastError } from "@/lib/whatsapp-broadcasts";
import { listCampaignOptions } from "@/lib/whatsapp-broadcast-schedules";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Rotinas + campanhas avulsas recentes, para o gatilho "Respondeu a uma campanha de disparo" no editor de Fluxos.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await listCampaignOptions(auth));
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}
