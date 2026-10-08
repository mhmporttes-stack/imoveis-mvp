import { NextResponse } from "next/server";
import { getAppointmentIcsByToken } from "@/lib/client-appointments";
import { createRateLimiter, isPresentationToken } from "@/lib/simulation-presentation-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Adicionar à minha agenda" (PRES-22): arquivo .ics do agendamento, só pelo token da apresentação e só para um
// agendamento ativo do MESMO cliente do token. UID estável por agendamento; horários em America/Sao_Paulo.
const allow = createRateLimiter({ limit: 20, windowMs: 60_000 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function error(message, status) {
  return NextResponse.json({ error: message }, { status, headers: { "Cache-Control": "no-store", "X-Robots-Tag": "noindex, nofollow" } });
}

export async function GET(request, { params }) {
  const { token, id } = await params;
  if (!isPresentationToken(token) || !UUID.test(String(id || ""))) return error("Não encontrado.", 404);
  if (!allow(token)) return error("Muitas tentativas. Aguarde um instante e tente de novo.", 429);
  try {
    const result = await getAppointmentIcsByToken(token, id);
    if (result.kind !== "ok") return error("Não encontrado.", 404);
    return new NextResponse(result.ics, {
      status: 200,
      headers: {
        "Content-Type": "text/calendar; charset=utf-8",
        "Content-Disposition": 'attachment; filename="atendimento-matheus-machado.ics"',
        "Cache-Control": "no-store",
        "X-Robots-Tag": "noindex, nofollow",
        "Referrer-Policy": "no-referrer"
      }
    });
  } catch (failure) {
    console.error("Falha ao gerar o .ics do agendamento:", failure?.message || failure);
    return error("Indisponível no momento.", 503);
  }
}
