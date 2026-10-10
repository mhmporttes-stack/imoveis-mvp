import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { getWhatsappSessionHealth } from "@/lib/whatsapp-session-health";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 20;

// Painel de saúde por número do WhatsApp individual (WA-21, dono 2026-10-10). SOMENTE LEITURA.
// Admin/gestora (guard) e recorte de equipe no backend: gestora = só a equipe dela (lib/whatsapp-session-health.js).
export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await getWhatsappSessionHealth(auth));
  } catch (error) {
    if (!error?.status) console.error("Falha ao montar a saúde dos números do WhatsApp:", error?.message || error);
    return NextResponse.json({ error: error?.status ? error.message : "Não foi possível carregar a saúde dos números." }, { status: error?.status || 500 });
  }
}
