import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { sendTestAlertToMe } from "@/lib/crm-alerts";
import { alertErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Alerta de TESTE só para o próprio administrador (nunca para corretores).
export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ alert: await sendTestAlertToMe(auth, body?.kind) }, { status: 201 });
  } catch (error) {
    return alertErrorResponse(error);
  }
}
