import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { loadSmsBatch, markSmsOptOut, markSmsSecondSent, markSmsSent, saveSmsBatchSettings, undoSmsSent } from "@/lib/sms-batch";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lote de SMS (dono, 2026-11-02) — só admin geral e gestor. GET = lista do dia; POST = ação.
function failure(error) {
  const status = Number(error?.status) >= 400 ? Number(error.status) : 500;
  if (status === 500) console.error("Lote de SMS falhou:", error?.message || error);
  return NextResponse.json({ error: status === 500 ? "Não foi possível concluir agora." : error?.message || "Não foi possível concluir." }, { status });
}

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json(await loadSmsBatch(auth));
  } catch (error) {
    return failure(error);
  }
}

export async function POST(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    if (body.action === "sent") return NextResponse.json(await markSmsSent(body.contactId, auth));
    if (body.action === "sent-2") return NextResponse.json(await markSmsSecondSent(body.sendId, auth));
    if (body.action === "undo") return NextResponse.json(await undoSmsSent(body.sendId, auth));
    if (body.action === "opt-out") return NextResponse.json(await markSmsOptOut(body.sendId, auth));
    if (body.action === "settings") return NextResponse.json(await saveSmsBatchSettings({ template: body.template, template2: body.template2, limit: body.limit }, auth));
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return failure(error);
  }
}
