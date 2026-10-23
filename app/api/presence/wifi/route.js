import { NextResponse } from "next/server";
import { isOwnerAdminEmail } from "@/lib/admin-auth";
import { applyWifiPresenceEvent, findWifiTokenOwner } from "@/lib/presence-wifi";
import { WIFI_RATE_LIMIT, handleWifiPresenceRequest } from "@/lib/presence-wifi-core.mjs";
import { buildRateLimitKey, checkPublicRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// PRES-WIFI (dono, 2026-10-23): o Atalho do iPhone chama aqui ao conectar/desconectar do Wi-Fi da imobiliária,
// com `Authorization: Bearer wfp_...` e corpo { event: "arrive" | "leave" }. Sem cookie de sessão (o Atalho não
// tem): a barreira é a chave pessoal (só o hash no banco) + quem pode usar + limite por IP — docs/PERMISSIONS.md.
// Resposta mínima de propósito (nada de dado do CRM).
export async function POST(request) {
  let body = {};
  try {
    body = await request.json();
  } catch {
    body = {};
  }
  try {
    const result = await handleWifiPresenceRequest({
      headers: request.headers,
      body,
      deps: {
        checkRateLimit: () => checkPublicRateLimit(buildRateLimitKey(request, "presence-wifi"), WIFI_RATE_LIMIT),
        findTokenOwner: findWifiTokenOwner,
        isOwnerEmail: isOwnerAdminEmail,
        applyEvent: applyWifiPresenceEvent
      }
    });
    return NextResponse.json(result.json, { status: result.status });
  } catch {
    return NextResponse.json({ error: "Não foi possível registrar o evento." }, { status: 500 });
  }
}
