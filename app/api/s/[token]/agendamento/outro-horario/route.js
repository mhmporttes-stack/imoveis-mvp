import { NextResponse } from "next/server";
import { requestAppointmentByToken } from "@/lib/client-appointments";
import { parseAppointmentRequestBody } from "@/lib/client-appointments-core.mjs";
import { createRateLimiter, isLikelyBot, isPresentationToken } from "@/lib/simulation-presentation-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint PÚBLICO "Nenhum horário serve? Combinar outro horário" (PRES-22): { tipo, data, texto }. NÃO reserva horário:
// registra o pedido no CRM (linha do tempo + aviso ao corretor e à gestora) e devolve o WhatsApp do corretor com a
// mensagem pronta. Mesmas proteções de /api/s/<token>/agendamento.
const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const allow = createRateLimiter({ limit: 3, windowMs: 60_000 });

function respond(body, status) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

export async function POST(request, { params }) {
  const { token } = await params;
  if (!isPresentationToken(token)) return respond({ error: "Não encontrado." }, 404);

  let body = null;
  try {
    const text = await request.text();
    if (text.length > 600) return respond({ error: "Requisição inválida." }, 400);
    body = JSON.parse(text);
  } catch {
    return respond({ error: "Requisição inválida." }, 400);
  }
  const input = parseAppointmentRequestBody(body, new Date());
  if (!input) return respond({ error: "Escolha um dia e escreva o horário que prefere." }, 400);

  if (isLikelyBot(request.headers.get("user-agent") || "")) return respond({ ok: true, url: "" }, 202);
  if (!allow(token)) return respond({ error: "Muitas tentativas. Aguarde um instante e tente de novo." }, 429);

  try {
    const result = await requestAppointmentByToken(token, input);
    if (result.kind === "not_found") return respond({ error: "Não encontrado." }, 404);
    if (result.kind === "blocked") return respond({ error: "Não foi possível concluir agora." }, 409);
    if (result.kind !== "ok") return respond({ error: "Indisponível no momento. Fale com seu corretor pelo WhatsApp." }, 503);
    return respond({ ok: true, url: result.url || "" }, 200);
  } catch (error) {
    console.error("Falha ao registrar o pedido de outro horário:", error?.message || error);
    return respond({ error: "Indisponível no momento. Tente de novo em instantes." }, 503);
  }
}
