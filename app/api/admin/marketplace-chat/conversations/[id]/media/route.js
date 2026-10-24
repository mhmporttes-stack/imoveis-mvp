import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { queueMarketplaceMedia } from "@/lib/marketplace-chat";
import { isUuid } from "@/lib/short-links.mjs";
import { marketplaceChatErrorResponse } from "../../../errors";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Arquivo (foto/PDF, até 4 MB — fotos já reduzidas no navegador) da resposta do corretor: vira UM item da fila de saída;
// a extensão no PC do dono anexa pelo Facebook. Vários arquivos = a tela chama esta rota um por vez, na ordem mostrada.
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Conversa inválida." }, { status: 400 });
  try {
    const form = await request.formData().catch(() => null);
    const file = form?.get("file");
    if (!file || typeof file === "string") return NextResponse.json({ error: "Envie um arquivo." }, { status: 400 });
    const buffer = Buffer.from(await file.arrayBuffer());
    return NextResponse.json(await queueMarketplaceMedia(id, { buffer, mimeType: file.type, fileName: file.name }, auth), { status: 201 });
  } catch (error) {
    return marketplaceChatErrorResponse(error, "Não foi possível enviar o arquivo.");
  }
}
