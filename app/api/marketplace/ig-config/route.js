import { NextResponse } from "next/server";
import { getInstagramExtensionConfig } from "@/lib/marketplace-chat";
import { rejectExtensionRequest } from "../chat/extension-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Extensão pessoal do Instagram (1.1.13) ← CRM: configuração remota (textos/seletores/tempos — só dados, nunca código)
// e comandos de uma lista fechada (a extensão valida). Mesma chave pessoal (Bearer mkp_…) e limite por IP das outras
// rotas da extensão. Sem registro em crm_settings: { config: {}, commands: [] } (a extensão usa o padrão embutido).
export async function GET(request) {
  const rejected = await rejectExtensionRequest(request, "marketplace-ig-config");
  if (rejected) return rejected;
  try {
    return NextResponse.json({ ok: true, ...(await getInstagramExtensionConfig()) }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return NextResponse.json({ error: error?.status ? error.message : "Não foi possível ler a configuração." }, { status: error?.status || 500 });
  }
}
