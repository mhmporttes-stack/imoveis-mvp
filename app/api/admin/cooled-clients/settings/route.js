import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { setCooledFlowEnabled } from "@/lib/cooled-clients";
import { cooledErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Liga/desliga do fluxo de clientes que esfriaram (crm_settings `cooled_clients_flow`, nasce desligado). Só o admin geral.
export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await setCooledFlowEnabled(auth, body?.enabled === true));
  } catch (error) {
    return cooledErrorResponse(error);
  }
}
