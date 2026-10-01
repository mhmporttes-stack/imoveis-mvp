import { NextResponse } from "next/server";
import { requireGeneralAdminApi } from "@/lib/admin-auth";
import { testAlexaPhrase } from "@/lib/alexa-service";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function POST(request) {
  const auth = await requireGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  let body = {};
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Escreva uma frase para testar." }, { status: 400 });
  }
  const result = await testAlexaPhrase(body?.phrase);
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: 400 });
  return NextResponse.json({ ok: true, sentAt: new Date().toISOString() });
}
