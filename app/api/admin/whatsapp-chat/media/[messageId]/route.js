import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { resolveChatMedia } from "@/lib/whatsapp-chat";
import { parseByteRange } from "@/lib/whatsapp-media-utils.mjs";
import { chatErrorResponse } from "../../chat-errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// Mídia recebida do cliente (áudio, imagem, documento, vídeo, figurinha), entregue pelo CRM com a
// permissão da conversa. Baixa da Meta na primeira vez se preciso (?retry=1 força nova tentativa).
// - áudio: bytes (com Range, para o player avançar/voltar);
// - demais: redireciona para um endereço temporário (5 min) do storage privado; ?download=1 salva
//   o arquivo com o nome original (documentos do cliente para enviar à análise).
export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const query = new URL(request.url).searchParams;
    const result = await resolveChatMedia((await params).messageId, auth, { retry: query.get("retry") === "1", download: query.get("download") === "1" });

    if (result.kind === "redirect") {
      return new NextResponse(null, { status: 302, headers: { Location: result.url, "Cache-Control": "private, no-store" } });
    }

    const { buffer, contentType } = result;
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
