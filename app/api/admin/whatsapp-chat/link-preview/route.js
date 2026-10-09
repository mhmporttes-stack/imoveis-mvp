import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getChatLinkPreview } from "@/lib/chat-link-preview";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Prévia (cartão "como no WhatsApp") de um link mostrado no Chat. Link do próprio site: textos do site; externo:
// Open Graph buscado pelo servidor com proteção contra SSRF (lib/chat-link-preview.js). Sem prévia → { preview: null }.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const url = request.nextUrl.searchParams.get("url") || "";
    const preview = await getChatLinkPreview(url);
    return NextResponse.json({ preview }, { headers: { "Cache-Control": "private, max-age=3600" } });
  } catch (error) {
    if (error?.status === 400) return NextResponse.json({ error: error.message }, { status: 400 });
    console.error("Erro na prévia de link do Chat:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível montar a prévia do link." }, { status: 500 });
  }
}
