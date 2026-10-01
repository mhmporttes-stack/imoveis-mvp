import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { markSupervisionThreadSeen } from "@/lib/supervision-messages";
import { supervisionErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { userId } — gestor abriu a conversa: marca como vistas as mensagens
// que esse usuário mandou para ele (zera o badge).
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const payload = await request.json().catch(() => ({}));
    return NextResponse.json(await markSupervisionThreadSeen(auth, payload.userId));
  } catch (error) {
    return supervisionErrorResponse(error);
  }
}
