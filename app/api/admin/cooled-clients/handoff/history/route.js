import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getCooledChatHistory } from "@/lib/cooled-clients";
import { cooledErrorResponse } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// FUN-15g (dono, 2026-10-16): conversa do cliente TRANSFERIDO com o corretor anterior, somente leitura, até a
// transferência (FUN-15, transferência manual, "Devolver para a roleta", "Ninguém (liberar)" do Chat). Quem pode ver,
// o corte e quais mensagens entram: getCooledChatHistory (lib/cooled-clients.js).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const clientId = new URL(request.url).searchParams.get("clientId") || "";
    return NextResponse.json({ history: await getCooledChatHistory(auth, clientId) });
  } catch (error) {
    return cooledErrorResponse(error);
  }
}
