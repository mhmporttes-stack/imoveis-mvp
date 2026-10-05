import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { prepareClientDocumentsList, recordClientDocumentsListSent } from "@/lib/documents-forecast";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Botão "Enviar lista de documentos" da ficha do cliente (round 4). Quem ENVIA é o corretor, depois de ver a prévia: este
// endpoint nunca manda mensagem. Guard: requireAdminApi + escopo de equipe do cliente (getSimulationRegistration(id, auth),
// que usa assertCanAccessResponsibleUser). Durante "Alterar conta" é ação OPERACIONAL atribuída ao corretor emulado.
//   POST { action: "preparar" } (padrão) → { message, link }: texto + link da lista PERSONALIZADA do cliente
//   POST { action: "registrar" }         → grava "Lista de documentos enviada" na jornada (não muda status)
// Cliente arquivado / "Não contactar": 409. Sem simulação com valores: 422 ("Lance a simulação primeiro").

function origin(request) {
  const host = request.headers.get("x-forwarded-host") || request.headers.get("host") || "";
  const proto = request.headers.get("x-forwarded-proto") || "https";
  return host ? `${proto}://${host}` : "";
}

export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  let payload = {};
  try {
    payload = await request.json();
  } catch {
    payload = {};
  }
  const action = payload?.action === "registrar" ? "registrar" : "preparar";
  const { id } = await params;

  try {
    if (action === "registrar") {
      const result = await recordClientDocumentsListSent(id, auth);
      if (result.kind === "not_found") return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
      if (result.kind === "blocked") return NextResponse.json({ error: "Este cliente não pode receber mensagens." }, { status: 409 });
      return NextResponse.json({ ok: true }, { headers: { "Cache-Control": "no-store" } });
    }
    const result = await prepareClientDocumentsList(id, auth, origin(request));
    if (result.kind === "not_found") return NextResponse.json({ error: "Cliente não encontrado." }, { status: 404 });
    if (result.kind === "blocked") return NextResponse.json({ error: "Este cliente não pode receber mensagens." }, { status: 409 });
    if (result.kind === "no_simulation") return NextResponse.json({ error: "Lance a simulação primeiro." }, { status: 422 });
    if (result.kind === "unavailable") return NextResponse.json({ error: "Recurso ainda não ativado no banco." }, { status: 503 });
    return NextResponse.json({ message: result.message, link: result.link }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    if (error?.name === "AdminPermissionError") return NextResponse.json({ error: error.message || "Acesso negado." }, { status: 403 });
    console.error("Falha ao preparar a lista de documentos do cliente:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível preparar a lista de documentos." }, { status: 500 });
  }
}
