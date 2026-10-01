import { NextResponse } from "next/server";
import { registerArrival, verifyArrivalToken } from "@/lib/alexa-arrival";
import { buildRateLimitKey, checkPublicRateLimit } from "@/lib/rate-limit";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Entrada da rotina "Chegada ao escritório": o Atalho do iPhone faz POST aqui
// quando conecta no Wi-Fi do escritório, com `Authorization: Bearer <chave>`.
// Resposta mínima de propósito (não revela configuração). Só leitura do CRM:
// o único efeito é agendar o resumo falado.
export async function POST(request) {
  const allowed = await checkPublicRateLimit(buildRateLimitKey(request, "alexa-arrival"), { windowSeconds: 60, maxAttempts: 12 });
  if (!allowed) return NextResponse.json({ error: "Muitas tentativas." }, { status: 429 });

  const header = request.headers.get("authorization") || "";
  const token = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
  if (!token || !(await verifyArrivalToken(token))) {
    return NextResponse.json({ error: "Não autorizado." }, { status: 401 });
  }

  try {
    const result = await registerArrival();
    return NextResponse.json({ ok: true, accepted: result.accepted, reason: result.reason || null });
  } catch {
    return NextResponse.json({ error: "Não foi possível registrar a chegada." }, { status: 500 });
  }
}
