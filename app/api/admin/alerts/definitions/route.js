import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { listAlertDefinitions, setAlertDefinitionEnabled } from "@/lib/crm-alerts";
import { alertErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Definições de alerta (administrador geral): listar e ligar/desligar.
export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ definitions: await listAlertDefinitions(auth) });
  } catch (error) {
    return alertErrorResponse(error);
  }
}

export async function PATCH(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json({ definition: await setAlertDefinitionEnabled(auth, body?.id, body?.enabled) });
  } catch (error) {
    return alertErrorResponse(error);
  }
}
