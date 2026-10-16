import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { answerCooledCase } from "@/lib/cooled-clients";
import { cooledErrorResponse } from "../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Passo 1 do fluxo de clientes que esfriaram: o corretor responsável escreve o motivo (só casos dele, fora de "Alterar conta").
// `quickReason: "no_response"` = opção pronta "Cliente não respondeu mais" (regra do dono, 2026-10-16): transfere direto pela roleta.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    return NextResponse.json(await answerCooledCase(auth, (await params).id, body?.text, { quickReason: body?.quickReason }));
  } catch (error) {
    return cooledErrorResponse(error);
  }
}
