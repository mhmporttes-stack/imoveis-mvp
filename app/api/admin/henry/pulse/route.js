import { NextResponse } from "next/server";
import { isOwnerAdminEmail, requireAdminApi } from "@/lib/admin-auth";
import { isHenryEligible } from "@/lib/henry-voice-core.mjs";
import { readHenrySettings } from "@/lib/henry-voice";
import { readHenryPulse } from "@/lib/henry-pulse";
import { parsePulseSince } from "@/lib/henry-pulse-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// "Pulso do CRM" do Henry (rascunho HENRY-1 "Pulso", [PENDENTE DE VALIDAÇÃO]): GET ?since=<ISO> → eventos reais do CRM
// desde então (máx. 15 min atrás), SOMENTE LEITURA. Só o dono, na conta real, fora de "Alterar conta" — a mesma
// elegibilidade do Henry (isHenryEligible); outros = 403. Henry ou Pulso desligado (o Pulso nasce assim) = lista vazia,
// sem consultar. Payload mínimo: tipo, primeiro nome do corretor (foto/cor), primeiro nome do cliente, trecho ≤ 60
// caracteres (opcional), hora e link. Nunca telefone, CPF ou documento (lib/henry-pulse-core.mjs).
export async function GET(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!isHenryEligible({ ok: auth.ok, accountSwitchMode: auth.accountSwitchMode, isOwner: isOwnerAdminEmail(auth.user?.email) })) {
    return NextResponse.json({ error: "O Pulso do CRM é só do dono, na conta dele (fora de \"Alterar conta\")." }, { status: 403 });
  }
  const now = Date.now();
  const sinceIso = parsePulseSince(new URL(request.url).searchParams.get("since"), now);
  try {
    const { enabled, pulse } = await readHenrySettings();
    if (!enabled || !pulse.enabled) return NextResponse.json({ enabled: false, events: [], now: new Date(now).toISOString() });
    const { events, failed } = await readHenryPulse(auth, { sinceIso, types: pulse.types, snippets: pulse.snippets });
    const sinceMs = Date.parse(sinceIso);
    return NextResponse.json({ enabled: true, events: events.filter((event) => Date.parse(event.at) > sinceMs), failed, now: new Date(now).toISOString() });
  } catch (error) {
    console.error("[henry] pulso: falha ao ler os eventos:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível ler o Pulso do CRM agora." }, { status: 500 });
  }
}
