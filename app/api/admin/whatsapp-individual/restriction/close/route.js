import { NextResponse } from "next/server";
import { isGeneralAdmin, requireBrokerManagementApi } from "@/lib/admin-auth";
import { closeValidatedRestriction } from "@/lib/whatsapp-restriction";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Encerrar restrição" de uma restrição VALIDADA — ação ADMINISTRATIVA (PRO-13, regra do
// dono 2026-10-02): admin geral encerra qualquer corretor; gestora só a própria equipe;
// o corretor nunca (guard 403 + escopo em closeValidatedRestriction). Não libera
// Prospecção/Meta Diária (PRO-11): o WhatsApp precisa estar `connected` de qualquer forma.
export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => ({}));
  const targetUserId = String(body.userId || "").trim();
  if (!targetUserId) return NextResponse.json({ error: "Informe o corretor." }, { status: 400 });
  try {
    const result = await closeValidatedRestriction({
      actor: { id: auth.profile?.id, role: auth.profile?.role, isGeneralAdmin: isGeneralAdmin(auth), managedUserIds: auth.profile?.managedUserIds || [] },
      // Ação administrativa: registra o admin REAL, mesmo em "Alterar conta".
      closedById: auth.realProfile?.id || auth.profile?.id,
      targetUserId,
      reason: typeof body.reason === "string" ? body.reason : ""
    });
    if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status });
    return NextResponse.json({ result: result.result });
  } catch (error) {
    console.error("Falha ao encerrar a restrição do WhatsApp:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível salvar." }, { status: 500 });
  }
}
