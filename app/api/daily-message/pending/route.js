import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getPendingDailyMessageForUser } from "@/lib/daily-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Qualquer usuário autenticado do CRM (não só quem tem acesso a Gestão) —
// é o "listener global" que efetivamente executa o alerta para o
// destinatário, distinto da tela de configuração/disparo, que é restrita.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const pending = await getPendingDailyMessageForUser(auth);
    return NextResponse.json({ ok: true, pending });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível verificar a Mensagem do Dia." }, { status: 400 });
  }
}
