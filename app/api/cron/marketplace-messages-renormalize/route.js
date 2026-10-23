import { NextResponse } from "next/server";
import { createHash, timingSafeEqual } from "crypto";
import { renormalizeMarketplaceMessages } from "@/lib/marketplace-chat";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 55;

// Acionamento manual (não agendado): renormaliza as mensagens do Marketplace já gravadas (aria-label inteiro, avatar
// como anexo, avisos do Facebook). Sem ?apply=1 só conta o que mudaria. Mesma autenticação das rotas de cron.
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
    return NextResponse.json({ ok: true, ...(await renormalizeMarketplaceMessages({ apply })) });
  } catch (error) {
    console.error("Falha ao renormalizar mensagens do Marketplace.", error);
    return NextResponse.json({ error: "Falha ao renormalizar as mensagens do Marketplace." }, { status: 500 });
  }
}
