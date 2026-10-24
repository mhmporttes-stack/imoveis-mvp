import "server-only";
import { answerHenry, askHenryTrainingOwner, flushHenryTraining, readHenrySettings, withHenryTraining } from "./henry-voice";
import { buildTrainingOwnerPrompt, cleanTrainingOwnerLine, henryTrainingFits, henryTrainingScenario } from "./henry-training-core.mjs";
import { henryGreetingRequest } from "./henry-voice-persona.mjs";

// Modo treino do Henry (dono, 2026-10-24 — docs/BUSINESS_RULES.md HENRY-1 "Modo treino", PENDENTE DE VALIDAÇÃO).
// Roda UM cenário do roteiro (henry-training-core.mjs) no MESMO answerHenry, com memória isolada da rodada (sandbox
// devolvido ao navegador e reenviado no próximo cenário). Somente leitura: nada vai para a memória real do dia, música não
// toca, voz do servidor não é chamada (o texto volta; a voz opcional é a do navegador). Custo em ai_usage_log (henry_training).
export async function runHenryTrainingScenario(auth, { scenarioId, sandbox = null, usedExchanges = 0, simulateOwner = true } = {}) {
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
  return { scenarioId: scenario.id, exchanges, sandbox: nextSandbox, costUsd };
}
