import { NextResponse } from "next/server";
import { requireAdminApi } from "@/lib/admin-auth";
import { caixaValuesFromInput, parseVote, simulate, simulatorInput } from "@/lib/caixa-simulator-core.mjs";
import { todayInSaoPaulo } from "@/lib/financiamento-estimativa-core.mjs";
import { CAIXA_FEEDBACK_SCHEMA_MESSAGE, saveCaixaSimulatorFeedback, updateCaixaSimulatorFeedbackValues } from "@/lib/caixa-simulator-feedback";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Voto 👍/👎 do "Simulador Caixa" (dono, 2026-10-19): qualquer perfil do painel. As saídas são RECALCULADAS aqui com o
// mesmo motor (nunca confia no número da tela). Não cria cliente, lead nem envia nada.
export async function POST(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const vote = parseVote(body?.vote);
    if (!vote) return NextResponse.json({ error: "Voto inválido." }, { status: 400 });
    const referenceDate = todayInSaoPaulo();
    const inputs = simulatorInput(body?.answers || {});
    const outputs = simulate(body?.answers || {}, referenceDate);
    const caixaValues = vote === "down" ? caixaValuesFromInput(body?.caixa) : null;
    const result = await saveCaixaSimulatorFeedback({ vote, inputs: { ...inputs, referenceDate }, outputs, caixaValues, version: outputs.version, auth });
    if (!result.schemaReady) return NextResponse.json({ error: CAIXA_FEEDBACK_SCHEMA_MESSAGE }, { status: 503 });
    return NextResponse.json({ ok: true, id: result.id });
  } catch (error) {
    console.error("Simulador Caixa: falha ao gravar o voto:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível gravar o voto." }, { status: 500 });
  }
}

// Valores da Caixa informados depois do 👎 (opcional), no mesmo registro do voto.
export async function PATCH(request) {
  const auth = await requireAdminApi(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  try {
    const body = await request.json().catch(() => ({}));
    const id = typeof body?.id === "string" && /^[0-9a-f-]{36}$/i.test(body.id) ? body.id : null;
    const caixaValues = caixaValuesFromInput(body?.caixa);
    if (!id) return NextResponse.json({ error: "Voto não encontrado." }, { status: 400 });
    if (!caixaValues) return NextResponse.json({ error: "Informe ao menos um valor da Caixa." }, { status: 400 });
    const result = await updateCaixaSimulatorFeedbackValues({ id, caixaValues, auth });
    if (!result.schemaReady) return NextResponse.json({ error: CAIXA_FEEDBACK_SCHEMA_MESSAGE }, { status: 503 });
    if (!result.saved) return NextResponse.json({ error: "Voto não encontrado." }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch (error) {
    console.error("Simulador Caixa: falha ao gravar os valores da Caixa:", error?.message || error);
    return NextResponse.json({ error: "Não foi possível gravar os valores da Caixa." }, { status: 500 });
  }
}
