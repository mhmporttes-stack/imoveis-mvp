import { NextResponse } from "next/server";
import { reportMarketplaceOutboundResult } from "@/lib/marketplace-chat";
import { isUuid } from "@/lib/short-links.mjs";
import { rejectExtensionRequest } from "../../../extension-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Extensão: { status: "sent" } ou { status: "failed", error, retry }.
export async function POST(request, { params }) {
  const rejected = await rejectExtensionRequest(request, "marketplace-chat-result");
  if (rejected) return rejected;
  const { id } = await params;
  if (!isUuid(id)) return NextResponse.json({ error: "Mensagem inválida." }, { status: 400 });
  const body = await request.json().catch(() => null);
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  try {
    const result = await reportMarketplaceOutboundResult(id, body);
    return NextResponse.json({ ok: true, status: result.status });
  } catch (error) {
    return NextResponse.json({ error: error?.status ? error.message : "Não foi possível registrar o resultado." }, { status: error?.status || 500 });
  }
}
