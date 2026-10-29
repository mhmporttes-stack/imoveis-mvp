import { NextResponse } from "next/server";
import { recordExtensionHealth } from "@/lib/browser-extensions";
import { authenticateExtensionRequest } from "../extension-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const MAX_BODY_BYTES = 60_000;

// Extensão → CRM: sinal de saúde (EXT-1) — versão, última rodada, ações do dia x limite, pausa, erros e seletores que
// falharam. Sem dado de terceiros (o servidor ainda mascara @, e-mail, telefone e links: scrubThirdPartyText).
export async function POST(request) {
  const auth = await authenticateExtensionRequest(request, "extensoes-saude", 30);
  if (auth.response) return auth.response;
  const text = await request.text().catch(() => "");
  if (!text || text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Sinal inválido." }, { status: 400 });
  let body;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Sinal inválido." }, { status: 400 });
  }
  try {
    await recordExtensionHealth(auth.ext, body, { version: auth.version });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("[extensoes] sinal de saúde não gravado:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível gravar o sinal." }, { status: 500 });
  }
}
