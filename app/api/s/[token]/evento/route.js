import { NextResponse } from "next/server";
import { recordPresentationEvent } from "@/lib/simulation-presentation";
import {
  createRateLimiter,
  isLikelyBot,
  isPresentationToken,
  parsePresentationEvent
} from "@/lib/simulation-presentation-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint PÚBLICO mínimo das métricas da apresentação (/s/<token>). Sem login, por isso:
//  - allowlist estrita do corpo ({tipo: abriu|cena|concluiu, cena, nova}); qualquer outra coisa → 400;
//  - nunca grava IP nem user-agent (o user-agent só serve para descartar bot óbvio, na memória);
//  - limite de taxa simples por link (em memória; sem IP);
//  - idempotente: o banco só avança contadores/marcos (função SQL atômica);
//  - token fora do formato/inexistente/revogado → 404 genérico, sem detalhe.
const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const allow = createRateLimiter({ limit: 60, windowMs: 60_000 });

function respond(body, status) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function POST(request, { params }) {
  const { token } = await params;
  if (!isPresentationToken(token)) return respond({ error: "Não encontrado." }, 404);

  let text = "";
  try {
    text = await request.text();
  } catch {
    return respond({ error: "Requisição inválida." }, 400);
  }
  if (text.length > 200) return respond({ error: "Requisição inválida." }, 400);
  let body = null;
  try {
    body = JSON.parse(text);
  } catch {
    return respond({ error: "Requisição inválida." }, 400);
  }
  const event = parsePresentationEvent(body);
  if (!event) return respond({ error: "Requisição inválida." }, 400);

  if (isLikelyBot(request.headers.get("user-agent") || "")) return respond({ ok: true }, 202);
  if (!allow(token)) return respond({ error: "Muitas requisições." }, 429);

  try {
    const found = await recordPresentationEvent(token, event);
    if (!found) return respond({ error: "Não encontrado." }, 404);
    return respond({ ok: true }, 200);
  } catch (error) {
    console.error("Falha ao registrar evento da apresentação:", error?.message || error);
    return respond({ error: "Indisponível no momento." }, 503);
  }
}
