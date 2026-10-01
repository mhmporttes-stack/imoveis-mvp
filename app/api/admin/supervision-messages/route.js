import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listSupervisionThread, sendSupervisionMessage } from "@/lib/supervision-messages";
import { supervisionErrorResponse } from "./errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET ?userId=&before= — histórico paginado da conversa de supervisão com
// um usuário (só admin geral, ou gestor sobre a própria equipe).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(request.url);
    return NextResponse.json(await listSupervisionThread(auth, {
      userId: searchParams.get("userId") || "",
      before: searchParams.get("before") || ""
    }));
  } catch (error) {
    return supervisionErrorResponse(error);
  }
}

// POST { recipientId, body } — gestor/admin envia uma mensagem que o
// corretor precisa confirmar.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const payload = await request.json().catch(() => ({}));
    return NextResponse.json(await sendSupervisionMessage(auth, payload));
  } catch (error) {
    return supervisionErrorResponse(error);
  }
}
