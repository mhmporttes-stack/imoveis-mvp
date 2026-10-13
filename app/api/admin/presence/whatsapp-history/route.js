import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { formatAdminPresenceError, getMemberWhatsappHistory } from "@/lib/admin-presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Histórico de conexão do WhatsApp (conectou/desconectou por número) de um integrante — mesmo gate do painel Online (admin geral ou gestor);
// getMemberWhatsappHistory recusa quem está fora da equipe de quem pede.
export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = new URL(request.url);
    const userId = url.searchParams.get("userId") || "";
    if (!userId) return NextResponse.json({ error: "Informe o integrante." }, { status: 400 });
    return NextResponse.json(await getMemberWhatsappHistory(auth, userId, { date: url.searchParams.get("date") || "" }));
  } catch (error) {
    return NextResponse.json({ error: formatAdminPresenceError(error) }, { status: 400 });
  }
}
