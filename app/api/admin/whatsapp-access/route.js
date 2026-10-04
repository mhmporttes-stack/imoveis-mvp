import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { setWhatsappAccessBlocked } from "@/lib/whatsapp-access";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Libera/bloqueia o acesso de UM corretor aos recursos WhatsApp do CRM (2026-10-04, switch no card da Meta Diária).
// Só admin/gestor (gestor só da equipe dele) — a verificação e a auditoria ficam em setWhatsappAccessBlocked; o
// próprio corretor nunca chega aqui com permissão (assertGeneralAdminOrManager).
export async function PATCH(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json();
    const result = await setWhatsappAccessBlocked(auth, String(body?.brokerId || ""), body?.blocked);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: error.message || "Não foi possível alterar o acesso." }, { status: error?.status || 400 });
  }
}
