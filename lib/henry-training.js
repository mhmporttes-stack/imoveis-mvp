import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";
import { answerHenry, askHenryTrainingOwner, flushHenryTraining, readHenrySettings, withHenryTraining } from "./henry-voice";
import {
  HENRY_TRAINING_REPORTS_SETTING_ID,
  appendTrainingScenario,
  buildTrainingOwnerPrompt,
  cleanTrainingOwnerLine,
  henryTrainingFits,
  henryTrainingScenario,
  isTrainingRoundId,
  parseTrainingRounds,
  summarizeTrainingRound
} from "./henry-training-core.mjs";
import { henryGreetingRequest } from "./henry-voice-persona.mjs";

// Modo treino do Henry (dono, 2026-10-24 — docs/BUSINESS_RULES.md HENRY-1 "Modo treino", PENDENTE DE VALIDAÇÃO).
// Roda UM cenário do roteiro (henry-training-core.mjs) no MESMO answerHenry, com memória isolada da rodada (sandbox
// devolvido ao navegador e reenviado no próximo cenário). Somente leitura: nada vai para a memória real do dia, música não
// toca, voz do servidor não é chamada (o texto volta; a voz opcional é a do navegador). Custo em ai_usage_log (henry_training).
export async function runHenryTrainingScenario(auth, { scenarioId, roundId = "", sandbox = null, usedExchanges = 0, simulateOwner = true } = {}) {
  const scenario = henryTrainingScenario(scenarioId);
  if (!scenario) throw Object.assign(new Error("Cenário de treino desconhecido."), { status: 400 });
  if (!henryTrainingFits(usedExchanges, scenarioId)) throw Object.assign(new Error("A rodada chegou ao teto de trocas. Comece uma rodada nova."), { status: 409 });
  const { enabled, webSearch, style } = await readHenrySettings();
  if (!enabled) throw Object.assign(new Error("O Henry está desligado. Ligue em Alexa e Henry."), { status: 409 });

  const { result: exchanges, sandbox: nextSandbox, costUsd } = await withHenryTraining(sandbox, async () => {
    const out = [];
    let lastReply = "";
    let morning = null;
    for (const [index, current] of scenario.steps.entries()) {
      let owner = current.say;
      if (simulateOwner && (current.vary || current.reply)) {
        const prompt = buildTrainingOwnerPrompt({ scenarioLabel: scenario.label, step: current, lastReply });
        owner = cleanTrainingOwnerLine(await askHenryTrainingOwner(auth, prompt).catch(() => ""), current.say);
      }
      // "Bom dia" = o mesmo pedido da tela (mode report sem pergunta; tarde/noite viram cumprimento comum).
      const request = current.mode === "report" ? henryGreetingRequest({ mode: "report", question: "", shown: owner }) : { mode: morning?.step === "music" || morning?.step === "style" ? "report" : "question", question: owner };
      const started = Date.now();
      try {
        const answer = await answerHenry(auth, { ...request, style, webSearch, morning });
        lastReply = answer.reply || "";
        morning = answer.morning || null; // conversa do bom dia (música → estilo → relatório → aniversário)
        out.push({
          scenarioId: scenario.id,
          step: index,
          owner,
          reply: lastReply,
          mode: request.mode,
          ms: Date.now() - started,
          tools: answer.timing?.tools === true,
          // Onde foi o tempo (Treino 3): ferramentas que rodaram, rodadas do modelo, ms do modelo e das ferramentas.
          toolNames: Array.isArray(answer.timing?.toolNames) ? answer.timing.toolNames : [],
          rounds: answer.timing?.rounds,
          modelMs: answer.timing?.modelMs,
          toolsMs: answer.timing?.toolsMs,
          ...(answer.navigate?.label ? { navigate: answer.navigate.label } : {}),
          ...(answer.detail?.title ? { detail: answer.detail.title } : {})
        });
      } catch (error) {
        lastReply = "";
        morning = null;
        out.push({ scenarioId: scenario.id, step: index, owner, reply: "", mode: request.mode, ms: Date.now() - started, error: error?.status ? error.message : "falha na IA" });
      }
      await flushHenryTraining(); // a próxima troca vê a memória desta
    }
    return out;
  });
  console.info(`[henry] treino: cenário ${scenario.id} (${exchanges.length} trocas).`);
  // Guarda o cenário na rodada (Treinos anteriores). Falha ao guardar NÃO apaga o resultado já pago: volta visível na tela.
  const id = isTrainingRoundId(roundId) ? roundId : randomUUID();
  let history = null;
  let saveError = "";
  try {
    history = await saveHenryTrainingScenario(auth, { roundId: id, scenarioLabel: scenario.label, exchanges, costUsd, simulateOwner });
  } catch (error) {
    console.warn(`[henry] treino: não guardei o cenário ${scenario.id}: ${error?.message || "erro"}.`);
    saveError = "Não consegui guardar este cenário nos Treinos anteriores.";
  }
  return { scenarioId: scenario.id, roundId: id, exchanges, sandbox: nextSandbox, costUsd, history, ...(saveError ? { saveError } : {}) };
}

// --- Treinos anteriores (crm_settings henry_training_reports; regras puras em henry-training-core.mjs) ----------------
async function readTrainingRounds() {
  const { data, error } = await getSupabaseAdminClient().from("crm_settings").select("setting_value").eq("id", HENRY_TRAINING_REPORTS_SETTING_ID).maybeSingle();
  if (error) throw new Error(error.message);
  return parseTrainingRounds(data?.setting_value);
}

async function saveHenryTrainingScenario(auth, payload) {
  const { rounds } = appendTrainingScenario(await readTrainingRounds(), payload);
  const { error } = await getSupabaseAdminClient()
    .from("crm_settings")
    .upsert({ id: HENRY_TRAINING_REPORTS_SETTING_ID, setting_value: { rounds }, updated_by: auth.profile?.id || null, updated_at: new Date().toISOString() }, { onConflict: "id" });
  if (error) throw new Error(error.message);
  return rounds.map(summarizeTrainingRound);
}

// Lista (resumo, mais nova primeiro) ou uma rodada completa com as trocas.
export async function listHenryTrainingHistory() {
  return (await readTrainingRounds()).map(summarizeTrainingRound);
}

export async function getHenryTrainingRound(roundId) {
  if (!isTrainingRoundId(roundId)) throw Object.assign(new Error("Treino não encontrado."), { status: 404 });
  const round = (await readTrainingRounds()).find((item) => item.id === roundId);
  if (!round) throw Object.assign(new Error("Treino não encontrado."), { status: 404 });
  return round;
}
