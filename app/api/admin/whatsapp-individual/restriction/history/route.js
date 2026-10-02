import { NextResponse } from "next/server";
import { isGeneralAdmin, requireBrokerManagementApi } from "@/lib/admin-auth";
import { listRestrictionHistory } from "@/lib/whatsapp-restriction";
import { canViewRestriction } from "@/lib/whatsapp-restriction-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Histórico append-only de um corretor (admin geral: qualquer; gestora: só a equipe).
export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const userId = String(new URL(request.url).searchParams.get("userId") || "").trim();
  if (!userId) return NextResponse.json({ error: "Informe o corretor." }, { status: 400 });
  const allowed = canViewRestriction({
    viewerId: auth.profile?.id, viewerRole: auth.profile?.role, isGeneralAdmin: isGeneralAdmin(auth), targetUserId: userId, managedUserIds: auth.profile?.managedUserIds || []
  });
  if (!allowed) return NextResponse.json({ error: "Sem acesso a este corretor." }, { status: 403 });
  try {
    return NextResponse.json({ history: await listRestrictionHistory(userId) });
  } catch (error) {
    console.error("Falha ao ler o histórico da restrição do WhatsApp:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível ler o histórico." }, { status: 500 });
  }
}
