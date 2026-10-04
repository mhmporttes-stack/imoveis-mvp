import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { academyDisabledResponse, academyErrorResponse, academyManagementScope, getAcademyManagement } from "@/lib/academy-server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const STATUSES = new Set(["all", "overdue", "completed", "in_progress", "not_started"]);

// Equipe e andamento (F6). Admin: todos; Gerente: só a própria equipe (managedUserIds). Filtros: trilha, situação, nome.
export async function GET(request) {
  const off = academyDisabledResponse();
  if (off) return off;
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const sp = new URL(request.url).searchParams;
  const trackId = sp.get("trackId");
  const status = sp.get("status") || "all";
  if ((trackId && !/^[0-9a-f-]{36}$/i.test(trackId)) || !STATUSES.has(status)) return NextResponse.json({ error: "Filtro inválido.", code: "invalid_action" }, { status: 400 });
  try {
    const management = getAcademyManagement();
    if (!management) return NextResponse.json({ error: "Banco indisponível." }, { status: 503 });
    return NextResponse.json(await management.listTeam(academyManagementScope(auth), { trackId: trackId || undefined, status, q: sp.get("q") || "" }));
  } catch (error) {
    return academyErrorResponse(error);
  }
}
