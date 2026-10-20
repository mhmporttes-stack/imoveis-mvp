import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { setDocumentReceivedOffline } from "@/lib/document-received-offline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST { clientId, undo? } — "Recebi documentos por fora" do card (REGRA OFICIAL do dono, 2026-10-19). Qualquer perfil ativo,
// mas só sobre cliente do próprio escopo (assertCanAccessResponsibleUser dentro de setDocumentReceivedOffline). Só grava o
// evento na linha do tempo: não conta como atendimento nem como ponto. Durante "Alterar conta" é ação operacional
// (fica no nome do corretor emulado, como as demais ações do card).
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  const clientId = typeof body?.clientId === "string" ? body.clientId : "";
  if (!clientId) return NextResponse.json({ error: "Cliente não informado." }, { status: 400 });
  try {
    const result = await setDocumentReceivedOffline({ auth, clientId, undo: body.undo === true });
    return NextResponse.json({ ok: true, ...result }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error?.name === "AdminPermissionError") return NextResponse.json({ error: error.message || "Acesso negado." }, { status: 403 });
    if (error?.name === "OfflineDocumentError") return NextResponse.json({ error: error.message }, { status: error.status || 409 });
    console.error("Falha ao marcar documento recebido por fora:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível marcar agora. Tente de novo." }, { status: 500 });
  }
}
