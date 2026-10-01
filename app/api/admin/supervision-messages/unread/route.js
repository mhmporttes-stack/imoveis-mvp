import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getSupervisionUnreadCounts } from "@/lib/supervision-messages";
import { supervisionErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Contagem de mensagens recebidas e ainda não vistas, por remetente (badge
// do card do corretor na Supervisão) + tópico de tempo real do usuário.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await getSupervisionUnreadCounts(auth));
  } catch (error) {
    return supervisionErrorResponse(error);
  }
}
