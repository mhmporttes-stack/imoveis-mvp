import { NextResponse } from "next/server";
import { requireRealGeneralAdminApi } from "@/lib/admin-auth";
import { readExtensionZip } from "@/lib/browser-extensions";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Zip da versão mais nova da extensão (gerado do código do repositório). Só o administrador geral real — o link é
// aberto no Chrome do dono, já logado no CRM (tela Extensões e aviso de atualização da própria extensão).
export async function GET(request) {
  const auth = await requireRealGeneralAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const { fileName, buffer } = await readExtensionZip(new URL(request.url).searchParams.get("ext") || "");
    return new NextResponse(buffer, {
      headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="${fileName}"`, "Cache-Control": "no-store" }
    });
  } catch (error) {
    return NextResponse.json({ error: error?.status ? error.message : "Não foi possível baixar a extensão." }, { status: error?.status || 500 });
  }
}
