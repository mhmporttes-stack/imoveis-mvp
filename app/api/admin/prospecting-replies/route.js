import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { listOpenProspectingReplies } from "@/lib/prospecting-reply";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Pendências "Respostas da prospecção" visíveis para quem pergunta (escopo
// por responsável aplicado em listOpenProspectingReplies).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    return NextResponse.json({ items: await listOpenProspectingReplies(auth) });
  } catch (error) {
    console.error("Erro ao listar respostas da prospecção:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível carregar as respostas da prospecção." }, { status: 500 });
  }
}
