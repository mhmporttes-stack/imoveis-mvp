import { NextResponse } from "next/server";
import {
  getIndividualSessionRow,
  listIndividualSessionsWithCreds,
  listTransientIndividualSessionRows,
  readIndividualSessionCredsInternal,
  verifyIndividualServiceSecret,
  writeIndividualSessionCredsInternal
} from "@/lib/whatsapp-individual";
import { parseSessionId } from "@/lib/whatsapp-session-slots.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

// Canal interno de estado para o microsserviço whatsapp-individual-service/:
// ele não tem SUPABASE_SERVICE_ROLE_KEY (esse segredo só existe aqui no
// Next.js), então lê/grava a linha e as credenciais cifradas do Baileys por
// HTTP, autenticado por X-Service-Secret — nunca por cookie/sessão do CRM.
export async function GET(request) {
  const secretHeader = request.headers.get("x-service-secret");
  if (!verifyIndividualServiceSecret(secretHeader)) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  const userId = String(request.nextUrl.searchParams.get("userId") || "").trim();
  const field = String(request.nextUrl.searchParams.get("field") || "row");

  try {
    // Único campo sem userId: lista quem tem credenciais salvas, pro
    // microsserviço retomar sozinho ao subir (ver listIndividualSessionsWithCreds).
    if (field === "resumable") {
      const userIds = await listIndividualSessionsWithCreds();
      return NextResponse.json({ userIds });
    }
    // Reconciliação (microsserviço): sessões gravadas como reconnecting/connecting.
    if (field === "transient") {
      const rows = await listTransientIndividualSessionRows();
      return NextResponse.json({ rows });
    }
    if (!userId) return NextResponse.json({ error: "userId não informado." }, { status: 400 });
    // "userId" do microsserviço = id da SESSÃO: "<id do corretor>" (Número 1, como sempre) ou "<id>:2" (Número 2).
    const session = parseSessionId(userId);
    if (!session) return NextResponse.json({ error: "userId inválido." }, { status: 400 });
    if (field === "creds") {
      const encrypted = await readIndividualSessionCredsInternal(session.userId, session.slot);
      return NextResponse.json({ encrypted });
    }
    const row = await getIndividualSessionRow(session.userId, session.slot);
    return NextResponse.json({ row });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Falha ao ler estado." }, { status: 500 });
  }
}

export async function POST(request) {
  const secretHeader = request.headers.get("x-service-secret");
  if (!verifyIndividualServiceSecret(secretHeader)) {
    return NextResponse.json({ error: "Assinatura inválida." }, { status: 401 });
  }

  let payload;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Payload inválido." }, { status: 400 });
  }

  const userId = String(payload?.userId || "").trim();
  if (!userId) return NextResponse.json({ error: "userId não informado." }, { status: 400 });
  const session = parseSessionId(userId);
  if (!session) return NextResponse.json({ error: "userId inválido." }, { status: 400 });

  try {
    await writeIndividualSessionCredsInternal(session.userId, payload.encrypted ?? null, session.slot);
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Falha ao gravar estado." }, { status: 500 });
  }
}
