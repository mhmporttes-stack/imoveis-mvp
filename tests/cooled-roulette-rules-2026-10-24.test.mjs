// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] Roleta e clientes frios (ex-"esfriados"): uma volta só, nome "cliente
// frio", origem marcada fora das travas ROL-4c/redistribuição, etiqueta RESTRIÇÃO fora do fluxo, desconectado nunca
// recebe, simulação automática = simulação realizada no prazo, quem mandou mensagem fica com o cliente e decisão da
// gestora sem a trava PRO-9.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  REACTIVATION_MAX_ROUNDS,
  REACTIVATION_REQUEUE_TRIGGER,
  REACTIVATION_RETURN_TRIGGER,
  offeredCaseOutcome,
  reactivationNoticeState,
  requeueTriggerMinutes,
  requeuedFromScopeMessage
} from "../lib/cooled-clients-reactivation-core.mjs";
import { COOLED_REACTIVATION_DISTRIBUTION, isRouletteDistributionType } from "../lib/client-distribution-core.mjs";
import { CASE_STATUS, COOLED_RESTRICTION_CANCEL_REASON, autoCancelReason, buildReasonAlertDelivery, isCooledCandidate } from "../lib/cooled-clients-core.mjs";
import { canReturnToRoulette, PRE_SIMULATION_STATUSES } from "../lib/simulation-deadline-core.mjs";
import { isSimulationFirstDone, requiresSimulationFirst } from "../lib/simulation-first-core.mjs";
import { motivoBloqueioParticular } from "../lib/whatsapp-private-eligibility-core.mjs";
import { pickProtectedClientIds } from "../lib/whatsapp-attendance-core.mjs";
import { COOLED_DECISION_STATUS_SOURCE, isStatusAdvance } from "../lib/prospecting-status-lock-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const T0 = Date.parse("2026-10-24T13:00:00.000Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

test("1) uma volta só: sem mensagem no prazo o cliente frio vai ao dono, fora da fila, sem apagar histórico", () => {
  assert.equal(REACTIVATION_MAX_ROUNDS, 1);
  const base = { offeredTo: "gab", offeredAt: iso(T0), clientResponsibleId: "gab", rounds: 1, now: T0 + 6 * 60 * 1000 };
  assert.equal(offeredCaseOutcome(base), "return_to_owner");
  assert.equal(offeredCaseOutcome({ ...base, contacted: true }), "kept");
  const runner = read("lib/cooled-clients-reactivation.js");
  assert.match(runner, /rounds: row\.reactivation_rounds/);
  assert.match(runner, /outcome === "return_to_owner"[\s\S]{0,400}returnCooledClientToOwner\(row\.client_id, \{ expectedResponsibleId: row\.reactivation_offered_to, caseId: row\.id, trigger: REACTIVATION_RETURN_TRIGGER/);
  const distribution = read("lib/lead-distribution.js");
  // Destino da FUN-11: dono, sem pending_distribution_at (fora da fila de espera e da fila de reativação).
  assert.match(distribution, /export async function returnCooledClientToOwner[\s\S]{0,600}parkWithOwner: true/);
  assert.match(distribution, /const waiting = !roulette\.brokerId && !parkWithOwner;/);
  assert.doesNotMatch(runner + distribution, /\.delete\(\)/);
  // Aviso e clique do WhatsApp dizem "foi devolvido".
  assert.equal(requeueTriggerMinutes(REACTIVATION_RETURN_TRIGGER), 5);
  const returned = reactivationNoticeState({ noticeAt: iso(T0), stillResponsible: false, requeues: [{ at: iso(T0 + 6 * 60 * 1000), trigger: REACTIVATION_RETURN_TRIGGER }], now: T0 + 7 * 60 * 1000 });
  assert.equal(returned.state, "requeued");
  assert.equal(returned.returned, true);
  assert.equal(reactivationNoticeState({ noticeAt: iso(T0), stillResponsible: true, now: T0 + 6 * 60 * 1000 }).returned, true);
  const row = { event_type: "auto_transferred", from_user_id: "gab", details: { trigger: REACTIVATION_RETURN_TRIGGER } };
  assert.equal(requeuedFromScopeMessage(row, ["gab"]), "Este cliente foi devolvido porque nenhuma mensagem foi enviada em 5 minutos.");
  assert.match(requeuedFromScopeMessage({ ...row, details: { trigger: REACTIVATION_REQUEUE_TRIGGER } }, ["gab"]), /voltou para a fila/);
  assert.match(read("components/cooled/ReactivationNoticeStatus.jsx"), /o cliente foi devolvido/);
});

test("2) nome visível 'cliente frio' (nomes internos ficam)", () => {
  const alert = buildReasonAlertDelivery({ caseRow: { id: "k1", client_id: "c1", broker_id: "b1" }, clientName: "Ana" });
  assert.equal(alert.title, "Cliente frio: Ana");
  for (const path of ["components/cooled/CooledFlowToggle.jsx", "lib/painel-inicio-dono-core.mjs", "lib/henry-reports-core.mjs", "lib/henry-voice-narration.mjs", "lib/cooled-clients-reactivation.js", "lib/lead-distribution.js"]) {
    const visible = read(path).split("\n").filter((line) => !/^\s*(\/\/|\*)/.test(line)).join("\n");
    // Texto entre aspas; rotas (/esfriados) e chaves internas (clientes_esfriados_*) não são texto de tela.
    assert.doesNotMatch(visible, /["'`][^"'`\n]*(?:clientes? (?:esfriad|que esfri)|esfriou:)/i, path);
  }
  assert.match(read("lib/henry-voice-core.mjs"), /clientes_esfriados: \{ path: "\/admin\/desempenho\/esfriados", label: "Clientes frios" \}/);
});

test("3) origem marcada: cliente frio fora da trava 'simulação primeiro' e da REDISTRIBUIÇÃO de 10 min", () => {
  const client = { distribution_type: COOLED_REACTIVATION_DISTRIBUTION, primary_monthly_income: 3000, status: "pending", responsible_changed_at: iso(T0) };
  assert.equal(requiresSimulationFirst(client), false);
  assert.equal(requiresSimulationFirst({ ...client, distribution_type: "round_robin" }), true);
  assert.equal(canReturnToRoulette(client), false);
  assert.equal(isRouletteDistributionType(COOLED_REACTIVATION_DISTRIBUTION), true);
  assert.equal(isRouletteDistributionType("round_robin"), true);
  assert.equal(isRouletteDistributionType(""), false);
  // Particular (WA-19b) e pontuação de cliente novo tratam como distribuição, como antes.
  assert.equal(motivoBloqueioParticular({ conversation: { session_key: "11111111-1111-1111-1111-111111111111" }, client: { acquisition_context: null, distribution_type: COOLED_REACTIVATION_DISTRIBUTION } }), "roulette");
  assert.match(read("lib/performance-overview.js"), /!isRouletteDistributionType\(registration\.distribution_type\)/);
  assert.match(read("lib/lead-distribution.js"), /distribution_type: queueOnly \? COOLED_REACTIVATION_DISTRIBUTION : "round_robin"/);
  assert.match(read("lib/cooled-clients-reactivation.js"), /pending_distribution_at: null, distribution_type: COOLED_REACTIVATION_DISTRIBUTION/);
});

test("4) etiqueta RESTRIÇÃO tira o cliente do fluxo do cliente frio", () => {
  const responsible = { id: "b1", role: "broker", status: "active" };
  const client = (extra = {}) => ({ id: "c1", status: "in_service", responsibleUserId: "b1", lastWhatsappContactAt: iso(T0 - 5 * DAY), lastStatusChangeAt: iso(T0 - 6 * DAY), createdAt: iso(T0 - 10 * DAY), ...extra });
  assert.equal(isCooledCandidate({ client: client(), responsible, now: T0 }), true);
  assert.equal(isCooledCandidate({ client: client({ hasRestrictionTag: true }), responsible, now: T0 }), false);
  for (const status of [CASE_STATUS.AWAITING_REASON, CASE_STATUS.AWAITING_DECISION]) {
    assert.equal(autoCancelReason({ row: { id: "k1", client_id: "c1", broker_id: "b1", status }, client: client({ hasRestrictionTag: true }) }), COOLED_RESTRICTION_CANCEL_REASON);
  }
  const runner = read("lib/cooled-clients-reactivation.js");
  assert.match(runner, /eligible: !restrictionTagged\.has\(row\.id\) && isRouletteEligibleClient/);
  assert.match(runner, /\.eq\("normalized_name", COOLED_RESTRICTION_TAG_KEY\)/);
  const flow = read("lib/cooled-clients.js");
  assert.match(flow, /hasRestrictionTag: restrictionTagged\.has\(row\.id\)/);
  assert.match(flow, /hasRestrictionTag: restrictionTagged\.has\(client\.id\)/);
});

test("5) desconectado nunca recebe: janela fechada e fila de reativação só com quem está on-line", () => {
  const server = read("lib/simulation-auto-send.js");
  const picker = server.split("async function pickClosedWindowBroker()")[1].split("\n}\n")[0];
  assert.match(picker, /assignRoundRobinLead\(\)/);
  assert.match(picker, /return null;/);
  assert.doesNotMatch(picker, /whatsapp_individual_sessions|claimRouletteReceipt/);
  assert.match(read("lib/cooled-clients-reactivation.js"), /filterRouletteCooldownFreeIds\(await listOnlineRouletteBrokerIds\(\)\)/);
});

test("6) simulação automática = simulação realizada no prazo/redistribuição; nome próprio na tela", () => {
  assert.ok(!PRE_SIMULATION_STATUSES.includes("auto_simulation"));
  assert.equal(isSimulationFirstDone("auto_simulation"), true);
  assert.match(read("lib/client-status.js"), /label: "Simulação automática"/);
});

test("7) quem já mandou mensagem ao cliente fica com ele (também com dados da simulação)", () => {
  const client = { distribution_type: "round_robin", primary_monthly_income: 2500, responsible_changed_at: iso(T0) };
  assert.equal(canReturnToRoulette(client), true);
  assert.equal(canReturnToRoulette(client, { humanMessaged: true }), false);
  // Só mensagem conta (Assumir atendimento sozinho, não), e só desde o recebimento.
  const clients = [{ id: "c1", responsible_changed_at: iso(T0) }];
  assert.equal(pickProtectedClientIds([{ client_id: "c1", assumed_at: iso(T0 + 1000) }], clients, { messagesOnly: true }).size, 0);
  assert.equal(pickProtectedClientIds([{ client_id: "c1", last_human_reply_at: iso(T0 + 1000) }], clients, { messagesOnly: true }).size, 1);
  assert.equal(pickProtectedClientIds([{ client_id: "c1", last_human_reply_at: iso(T0 - 1000) }], clients, { messagesOnly: true }).size, 0);
  assert.match(read("lib/crm-automations.js"), /listClientIdsWithHumanAttendance\(rouletteCandidates\.filter\(hasSimulationData\), \{ messagesOnly: true \}\)/);
});

test("8) decisão do caso de cliente frio não esbarra na trava PRO-9 (só Restrição/Reprovado/Comprometimento)", () => {
  const base = { currentStatus: "awaiting_return" };
  for (const nextStatus of ["restriction", "rejected", "income_commitment"]) {
    assert.equal(isStatusAdvance({ ...base, nextStatus }), true, nextStatus);
    assert.equal(isStatusAdvance({ ...base, nextStatus, statusSource: COOLED_DECISION_STATUS_SOURCE }), false, nextStatus);
  }
  assert.equal(isStatusAdvance({ ...base, nextStatus: "in_service", statusSource: COOLED_DECISION_STATUS_SOURCE }), true);
  assert.match(read("lib/simulation-registrations.js"), /assertProspectingStatusChangeAllowed\(\{[^}]*statusSource: updates\.statusSource \|\| "" \}\)/);
  assert.match(read("lib/cooled-clients.js"), /statusSource: "cooled_client_decision"/);
  // O corpo da requisição nunca escolhe a origem (senão qualquer um pularia a trava).
  assert.match(read("app/api/simulation-registrations/[id]/route.js"), /const \{ statusSource: _ignoredStatusSource, \.\.\.body \}/);
});
