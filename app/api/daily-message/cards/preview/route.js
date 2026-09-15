import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { pickRandomCardPreview } from "@/lib/daily-message";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Escolher outro automaticamente": sorteia um card elegível SEM registrar
// shown_at/completed_at nem consumir histórico — não é para isto que serve
// preview.
export async function GET(request) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const type = new URL(request.url).searchParams.get("type") || "alternate";
    const card = await pickRandomCardPreview(type);
    return NextResponse.json({ ok: true, card });
  } catch (error) {
    console.error(error);
    return NextResponse.json({ error: error.message || "Não foi possível sortear um card." }, { status: error?.status || 400 });
  }
}
