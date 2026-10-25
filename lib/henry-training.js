import "server-only";
import { randomUUID } from "node:crypto";
import { getSupabaseAdminClient } from "./supabase";
import { isOwnerAdminEmail } from "./admin-auth";
import { ADMIN_ROLE, getAdminProfileById, isActiveAdminProfile, isGeneralAdminProfile } from "./admin-profiles";
import { answerHenry, askHenryTrainingOwner, flushHenryTraining, readHenrySettings, withHenryTraining } from "./henry-voice";
import {
  HENRY_AUTO_TRAINING_LOCK_MS,
  HENRY_AUTO_TRAINING_LOCK_SETTING_ID,
  HENRY_AUTO_TRAINING_SINCE,
  HENRY_TRAINING_FEATURE,
  HENRY_TRAINING_MAX_EXCHANGES,
  HENRY_TRAINING_REPORTS_SETTING_ID,
  HENRY_TRAINING_SCENARIOS,
  appendTrainingScenario,
  buildTrainingOwnerPrompt,
  cleanTrainingOwnerLine,
  decideHenryAutoTraining,
  estimateHenryTrainingCostUsd,
  henryAutoTrainingBudgetUsd,
  henryAutoTrainingCanContinue,
  henryTrainingFits,
  henryTrainingScenario,
  isTrainingRoundId,
  parseTrainingRounds,
  henryTrainingTotalSteps,
  summarizeTrainingRound
} from "./henry-training-core.mjs";
import { henryGreetingRequest } from "./henry-voice-persona.mjs";

// Modo treino do Henry (dono, 2026-10-24 — docs/BUSINESS_RULES.md HENRY-1 "Modo treino", PENDENTE DE VALIDAÇÃO).
// Roda UM cenário do roteiro (henry-training-core.mjs) no MESMO answerHenry, com memória isolada da rodada (sandbox
// devolvido ao navegador e reenviado no próximo cenário). Somente leitura: nada vai para a memória real do dia, música não
// toca, voz do servidor não é chamada (o texto volta; a voz opcional é a do navegador). Custo em ai_usage_log (henry_training).
export async function runHenryTrainingScenario(auth, { scenarioId, roundId = "", sandbox = null, usedExchanges = 0, simulateOwner = true, auto = false } = {}) {
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
    history = await saveHenryTrainingScenario(auth, { roundId: id, scenarioLabel: scenario.label, exchanges, costUsd, simulateOwner, auto });
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

// --- Treino automático (dono, 2026-10-25 — docs/BUSINESS_RULES.md HENRY-1 "Modo treino"; rota /api/cron/henry-treino) -----
// UMA rodada completa (todos os cenários, dono simulado ligado) no servidor, com o contexto do DONO real (perfil de
// isOwnerAdminEmail, o mesmo critério de requireHenryOwner; admin geral, fora de "Alterar conta"). Sandbox encadeado entre
// cenários aqui mesmo. Somente leitura, igual ao treino da tela (withHenryTraining). Travas: teto de gasto e uma por vez.
const AUTO_ROUND_DEADLINE_MS = 250 * 1000; // não começa cenário novo depois disso (maxDuration da rota = 300 s)

async function loadHenryOwnerAuth() {
  const { data, error } = await getSupabaseAdminClient().from("admin_users").select("id, email").limit(500);
  if (error) throw new Error(error.message);
  const owner = (data || []).find((row) => isOwnerAdminEmail(row.email));
  if (!owner) throw Object.assign(new Error("Conta do dono não encontrada."), { status: 409 });
  let profile = await getAdminProfileById(owner.id);
  if (!profile) throw Object.assign(new Error("Conta do dono não encontrada."), { status: 409 });
  if (!isGeneralAdminProfile(profile)) profile = { ...profile, role: ADMIN_ROLE.ADMIN }; // mesmo ajuste de buildAuthorizedAdminResult
  if (!isActiveAdminProfile(profile)) throw Object.assign(new Error("Conta do dono inativa."), { status: 409 });
  return { ok: true, status: 200, user: { id: profile.authUserId || profile.id, email: profile.email }, profile, accountSwitchMode: false };
}

// Gasto do treino (tela + automático) desde HENRY_AUTO_TRAINING_SINCE, em US$ (ai_usage_log, origem henry_training).
export async function sumHenryTrainingSpentUsd() {
  const db = getSupabaseAdminClient();
  const page = 1000;
  let total = 0;
  for (let from = 0; ; from += page) {
    const { data, error } = await db
      .from("ai_usage_log")
      .select("estimated_cost_usd")
      .eq("feature", HENRY_TRAINING_FEATURE)
      .gte("created_at", HENRY_AUTO_TRAINING_SINCE)
      .order("created_at", { ascending: true })
      .range(from, from + page - 1);
    if (error) throw new Error(error.message);
    for (const row of data || []) total += Number(row.estimated_cost_usd) || 0;
    if (!data || data.length < page) return total;
  }
}

// Lê a trava, decide (teto + concorrência) e pega a trava de forma atômica (insert, ou update condicionado ao updated_at
// lido — dois disparos ao mesmo tempo: só um passa).
async function acquireAutoTrainingLock({ roundId, spentUsd, budgetUsd }) {
  const db = getSupabaseAdminClient();
  const { data: row, error } = await db.from("crm_settings").select("setting_value, updated_at").eq("id", HENRY_AUTO_TRAINING_LOCK_SETTING_ID).maybeSingle();
  if (error) throw new Error(error.message);
  const estimateUsd = estimateHenryTrainingCostUsd(Math.min(HENRY_TRAINING_MAX_EXCHANGES, henryTrainingTotalSteps()));
  const decision = decideHenryAutoTraining({ spentUsd, budgetUsd, estimateUsd, lock: row?.setting_value });
  if (!decision.ok) throw Object.assign(new Error(decision.error), { status: decision.status, reason: decision.reason });
  const now = new Date();
  const value = { until: new Date(now.getTime() + HENRY_AUTO_TRAINING_LOCK_MS).toISOString(), roundId, startedAt: now.toISOString() };
  const busy = () => Object.assign(new Error("Já tem um treino automático rodando."), { status: 409, reason: "running" });
  if (!row) {
    const { error: insertError } = await db.from("crm_settings").insert({ id: HENRY_AUTO_TRAINING_LOCK_SETTING_ID, setting_value: value, updated_at: now.toISOString() });
    if (insertError?.code === "23505") throw busy();
    if (insertError) throw new Error(insertError.message);
    return;
  }
  let update = db.from("crm_settings").update({ setting_value: value, updated_at: now.toISOString() }).eq("id", HENRY_AUTO_TRAINING_LOCK_SETTING_ID);
  update = row.updated_at ? update.eq("updated_at", row.updated_at) : update.is("updated_at", null);
  const { data: updated, error: updateError } = await update.select("id");
  if (updateError) throw new Error(updateError.message);
  if (!updated?.length) throw busy();
}

async function releaseAutoTrainingLock(roundId, summary) {
  const { error } = await getSupabaseAdminClient()
    .from("crm_settings")
    .update({ setting_value: { until: null, roundId, finishedAt: new Date().toISOString(), ...summary }, updated_at: new Date().toISOString() })
    .eq("id", HENRY_AUTO_TRAINING_LOCK_SETTING_ID)
    .eq("setting_value->>roundId", roundId);
  if (error) console.warn(`[henry] treino automático: não liberei a trava (vence sozinha em 10 min): ${error.message}.`);
}

// Antes de responder a rota: Henry ligado, conta do dono, teto e trava. Erro com status = recusa (409/…).
export async function prepareHenryAutoTraining() {
  const { enabled } = await readHenrySettings();
  if (!enabled) throw Object.assign(new Error("O Henry está desligado."), { status: 409 });
  const auth = await loadHenryOwnerAuth();
  const budgetUsd = henryAutoTrainingBudgetUsd(process.env.HENRY_AUTO_TRAINING_BUDGET_USD);
  const spentUsd = await sumHenryTrainingSpentUsd();
  const roundId = randomUUID();
  await acquireAutoTrainingLock({ roundId, spentUsd, budgetUsd });
  return { auth, roundId, spentUsd, budgetUsd };
}

// A rodada em si (roda depois da resposta, via after()). Cada cenário é guardado ao terminar (Treinos anteriores, auto).
export async function runHenryAutoTrainingRound({ auth, roundId, spentUsd, budgetUsd }) {
  const started = Date.now();
  let sandbox = {};
  let used = 0;
  let roundUsd = 0;
  let scenarios = 0;
  let stop = "";
  try {
    for (const scenario of HENRY_TRAINING_SCENARIOS) {
      if (Date.now() - started > AUTO_ROUND_DEADLINE_MS) { stop = "tempo"; break; }
      if (!henryTrainingFits(used, scenario.id)) { stop = "teto_trocas"; break; }
      if (!henryAutoTrainingCanContinue({ spentBeforeUsd: spentUsd, roundUsd, nextEstimateUsd: estimateHenryTrainingCostUsd(scenario.steps.length), budgetUsd })) { stop = "teto_gasto"; break; }
      const result = await runHenryTrainingScenario(auth, { scenarioId: scenario.id, roundId, sandbox, usedExchanges: used, simulateOwner: true, auto: true });
      sandbox = result.sandbox;
      used += result.exchanges.length;
      roundUsd += Number(result.costUsd) || 0;
      scenarios += 1;
    }
  } catch (error) {
    stop = "erro";
    console.warn(`[henry] treino automático parou: ${error?.status ? error.message : error?.name || "erro"}.`);
  } finally {
    await releaseAutoTrainingLock(roundId, { scenarios, exchanges: used, costUsd: Math.round(roundUsd * 1e6) / 1e6, ...(stop ? { stop } : {}) });
  }
  console.info(`[henry] treino automático: ${scenarios} cenário(s), ${used} trocas, US$ ${roundUsd.toFixed(4)}${stop ? ` (parou: ${stop})` : ""}.`);
}
