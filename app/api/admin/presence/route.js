import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { formatAdminPresenceError, getTeamPresence } from "@/lib/admin-presence";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mesmo gate de acesso da aba Gestão > Desempenho (admin geral ou gestor) —
// getTeamPresence também reforça isso por dentro e já filtra a lista pela
// mesma regra de visibilidade de equipe do Ranking, então não há como pedir
// a presença de alguém fora do escopo do chamador mesmo chamando esta rota
// diretamente.
export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await getTeamPresence(auth));
  } catch (error) {
    return NextResponse.json({ error: formatAdminPresenceError(error) }, { status: 400 });
  }
}
