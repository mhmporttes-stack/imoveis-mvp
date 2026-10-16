import { NextResponse } from "next/server";
import { requireBrokerManagementApi } from "@/lib/admin-auth";
import { decideCooledCase } from "@/lib/cooled-clients";
import { cooledErrorResponse } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Passo 2: a decisora (gestora da equipe ou o dono) transfere, aplica status negativo ou devolve (uma vez).
export async function POST(request, { params }) {
  const auth = await requireBrokerManagementApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await decideCooledCase(auth, (await params).id, { action: body?.action, status: body?.status, text: body?.text }));
  } catch (error) {
    return cooledErrorResponse(error);
  }
}
