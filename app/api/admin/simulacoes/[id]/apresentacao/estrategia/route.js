import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { canManageSimulations, formatSimulationError, getSimulation } from "@/lib/simulations";
import { buildPaymentStrategyPdf } from "@/lib/payment-strategy";
import { parseStrategyChoices } from "@/lib/payment-strategy-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// PDF da "Estratégia de pagamento" (PRES-24) feito pelo CORRETOR na prévia da apresentação no CRM. Mesmo guard e MESMO
// escopo da simulação/PDF (`requireAdminApi` + `getSimulation(id, auth)`). Não grava nada: as escolhas gravadas são as do
// cliente no link (o corretor as vê no painel "Apresentação da simulação").
export async function POST(request, { params }) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (!canManageSimulations()) return NextResponse.json({ error: "Supabase não configurado." }, { status: 503 });

  let payload = null;
  try {
    payload = await request.json();
  } catch {
    return NextResponse.json({ error: "Envie dados válidos." }, { status: 400 });
  }
  const choices = parseStrategyChoices(payload?.escolhas);
  if (!choices) return NextResponse.json({ error: "Confira os valores informados." }, { status: 400 });

  try {
    const simulation = await getSimulation((await params).id, auth);
    if (!simulation) return NextResponse.json({ error: "Simulação não encontrada." }, { status: 404 });
    const result = await buildPaymentStrategyPdf({ simulation, choices, origin: new URL(request.url).origin });
    if (!result) return NextResponse.json({ error: "A simulação precisa de financiamento, taxa de juros e prazo para montar a estratégia." }, { status: 400 });
    if (result.notAllowed) return NextResponse.json({ error: "Opção não disponível para o tipo de renda deste cliente." }, { status: 400 });
    return new NextResponse(Buffer.from(result.bytes), {
      status: 200,
      headers: { "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="${result.fileName}"`, "Cache-Control": "no-store" }
    });
  } catch (error) {
    if (error?.name === "AdminPermissionError") return NextResponse.json({ error: error.message || "Acesso negado." }, { status: 403 });
    console.error("Falha ao gerar o PDF da estratégia de pagamento:", error?.message || error);
    return NextResponse.json({ error: formatSimulationError(error) }, { status: 500 });
  }
}
