import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { testFirstAccessBriefing } from "@/lib/alexa-bom-dia";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// "Ver bom dia agora" (action "preview", só monta o texto) e "Testar bom dia" (action "speak", fala agora ignorando o
// 1 vez por dia, a janela e o intervalo — como o "Testar Alexa"). docs/BUSINESS_RULES.md INI-4.
export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  }
  if (body?.action !== "preview" && body?.action !== "speak") return NextResponse.json({ error: "Ação inválida." }, { status: 400 });
  try {
    const result = await testFirstAccessBriefing(auth, { speak: body.action === "speak" });
    if (!result.ok) return NextResponse.json({ error: result.error, text: result.text || "" }, { status: 400 });
    return NextResponse.json({ ok: true, text: result.text, sentAt: body.action === "speak" ? new Date().toISOString() : null });
  } catch (error) {
    console.error("Alexa bom dia: falha ao montar:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível montar o bom dia agora." }, { status: 500 });
  }
}
