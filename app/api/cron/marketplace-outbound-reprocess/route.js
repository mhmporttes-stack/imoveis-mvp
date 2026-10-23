import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { reprocessMarketplaceOutboundFailures } from "@/lib/marketplace-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

// Acionamento manual (não agendado): reprocessa respostas do Marketplace não enviadas — confirma pelo eco as que saíram
// e devolve à fila UMA vez as que certamente não digitaram. Sem ?apply=1 só conta. Mesma autenticação das rotas de cron.
export async function GET(request) {
  const secret = process.env.CRON_SECRET || "";
  const hash = process.env.SUPABASE_CRON_TOKEN_HASH || "";
  const authorization = request.headers.get("authorization") || "";
  const token = authorization.startsWith("Bearer ") ? authorization.slice(7) : "";
  const suppliedHash = createHash("sha256").update(token).digest("hex");
  const validVaultToken = hash.length === suppliedHash.length && timingSafeEqual(Buffer.from(hash), Buffer.from(suppliedHash));
  if ((!secret || authorization !== `Bearer ${secret}`) && !validVaultToken) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }
  try {
    const apply = new URL(request.url).searchParams.get("apply") === "1";
    return NextResponse.json({ ok: true, ...(await reprocessMarketplaceOutboundFailures({ apply })) });
  } catch (error) {
    console.error("Falha ao reprocessar envios do Marketplace.", error);
    return NextResponse.json({ error: "Falha ao reprocessar os envios do Marketplace." }, { status: 500 });
  }
}
