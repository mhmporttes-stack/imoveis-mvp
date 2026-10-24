import { NextResponse } from "next/server";
import { claimNextMarketplaceOutbound } from "@/lib/marketplace-chat";
import { rejectExtensionRequest } from "../../extension-auth";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Extensão: pega 1 resposta escrita por um corretor no CRM (marca "sending"). Respeita o limite por hora.
export async function GET(request) {
  const rejected = await rejectExtensionRequest(request, "marketplace-chat-outbox");
  if (rejected) return rejected;
  try {
    // Versão da extensão: arquivo (foto/PDF) só vai para a 1.9.5+ (as antigas só sabem enviar texto).
    return NextResponse.json(await claimNextMarketplaceOutbound(new Date(), { extensionVersion: request.headers.get("x-extension-version") || "" }));
  } catch (error) {
    return NextResponse.json({ error: error?.status ? error.message : "Não foi possível consultar a fila." }, { status: error?.status || 500 });
  }
}
