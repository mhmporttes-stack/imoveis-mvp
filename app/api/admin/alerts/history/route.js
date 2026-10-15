import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listMyAlertHistory } from "@/lib/crm-alerts";
import { alertErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Histórico de notificações do PRÓPRIO usuário (botão de sino do cabeçalho): últimos 30 dias, lidas e não lidas.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await listMyAlertHistory(auth));
  } catch (error) {
    return alertErrorResponse(error);
  }
}
