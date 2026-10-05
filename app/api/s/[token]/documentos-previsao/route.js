import { NextResponse } from "next/server";
import { confirmDocumentsForecastByToken } from "@/lib/documents-forecast";
import { parseForecastBody } from "@/lib/documents-forecast-core.mjs";
import { createRateLimiter, isLikelyBot, isPresentationToken } from "@/lib/simulation-presentation-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint PÚBLICO da "previsão de envio dos documentos" (botão "Receber lista de documentos necessários" da apresentação
// /s/<token>). Sem login, por isso (mesmo padrão de /api/s/<token>/evento):
//  - allowlist estrita do corpo ({data:'AAAA-MM-DD', periodo:'manha'|'tarde'|'noite'}); a data TEM de estar nos próximos
//    10 dias (hoje + 9, America/Sao_Paulo) — qualquer outra coisa → 400;
//  - limite de taxa por link (5 por minuto, em memória; sem IP) e bot óbvio descartado;
//  - token fora do formato/inexistente/revogado → 404 genérico;
//  - o link do WhatsApp do corretor (wa.me) só existe NESTA resposta, depois de gravar; o DTO da página nunca o carrega.
const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const allow = createRateLimiter({ limit: 5, windowMs: 60_000 });

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
  const input = parseForecastBody(body, new Date());
  if (!input) return respond({ error: "Escolha uma das datas disponíveis e um período." }, 400);

  if (isLikelyBot(request.headers.get("user-agent") || "")) return respond({ ok: true, url: "" }, 202);
  if (!allow(token)) return respond({ error: "Muitas tentativas. Aguarde um instante e tente de novo." }, 429);

  try {
    const result = await confirmDocumentsForecastByToken(token, input);
    if (result.kind === "not_found") return respond({ error: "Não encontrado." }, 404);
    if (result.kind === "blocked") return respond({ error: "Não foi possível concluir agora." }, 409);
    if (result.kind === "unavailable") return respond({ error: "Indisponível no momento." }, 503);
    return respond({ ok: true, url: result.url || "" }, 200);
  } catch (error) {
    console.error("Falha ao registrar a previsão de documentos da apresentação:", error?.message || error);
    return respond({ error: "Indisponível no momento." }, 503);
  }
}
