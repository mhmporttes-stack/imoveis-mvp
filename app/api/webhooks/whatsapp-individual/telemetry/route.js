import { NextResponse } from "next/server";
import { verifyIndividualServiceSecret } from "@/lib/whatsapp-individual";
import { recordSessionTelemetry } from "@/lib/whatsapp-session-telemetry";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// Telemetria de conexão enviada em LOTE pelo whatsapp-individual-service/
// (src/telemetry.js): tentativas de conexão, quedas, ciclos de reconexão,
// boot do serviço. Autenticado por X-Service-Secret (nunca por cookie/sessão
// do CRM). Só grava em whatsapp_session_telemetry; nenhuma outra parte do CRM
// reage a isso.
export async function POST(request) {
  if (!verifyIndividualServiceSecret(request.headers.get("x-service-secret"))) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  try {
    const result = await recordSessionTelemetry(payload?.events);
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("Erro ao gravar telemetria do WhatsApp individual:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível gravar a telemetria." }, { status: 500 });
  }
}
