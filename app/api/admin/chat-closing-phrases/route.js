import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { isAdminPermissionError } from "@/lib/admin-access";
import { loadClosingPhrasesSettings, saveClosingPhrasesSettings } from "@/lib/chat-closing-phrases";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Lista da aba "Sem resposta" (WA-38): frases que tiram a conversa da aba. Só admin geral ou gestor; vale para os dois Chats.
function errorResponse(error, fallback) {
  const status = error?.status || (isAdminPermissionError(error) ? 403 : 500);
  if (status === 500) console.error("[chat-closing-phrases]", error?.message || error);
  return NextResponse.json({ error: status === 500 ? fallback : error.message }, { status });
}

export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ settings: await loadClosingPhrasesSettings(auth) });
  } catch (error) {
    return errorResponse(error, "Não foi possível carregar a lista.");
  }
}

export async function PUT(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null);
  if (!body || typeof body !== "object") return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  try {
    return NextResponse.json({ settings: await saveClosingPhrasesSettings(auth, { closing: body.closing, negative: body.negative, reset: body.reset === true }) });
  } catch (error) {
    return errorResponse(error, "Não foi possível salvar a lista.");
  }
}
