import { NextResponse } from "next/server";
import { requireHenryOwner } from "@/lib/henry-auth";
import { checkPublicRateLimit } from "@/lib/rate-limit";
import { getHenryTrainingRound, listHenryTrainingHistory, runHenryTrainingScenario } from "@/lib/henry-training";
import {
  HENRY_TRAINING_MAX_EXCHANGES,
  HENRY_TRAINING_SCENARIOS,
  estimateHenryTrainingCostUsd,
  henryTrainingTotalSteps,
  parseTrainingSandbox
} from "@/lib/henry-training-core.mjs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 120; // um cenário = até 5 trocas (dono simulado + Henry com ferramentas de leitura)

// Modo treino do Henry (docs/BUSINESS_RULES.md HENRY-1 "Modo treino", PENDENTE DE VALIDAÇÃO). Só o DONO, na conta real
// (requireHenryOwner). SOMENTE LEITURA: memória do dia isolada da rodada, música simulada, sem voz do servidor.
// GET → roteiro + custo estimado + Treinos anteriores (resumo). GET ?round=<id> → uma rodada guardada, com as trocas.
// POST { scenarioId, roundId, sandbox, usedExchanges, simulateOwner } → as trocas do cenário (guardadas na rodada roundId).
export async function GET(request) {
  const auth = await requireHenryOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const roundId = new URL(request.url).searchParams.get("round");
  if (roundId) {
    try {
      return NextResponse.json({ round: await getHenryTrainingRound(roundId) });
    } catch (error) {
      console.warn(`[henry] treino: falha ao abrir rodada: ${error?.status ? error.message : error?.name || "erro"}.`);
      return NextResponse.json({ error: error?.status ? error.message : "Não consegui abrir este treino." }, { status: error?.status || 502 });
    }
  }
  let history = null;
  let historyError = "";
  try {
    history = await listHenryTrainingHistory();
  } catch (error) {
    console.warn(`[henry] treino: falha ao ler Treinos anteriores: ${error?.message || "erro"}.`);
    historyError = "Não consegui carregar os Treinos anteriores.";
  }
  const total = Math.min(HENRY_TRAINING_MAX_EXCHANGES, henryTrainingTotalSteps());
  return NextResponse.json({
    maxExchanges: HENRY_TRAINING_MAX_EXCHANGES,
    scenarios: HENRY_TRAINING_SCENARIOS.map((scenario) => ({ id: scenario.id, label: scenario.label, steps: scenario.steps.length, sample: scenario.steps.map((step) => step.say) })),
    estimate: { exchanges: total, withOwnerUsd: estimateHenryTrainingCostUsd(total), withoutOwnerUsd: estimateHenryTrainingCostUsd(total, { simulateOwner: false }) },
    history,
    ...(historyError ? { historyError } : {})
  });
}

export async function POST(request) {
  const auth = await requireHenryOwner(request);
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const body = await request.json().catch(() => null);
  const scenarioId = typeof body?.scenarioId === "string" ? body.scenarioId.slice(0, 40) : "";
  const usedExchanges = Number.isInteger(body?.usedExchanges) && body.usedExchanges >= 0 ? body.usedExchanges : 0;
  try {
    if (!(await checkPublicRateLimit(`henry-treino:${auth.profile?.id}`, { windowSeconds: 60, maxAttempts: 12 }))) {
      return NextResponse.json({ error: "Muitos cenários seguidos. Espere um minuto." }, { status: 429 });
    }
    const result = await runHenryTrainingScenario(auth, { scenarioId, roundId: typeof body?.roundId === "string" ? body.roundId.slice(0, 64) : "", sandbox: parseTrainingSandbox(body?.sandbox), usedExchanges, simulateOwner: body?.simulateOwner !== false });
    return NextResponse.json(result);
  } catch (error) {
    console.warn(`[henry] treino falhou: ${error?.status ? error.message : error?.name || "erro"}.`);
    return NextResponse.json({ error: error?.status ? error.message : "Não consegui rodar o treino agora." }, { status: error?.status || 502 });
  }
}
