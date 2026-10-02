import { NextResponse } from "next/server";
import { isGeneralAdmin, requireBrokerManagementApi } from "@/lib/admin-auth";
import { getIndividualSessionStatusForUser } from "@/lib/whatsapp-individual";
import { validateRestriction } from "@/lib/whatsapp-restriction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Validar restrição" / "Não validar" — ação ADMINISTRATIVA: admin geral valida
// qualquer corretor; gestora só a própria equipe; o corretor nunca (guard 403 +
// escopo em validateRestriction). Não libera Prospecção/Meta Diária (PRO-11).
export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const targetUserId = String(body.userId || "").trim();
  const verdict = body.action === "validate" ? "validate" : body.action === "reject" ? "reject" : "";
  if (!targetUserId || !verdict) return NextResponse.json({ error: "Informe o corretor e a ação (validate ou reject)." }, { status: 400 });
  try {
    const sessionStatus = await getIndividualSessionStatusForUser(targetUserId);
    const result = await validateRestriction({
      actor: { id: auth.profile?.id, role: auth.profile?.role, isGeneralAdmin: isGeneralAdmin(auth), managedUserIds: auth.profile?.managedUserIds || [] },
      // Ação administrativa: registra o admin REAL, mesmo em "Alterar conta".
      validatedById: auth.realProfile?.id || auth.profile?.id,
      targetUserId,
      verdict,
      reason: typeof body.reason === "string" ? body.reason : "",
      sessionStatus
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Falha ao validar a restrição do WhatsApp:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível salvar." }, { status: 500 });
  }
}
