import { NextResponse, after } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { registerFirstAccess } from "@/lib/primeiro-acesso";
import { announceFirstAccessBriefing } from "@/lib/alexa-bom-dia";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

// Primeiro acesso do dia do dono (docs/BUSINESS_RULES.md INI-4). Chamado por components/FirstAccessGate.jsx (montado
// só para o dono, fora de "Alterar conta"); a elegibilidade é checada de novo aqui (lib/primeiro-acesso.js). Quando é o
// primeiro do dia, a fala da Alexa sai DEPOIS da resposta (after): nunca atrasa nem impede abrir o CRM.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const result = await registerFirstAccess(auth);
    if (result.firstOfDay) after(() => announceFirstAccessBriefing(auth, result.day));
    return NextResponse.json({ firstOfDay: result.firstOfDay, day: result.day });
  } catch (error) {
    console.error("Primeiro acesso: falha ao registrar:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível registrar o primeiro acesso do dia." }, { status: 500 });
  }
}
