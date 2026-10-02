import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { markAlertsShown } from "@/lib/crm-alerts";
import { alertErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Registra o horário em que o alerta apareceu na tela do destinatário.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await markAlertsShown(auth, body?.ids));
  } catch (error) {
    return alertErrorResponse(error);
  }
}
