import { NextResponse } from "next/server";
import { paymentStrategyContactByToken, paymentStrategyPdfByToken } from "@/lib/payment-strategy";
import { parseStrategyChoices } from "@/lib/payment-strategy-core.mjs";
import { createRateLimiter, isLikelyBot, isPresentationToken } from "@/lib/simulation-presentation-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint PÚBLICO da "Estratégia de pagamento" da apresentação /s/<token> (PRES-24). Sem login, mesmo padrão de
// /api/s/<token>/documentos-previsao:
//  - corpo em allowlist estrita: { acao: "pdf" | "contato", escolhas: {...} } (parseStrategyChoices);
//  - limite por link (10 por minuto, em memória; sem IP) e bot óbvio descartado;
//  - token fora do formato/inexistente/revogado → 404 genérico;
//  - "pdf" devolve o arquivo; "contato" devolve o wa.me (só nesta resposta, nunca no DTO). Os dois gravam as escolhas
//    para o corretor ver no CRM (menos cliente "Não contactar");
//  - opção que o cadastro do cliente não permite (13º/FGTS sem CLT, IR sem declarante — PRES-24, 2026-10-18) → 400.
const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const allow = createRateLimiter({ limit: 10, windowMs: 60_000 });
const ACTIONS = ["pdf", "contato"];

function respond(body, status) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function POST(request, { params }) {
  const { token } = await params;
  if (!isPresentationToken(token)) return respond({ error: "Não encontrado." }, 404);

  let body = null;
  try {
    const text = await request.text();
    if (text.length > 1000) return respond({ error: "Requisição inválida." }, 400);
    body = JSON.parse(text);
  } catch {
    return respond({ error: "Requisição inválida." }, 400);
  }
  if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).some((key) => key !== "acao" && key !== "escolhas")) {
    return respond({ error: "Requisição inválida." }, 400);
  }
  const choices = parseStrategyChoices(body.escolhas);
  if (!ACTIONS.includes(body.acao) || !choices) return respond({ error: "Confira os valores informados." }, 400);

  if (isLikelyBot(request.headers.get("user-agent") || "")) return respond({ ok: true, url: "" }, 202);
  if (!allow(token)) return respond({ error: "Muitas tentativas. Aguarde um instante e tente de novo." }, 429);

  try {
    if (body.acao === "pdf") {
      const result = await paymentStrategyPdfByToken(token, choices, new URL(request.url).origin);
      if (result.kind === "not_found" || result.kind === "no_strategy") return respond({ error: "Não encontrado." }, 404);
      if (result.kind === "not_allowed") return respond({ error: "Confira os valores informados." }, 400);
      return new NextResponse(Buffer.from(result.bytes), {
        status: 200,
        headers: { ...HEADERS, "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${result.fileName}"` }
      });
    }
    const result = await paymentStrategyContactByToken(token, choices);
    if (result.kind === "not_found" || result.kind === "no_strategy") return respond({ error: "Não encontrado." }, 404);
    if (result.kind === "not_allowed") return respond({ error: "Confira os valores informados." }, 400);
    if (result.kind === "blocked") return respond({ error: "Não foi possível concluir agora." }, 409);
    return respond({ ok: true, url: result.url || "" }, 200);
  } catch (error) {
    console.error("Falha na estratégia de pagamento da apresentação:", error?.message || error);
    return respond({ error: "Indisponível no momento." }, 503);
  }
}
