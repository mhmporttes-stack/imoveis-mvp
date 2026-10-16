import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { resolveCooledHistoryMedia } from "@/lib/cooled-clients";
import { parseByteRange } from "@/lib/whatsapp-media-utils.mjs";
import { cooledErrorResponse } from "../../../../errors";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

// FUN-15g: foto/áudio/documento do histórico da conversa anterior, com a MESMA checagem do histórico. Só o que já
// está guardado no storage. Áudio em bytes (com Range, para o player); demais redirecionam para endereço temporário.
export async function GET(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const query = new URL(request.url).searchParams;
    const result = await resolveCooledHistoryMedia(auth, query.get("clientId") || "", (await params).messageId, { download: query.get("download") === "1" });
    if (result.kind === "redirect") {
      return new NextResponse(null, { status: 302, headers: { Location: result.url, "Cache-Control": "private, no-store" } });
    }
    const { buffer, contentType } = result;
    const size = buffer.length;
    const headers = { "Content-Type": contentType, "Accept-Ranges": "bytes", "Cache-Control": "private, no-store" };
    const range = parseByteRange(request.headers.get("range"), size);
    if (range === "invalid") return new NextResponse(null, { status: 416, headers: { ...headers, "Content-Range": `bytes */${size}` } });
    if (range) {
      const chunk = buffer.subarray(range.start, range.end + 1);
      return new NextResponse(chunk, { status: 206, headers: { ...headers, "Content-Length": String(chunk.length), "Content-Range": `bytes ${range.start}-${range.end}/${size}` } });
    }
    return new NextResponse(buffer, { status: 200, headers: { ...headers, "Content-Length": String(size) } });
  } catch (error) {
    return cooledErrorResponse(error);
  }
}
