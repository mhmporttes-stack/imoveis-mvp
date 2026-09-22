import test from "node:test";
import assert from "node:assert/strict";
import { computeOpportunityScore } from "../lib/opportunity-scoring.js";
import { CLIENT_STATUS } from "../lib/client-status.js";

function daysAgoIso(days) {
  return new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString();
}

function baseClient(overrides = {}) {
  return {
    id: "client-1",
    status: CLIENT_STATUS.IN_SERVICE,
    createdAt: daysAgoIso(1),
    lastWhatsappContactAt: daysAgoIso(1),
    lastStatusChangeAt: daysAgoIso(1),
    approvedAt: null,
    scheduledActivityAt: null,
    scheduledActivityCompletedAt: null,
    ...overrides
  };
}

test("determinístico: mesma entrada produz mesma saída", () => {
  const client = baseClient({ status: CLIENT_STATUS.APPROVED, approvedAt: daysAgoIso(10) });
  const signals = { documentationStatus: "complete", recentInboundWhatsappAt: null };
  const a = computeOpportunityScore(client, signals);
  const b = computeOpportunityScore(client, signals);
  assert.deepEqual(a, b);
});

test("cliente parado há muito tempo cai em reativação com prioridade baixa", () => {
  const client = baseClient({ status: CLIENT_STATUS.IN_SERVICE, createdAt: daysAgoIso(60), lastWhatsappContactAt: daysAgoIso(60), lastStatusChangeAt: daysAgoIso(60) });
  const result = computeOpportunityScore(client, { documentationStatus: "not_started" });
  assert.equal(result.category, "reactivation");
  assert.ok(result.priority < 50);
  assert.equal(result.recommendedAction.type, "reactivate");
});

test("aprovado sem reunião: urgência alta, ação recomendada é agendar reunião", () => {
  const comFuturo = baseClient({ status: CLIENT_STATUS.APPROVED, approvedAt: daysAgoIso(2), scheduledActivityAt: new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString() });
  const semFuturo = baseClient({ status: CLIENT_STATUS.APPROVED, approvedAt: daysAgoIso(2) });

  const withMeeting = computeOpportunityScore(comFuturo, { documentationStatus: "complete" });
  const withoutMeeting = computeOpportunityScore(semFuturo, { documentationStatus: "complete" });

  assert.ok(withoutMeeting.urgency > withMeeting.urgency);
  assert.equal(withMeeting.recommendedAction.type, "scheduled");
  assert.match(withMeeting.recommendedAction.label, /às/);
  assert.equal(withoutMeeting.recommendedAction.type, "schedule_meeting");
});

test("documentação: not_started em etapa anterior a 'documentation' não recomenda solicitar documentos", () => {
  const client = baseClient({ status: CLIENT_STATUS.IN_SERVICE });
  const result = computeOpportunityScore(client, { documentationStatus: "not_started" });
  assert.notEqual(result.recommendedAction.type, "request_docs");
});

test("documentação: not_started na etapa 'documentation' recomenda solicitar/iniciar documentação", () => {
  const client = baseClient({ status: CLIENT_STATUS.DOCUMENTATION });
  const result = computeOpportunityScore(client, { documentationStatus: "not_started" });
  assert.equal(result.recommendedAction.type, "request_docs");
  assert.equal(result.recommendedAction.label, "Solicitar/Iniciar documentação");
});

test("documentação: incomplete sempre recomenda solicitar documentação, em qualquer etapa", () => {
  const client = baseClient({ status: CLIENT_STATUS.APPROVAL_PENDING });
  const result = computeOpportunityScore(client, { documentationStatus: "incomplete" });
  assert.equal(result.recommendedAction.type, "request_docs");
  assert.equal(result.recommendedAction.label, "Solicitar documentação");
});

test("documentação: complete + aguardando aprovação recomenda acompanhar análise", () => {
  const client = baseClient({ status: CLIENT_STATUS.APPROVAL_PENDING });
  const result = computeOpportunityScore(client, { documentationStatus: "complete" });
  assert.equal(result.recommendedAction.type, "follow_analysis");
});

test("cliente respondeu recentemente: ação recomendada é retomar atendimento", () => {
  const client = baseClient({ status: CLIENT_STATUS.SIMULATION_SENT });
  const result = computeOpportunityScore(client, { documentationStatus: "not_started", recentInboundWhatsappAt: daysAgoIso(0.5) });
  assert.equal(result.recommendedAction.type, "resume_service");
});

test("reasons nunca ultrapassa 4 itens e nunca fica vazio quando há sinais reais", () => {
  const client = baseClient({ status: CLIENT_STATUS.APPROVED, approvedAt: daysAgoIso(10), lastWhatsappContactAt: daysAgoIso(10) });
  const result = computeOpportunityScore(client, { documentationStatus: "complete", recentInboundWhatsappAt: daysAgoIso(0.5) });
  assert.ok(result.reasons.length > 0);
  assert.ok(result.reasons.length <= 4);
});

test("score, urgência e prioridade sempre dentro de 0-100", () => {
  const cenarios = [
    baseClient({ status: CLIENT_STATUS.APPROVED, approvedAt: daysAgoIso(400), lastWhatsappContactAt: daysAgoIso(400) }),
    baseClient({ status: CLIENT_STATUS.PENDING, createdAt: daysAgoIso(0) })
  ];
  for (const client of cenarios) {
    const result = computeOpportunityScore(client, { documentationStatus: "complete", recentInboundWhatsappAt: daysAgoIso(0) });
    assert.ok(result.score >= 0 && result.score <= 100);
    assert.ok(result.urgency >= 0 && result.urgency <= 100);
    assert.ok(result.priority >= 0 && result.priority <= 100);
  }
});
