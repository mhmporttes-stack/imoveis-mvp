import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { formatWhatsappBroadcastError, searchBaseContacts } from "@/lib/whatsapp-broadcasts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Busca paginada na Base da Imobiliária (item 12: nunca carregar a base
// inteira de uma vez) — já exclui "não contactar novamente" no servidor.
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const url = new URL(request.url);
    const result = await searchBaseContacts({
      query: url.searchParams.get("query") || "",
      limit: url.searchParams.get("limit") || 50,
      offset: url.searchParams.get("offset") || 0
    }, auth);
    return NextResponse.json(result);
  } catch (error) {
    return NextResponse.json({ error: formatWhatsappBroadcastError(error) }, { status: error?.status || 400 });
  }
}
