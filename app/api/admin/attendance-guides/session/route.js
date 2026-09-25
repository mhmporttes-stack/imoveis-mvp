import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getGuideSession, resetGuideProgress, saveGuideProgress } from "@/lib/attendance-guides";
import { guideErrorResponse } from "../guide-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Uso pelo corretor (ao lado do Chat). Qualquer usuário do CRM com ACESSO À CONVERSA (mesma regra do Chat).

// GET ?conversationId=…[&guideId=…] -> guia da conversa (versão publicada) + progresso salvo.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId") || "";
    if (!conversationId) return NextResponse.json({ error: "Conversa não informada." }, { status: 400 });
    return NextResponse.json(await getGuideSession({ conversationId, guideId: url.searchParams.get("guideId") || "" }, auth));
  } catch (error) {
    return guideErrorResponse(error, "Não foi possível abrir o guia de atendimento.");
  }
}

// PUT { conversationId, guideId, state } -> salva o ponto em que o corretor está.
export async function PUT(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    if (!body?.conversationId || !body?.guideId) return NextResponse.json({ error: "Dados incompletos." }, { status: 400 });
    return NextResponse.json(await saveGuideProgress({ conversationId: body.conversationId, guideId: body.guideId, state: body.state }, auth));
  } catch (error) {
    return guideErrorResponse(error, "Não foi possível salvar o progresso.");
  }
}

// DELETE ?conversationId=…&guideId=… -> reinicia o guia deste cliente.
export async function DELETE(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const url = new URL(request.url);
    const conversationId = url.searchParams.get("conversationId") || "";
    const guideId = url.searchParams.get("guideId") || "";
    if (!conversationId || !guideId) return NextResponse.json({ error: "Dados incompletos." }, { status: 400 });
    return NextResponse.json(await resetGuideProgress({ conversationId, guideId }, auth));
  } catch (error) {
    return guideErrorResponse(error, "Não foi possível reiniciar o guia.");
  }
}
