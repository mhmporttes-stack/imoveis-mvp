import { NextResponse } from "next/server";
import { getExtensionRuntime } from "@/lib/browser-extensions";
import { authenticateExtensionRequest } from "../extension-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Extensão → CRM, antes de cada ação (EXT-1): "Parar tudo", configuração editada pelo dono na tela Extensões e versão
// mais nova (aviso de atualização). Só dados; a extensão valida de novo.
export async function GET(request) {
  const auth = await authenticateExtensionRequest(request, "extensoes-estado", 90);
  if (auth.response) return auth.response;
  try {
    const runtime = await getExtensionRuntime(auth.ext, { runningVersion: auth.version, origin: new URL(request.url).origin });
    return NextResponse.json(runtime, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    console.error("[extensoes] estado não lido:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível ler o estado." }, { status: 500 });
  }
}
