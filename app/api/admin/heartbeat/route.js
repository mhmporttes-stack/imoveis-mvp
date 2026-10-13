import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { recordAdminHeartbeat } from "@/lib/admin-presence";
import { registerOfficeCheckinFromHeartbeat } from "@/lib/office-presence";
import { clientIpFromHeaders } from "@/lib/office-presence-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Qualquer usuário administrativo autenticado (corretor, associado, gestor,
// admin) pode registrar o próprio heartbeat — é só isso: "usuário X está
// ativo agora". Não aceita nenhum id no corpo da requisição; o usuário vem
// sempre do cookie de sessão, nunca de parâmetro do cliente.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    await recordAdminHeartbeat(auth, { userAgent: request.headers.get("user-agent") || "" });
    // ROL-2f: heartbeat vindo da rede da imobiliária marca a chegada do dia (nunca derruba o heartbeat).
    await registerOfficeCheckinFromHeartbeat(auth, clientIpFromHeaders(request.headers));
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Falha ao registrar presença." }, { status: 400 });
  }
}
