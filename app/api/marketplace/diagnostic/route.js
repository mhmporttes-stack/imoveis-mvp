import { NextResponse } from "next/server";
import { saveMarketplaceDiagnostic } from "@/lib/marketplace-chat";
import { rejectExtensionRequest } from "../chat/extension-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Extensão → CRM: esqueleto anonimizado da página do Facebook (sem nomes nem mensagens) para calibrar seletores.
// Mesma chave pessoal (Bearer mkp_…) e limite por IP das outras rotas da extensão.
export async function POST(request) {
  const rejected = await rejectExtensionRequest(request, "marketplace-diagnostic");
  if (rejected) return rejected;
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  try {
    return NextResponse.json({ ok: true, id: (await saveMarketplaceDiagnostic(body)).id });
  } catch (error) {
    return NextResponse.json({ error: error?.status ? error.message : "Não foi possível gravar o diagnóstico." }, { status: error?.status || 500 });
  }
}
