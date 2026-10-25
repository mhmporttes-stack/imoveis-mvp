import { NextResponse } from "next/server";
import { recordMarketplaceExtensionSignal, syncMarketplaceConversations } from "@/lib/marketplace-chat";
import { rejectExtensionRequest } from "../extension-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Extensão → CRM: conversas do Marketplace (só elas) com as mensagens novas. Idempotente (id externo por conversa).
// Também roda a fila de espera e o prazo sem resposta da roleta. Devolve a configuração do Chat do Marketplace.
export async function POST(request) {
  const rejected = await rejectExtensionRequest(request, "marketplace-chat-sync");
  if (rejected) return rejected;
  const body = await request.json().catch(() => null);
  // Sinal de "extensão ativa" (MKT-2g): toda chamada autenticada conta, mesmo vazia, com corpo inválido ou com erro na
  // sincronização. Falha ao gravar o sinal não impede a sincronização (aparece no log; o cron avisaria "sem sinal").
  // round (extensão 1.9.8+): estado da rodada — o motivo de uma leitura que falhou chega ao CRM (nunca silêncio).
  await recordMarketplaceExtensionSignal(new Date(), { version: request.headers.get("x-extension-version") || "", round: body?.round || null }).catch((error) => console.error("[marketplace-chat] sinal da extensão não gravado:", error?.message || error));
  if (!body) return NextResponse.json({ error: "Requisição inválida." }, { status: 400 });
  try {
    return NextResponse.json(await syncMarketplaceConversations(body));
  } catch (error) {
    return NextResponse.json({ error: error?.status ? error.message : "Não foi possível sincronizar." }, { status: error?.status || 500 });
  }
}
