import { NextResponse } from "next/server";
import { bookAppointmentByToken, getAppointmentAgendaByToken } from "@/lib/client-appointments";
import { parseAppointmentBody } from "@/lib/client-appointments-core.mjs";
import { createRateLimiter, isLikelyBot, isPresentationToken } from "@/lib/simulation-presentation-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Endpoint PÚBLICO do "Agendar atendimento" da apresentação (/s/<token>, PRES-22). Mesmo padrão de
// /api/s/<token>/documentos-previsao: só o token dá acesso; corpo em allowlist; limite de taxa por link; 404 genérico.
//  - GET: agenda dos próximos 10 dias, cada horário só "livre" ou não (a escassez é calculada AQUI, no servidor) + o
//    agendamento futuro do próprio cliente, se houver. Nenhum dado de outro cliente nem da gestora sai daqui.
//  - POST { tipo, data, hora }: reserva. O servidor recalcula a disponibilidade e recusa horário fictício ou ocupado (409).
const HEADERS = { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow", "Referrer-Policy": "no-referrer" };
const allowRead = createRateLimiter({ limit: 30, windowMs: 60_000 });
const allowWrite = createRateLimiter({ limit: 5, windowMs: 60_000 });

function respond(body, status) {
  return NextResponse.json(body, { status, headers: HEADERS });
}

function failure(result) {
  if (result.kind === "not_found") return respond({ error: "Não encontrado." }, 404);
  if (result.kind === "blocked") return respond({ error: "Não foi possível concluir agora." }, 409);
  return respond({ error: "Agendamento indisponível no momento. Fale com seu corretor pelo WhatsApp." }, 503);
}

export async function GET(request, { params }) {
  const { token } = await params;
  if (!isPresentationToken(token)) return respond({ error: "Não encontrado." }, 404);
  if (!allowRead(token)) return respond({ error: "Muitas tentativas. Aguarde um instante e tente de novo." }, 429);
  try {
    const result = await getAppointmentAgendaByToken(token, new Date());
    if (result.kind !== "ok") return failure(result);
    return respond({ dias: result.dias, meet: result.meet, agendado: result.agendado }, 200);
  } catch (error) {
    console.error("Falha ao montar a agenda da apresentação:", error?.message || error);
    return respond({ error: "Agendamento indisponível no momento. Tente de novo em instantes." }, 503);
  }
}

export async function POST(request, { params }) {
  const { token } = await params;
  if (!isPresentationToken(token)) return respond({ error: "Não encontrado." }, 404);

  let body = null;
  try {
    const text = await request.text();
    if (text.length > 200) return respond({ error: "Requisição inválida." }, 400);
    body = JSON.parse(text);
  } catch {
    return respond({ error: "Requisição inválida." }, 400);
  }
  const input = parseAppointmentBody(body, new Date());
  if (!input) return respond({ error: "Escolha o tipo de atendimento, um dia e um horário disponíveis." }, 400);

  if (isLikelyBot(request.headers.get("user-agent") || "")) return respond({ ok: true, url: "" }, 202);
  if (!allowWrite(token)) return respond({ error: "Muitas tentativas. Aguarde um instante e tente de novo." }, 429);

  try {
    const result = await bookAppointmentByToken(token, input, new Date());
    if (result.kind === "taken") return respond({ error: "Esse horário acabou de ficar indisponível. Escolha outro horário." }, 409);
    if (result.kind === "already") return respond({ error: `Você já tem um atendimento agendado para ${result.agendado?.dia || ""}, às ${result.agendado?.hora || ""}. Para mudar, fale com seu corretor.`, agendado: result.agendado }, 409);
    if (result.kind !== "ok") return failure(result);
    return respond({ ok: true, url: result.url || "", agendado: result.agendado }, 200);
  } catch (error) {
    console.error("Falha ao registrar o agendamento da apresentação:", error?.message || error);
    return respond({ error: "Agendamento indisponível no momento. Tente de novo em instantes." }, 503);
  }
}
