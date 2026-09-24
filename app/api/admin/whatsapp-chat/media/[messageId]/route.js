import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { getChatMessageMedia } from "@/lib/whatsapp-chat";
import { parseByteRange } from "@/lib/whatsapp-media-utils.mjs";
import { chatErrorResponse } from "../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Áudio recebido do cliente, servido pelo CRM (autenticado). Baixa da Meta na primeira vez se preciso
// (?retry=1 força nova tentativa) e suporta Range para o player avançar/voltar.
export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const retry = new URL(request.url).searchParams.get("retry") === "1";
    const { buffer, contentType } = await getChatMessageMedia((await params).messageId, auth, { retry });
    const size = buffer.length;
    const headers = { "Content-Type": contentType, "Accept-Ranges": "bytes", "Cache-Control": "private, max-age=3600" };

    const range = parseByteRange(request.headers.get("range"), size);
    if (range === "invalid") return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    if (range) {
      const chunk = buffer.subarray(range.start, range.end + 1);
      return new NextResponse(chunk, { status: 206, headers: { ...headers, "Content-Length": String(chunk.length), "Content-Range": `bytes ${range.start}-${range.end}/${size}` } });
    }
    return new NextResponse(buffer, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  } catch (error) {
    return chatErrorResponse(error);
  }
}
