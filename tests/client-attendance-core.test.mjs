import test from "node:test";
import assert from "node:assert/strict";
import {
  ATTENDANCE_JOURNEY_EVENTS,
  attendanceReferenceAt,
  collectLatest,
  isPersonJourneyEvent,
  isPersonSimulation,
  isPersonStatusChange
} from "../lib/client-attendance-core.mjs";
import { isResponsibleSideConversation, laterContactAt, latestInboundChatAt } from "../lib/chat-contact-signal-core.mjs";
import { isClientAwaitingAction, isStaleContactClient, pendingReferenceAt } from "../lib/client-status.js";
import { isDailyGoalPendingCandidate } from "../lib/daily-goal-progress.mjs";

// Regras do dono (2026-10-16): "o último contato com o cliente deve atualizar conforme o chat" e "se o corretor muda
// o status do cliente de aguardando documentação para aguardando aprovação, automaticamente o cliente recebeu
// atendimento hoje, então zera os 3 dias novamente."
const NOW = Date.parse("2026-10-16T15:00:00Z");
const DAY = 24 * 60 * 60 * 1000;
const iso = (ms) => new Date(ms).toISOString();

test("mudança de status por pessoa conta (qualquer direção); automáticas do sistema não", () => {
  assert.equal(isPersonStatusChange({ changed_by: "bruna@x.com", source: "manual" }), true);
  assert.equal(isPersonStatusChange({ changed_by: "bruna@x.com", source: null }), true);
  assert.equal(isPersonStatusChange({ changed_by: "bruna@x.com", source: "whatsapp_chat" }), true);
  assert.equal(isPersonStatusChange({ changed_by: "sistema", source: "system" }), false);
  assert.equal(isPersonStatusChange({ changed_by: null, source: "manual" }), false);
  assert.equal(isPersonStatusChange({ changed_by: "x@y.com", source: "automatico_por_venda" }), false);
  assert.equal(isPersonStatusChange({ changed_by: "x@y.com", source: "whatsapp_opt_out" }), false);
});

test("linha do tempo: só ações de pessoa da lista (etiqueta, dados, atividade, documentos, CCA, apresentação)", () => {
  for (const type of ["tag_added", "data_updated", "activity_completed", "document_batch_uploaded", "presentation_sent"]) {
    assert.ok(ATTENDANCE_JOURNEY_EVENTS.includes(type), type);
    assert.equal(isPersonJourneyEvent({ event_type: type, actor: "bruna@x.com", actor_role: "broker" }), true, type);
  }
  assert.equal(isPersonJourneyEvent({ event_type: "tag_added", actor: "sistema", actor_role: "automacao" }), false);
  assert.equal(isPersonJourneyEvent({ event_type: "responsible_transferred", actor: "dono@x.com", actor_role: "admin" }), false);
  assert.equal(isPersonJourneyEvent({ event_type: "cooled_reason", actor: "bruna@x.com", actor_role: "broker" }), false);
  assert.equal(isPersonJourneyEvent({ event_type: "appointment_scheduled", actor: "sistema", actor_role: "automacao" }), false);
});

test("simulação: só a criada por pessoa da equipe", () => {
  assert.equal(isPersonSimulation({ created_by: "bruna@x.com" }), true);
  assert.equal(isPersonSimulation({ created_by: "" }), false);
});

test("collectLatest guarda o mais recente por cliente dentro da janela", () => {
  const map = new Map();
  const range = { sinceMs: NOW - 3 * DAY, untilMs: NOW };
  collectLatest(map, "c1", iso(NOW - DAY), range);
  collectLatest(map, "c1", iso(NOW - 2 * DAY), range);
  collectLatest(map, "c1", iso(NOW - 5 * DAY), range);
  collectLatest(map, "c2", iso(NOW + DAY), range);
  assert.equal(map.get("c1"), iso(NOW - DAY));
  assert.equal(map.has("c2"), false);
});

test("Chat: mensagem recebida conta na conversa do lado do responsável (oficial, dele, associado dele)", () => {
  const associates = new Map([["assoc1", "b1"], ["assoc2", "b9"]]);
  assert.equal(isResponsibleSideConversation({ session_user_id: null }, "b1", associates), true);
  assert.equal(isResponsibleSideConversation({ session_user_id: "b1" }, "b1", associates), true);
  assert.equal(isResponsibleSideConversation({ session_user_id: "assoc1" }, "b1", associates), true);
  assert.equal(isResponsibleSideConversation({ session_user_id: "m1" }, "b1", associates), false);
  assert.equal(isResponsibleSideConversation({ session_user_id: "assoc2" }, "b1", associates), false);
  assert.equal(isResponsibleSideConversation({ session_user_id: "b1", deleted_at: "x" }, "b1", associates), false);
  assert.equal(isResponsibleSideConversation({ session_user_id: "b1", private_at: "x" }, "b1", associates), false);
  const conversations = [
    { session_user_id: "b1", last_inbound_at: "2026-10-14T10:00:00Z" },
    { session_user_id: null, last_inbound_at: "2026-10-16T09:00:00Z" },
    { session_user_id: "m1", last_inbound_at: "2026-10-16T12:00:00Z" }
  ];
  assert.equal(latestInboundChatAt(conversations, "b1", associates), "2026-10-16T09:00:00.000Z");
  assert.equal(laterContactAt("2026-10-10T10:00:00.000Z", "2026-10-16T09:00:00Z"), "2026-10-16T09:00:00.000Z");
  assert.equal(laterContactAt("2026-10-16T10:00:00.000Z", "2026-10-15T09:00:00Z"), "2026-10-16T10:00:00.000Z");
});

test("o último atendimento zera os 3 dias de Pendentes, 'Sem contato há +3 dias' e pendentes da Meta Diária", () => {
  const stale = { status: "documentation", lastWhatsappContactAt: iso(NOW - 10 * DAY), createdAt: iso(NOW - 30 * DAY) };
  assert.equal(isClientAwaitingAction(stale, NOW), true);
  assert.equal(isStaleContactClient(stale, NOW), true);
  // Corretor mudou "Aguardando documentação" -> "Aguardando aprovação" há 1 h.
  const attended = { ...stale, status: "approval_pending", lastAttendanceAt: iso(NOW - 60 * 60 * 1000) };
  assert.equal(isClientAwaitingAction(attended, NOW), false);
  assert.equal(isStaleContactClient(attended, NOW), false);
  assert.equal(pendingReferenceAt(attended), NOW - 60 * 60 * 1000);
  assert.equal(attendanceReferenceAt(attended), NOW - 60 * 60 * 1000);
  // Sem novo atendimento por mais 3 dias, volta a contar.
  assert.equal(isClientAwaitingAction(attended, NOW + 3 * DAY), true);
  const md = { status: "approval_pending", lastWhatsappContactAt: iso(NOW - 10 * DAY), createdAt: iso(NOW - 30 * DAY), latestActivityAt: null };
  assert.equal(isDailyGoalPendingCandidate(md, NOW), true);
  assert.equal(isDailyGoalPendingCandidate({ ...md, lastAttendanceAt: iso(NOW - DAY) }, NOW), false);
  // Atendimento mais antigo que o contato não muda nada; sem o campo, igual a antes.
  assert.equal(pendingReferenceAt({ ...stale, lastAttendanceAt: iso(NOW - 20 * DAY) }), NOW - 10 * DAY);
  assert.equal(pendingReferenceAt(stale), NOW - 10 * DAY);
});
