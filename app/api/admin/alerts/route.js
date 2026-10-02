import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listMyPendingAlerts } from "@/lib/crm-alerts";
import { alertErrorResponse } from "./errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Alertas pendentes do PRÓPRIO usuário (Central de Alertas).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await listMyPendingAlerts(auth));
  } catch (error) {
    return alertErrorResponse(error);
  }
}
