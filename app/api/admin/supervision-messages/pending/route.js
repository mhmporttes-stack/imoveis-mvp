import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listPendingSupervisionMessages } from "@/lib/supervision-messages";
import { supervisionErrorResponse } from "../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Mensagens da supervisão aguardando confirmação do PRÓPRIO usuário logado
// (balão central do corretor). Escopo sempre auth.profile.id.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    return NextResponse.json(await listPendingSupervisionMessages(auth));
  } catch (error) {
    return supervisionErrorResponse(error);
  }
}
