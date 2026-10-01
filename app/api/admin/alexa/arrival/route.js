import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { buildArrivalSummary, generateArrivalToken, getArrivalStatus, speakArrivalSummary } from "@/lib/alexa-arrival";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  return NextResponse.json({ status: await getArrivalStatus() });
}

// action: "token" (gera a chave do iPhone — aparece só nesta resposta),
// "preview" (monta o resumo agora, sem falar) ou "speak" (monta e fala agora).
export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }

  try {
    if (body.action === "token") {
      const token = await generateArrivalToken(auth.profile?.id || null);
      return NextResponse.json({ token });
    }
    if (body.action === "preview" || body.action === "speak") {
      // "at" (só na prévia): simula outro instante (ISO), p.ex. para conferir aniversários de uma data.
      const at = body.action === "preview" && body.at ? new Date(body.at) : null;
      const text = await buildArrivalSummary(auth.profile?.id || null, at && Number.isFinite(at.getTime()) ? at : undefined);
      if (body.action === "preview") return NextResponse.json({ text });
      const result = await speakArrivalSummary(text, { force: true });
      if (!result.spoken) return NextResponse.json({ error: "Não foi possível falar na Alexa agora.", text }, { status: 400 });
      return NextResponse.json({ ok: true, text, sentAt: new Date().toISOString() });
    }
    return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  } catch (error) {
    return NextResponse.json({ error: error?.message || "Não foi possível concluir a ação." }, { status: 500 });
  }
}
