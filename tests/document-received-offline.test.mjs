// "Recebi documentos por fora" (REGRA OFICIAL do dono, 2026-10-19 — Mesa "Atendimento depois da simulação", lote A item 5).
// Trava: NÃO conta como atendimento nem como ponto (só um evento na linha do tempo), só em "Aguardando documentação" sem lote,
// desfazer por evento de cancelamento, guard de API e escopo do responsável.
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import {
  DOCUMENT_RECEIVED_OFFLINE_EVENT,
  DOCUMENT_RECEIVED_OFFLINE_UNDONE_EVENT,
  OFFLINE_CONFIRM_DESCRIPTION,
  OFFLINE_CONFIRM_TITLE,
  OFFLINE_UNDO_MS,
  canOfferDocumentReceivedOffline,
  canUndoOfflineMark,
  offlineMarkFromEvents,
  offlineMarkLabel
} from "../lib/document-received-offline-core.mjs";
import { ATTENDANCE_JOURNEY_EVENTS, isPersonJourneyEvent } from "../lib/client-attendance-core.mjs";

const ROOT = path.resolve(import.meta.dirname, "..");
const read = (file) => fs.readFileSync(path.join(ROOT, file), "utf8");
const stripComments = (code) => code.replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("não conta como atendimento: os dois eventos ficam fora de ATTENDANCE_JOURNEY_EVENTS", () => {
  for (const eventType of [DOCUMENT_RECEIVED_OFFLINE_EVENT, DOCUMENT_RECEIVED_OFFLINE_UNDONE_EVENT]) {
    assert.ok(!ATTENDANCE_JOURNEY_EVENTS.includes(eventType), eventType);
    assert.equal(isPersonJourneyEvent({ event_type: eventType, actor: "corretor@exemplo.com", actor_role: "broker" }), false, eventType);
  }
});

test("não conta como ponto: a gravação só escreve o evento (sem status, contato, atividade ou histórico de status)", () => {
  const lib = stripComments(read("lib/document-received-offline.js"));
  for (const forbidden of [/last_whatsapp_contact_at/, /calendar_activities/, /client_status_history/, /recordClientStatusChange/, /registerHumanContact/, /\.update\(/, /\.insert\(/]) {
    assert.ok(!forbidden.test(lib), String(forbidden));
  }
  assert.match(lib, /logClientJourneyEvent\(\{[\s\S]*?strict: true/);
  assert.match(lib, /assertCanAccessResponsibleUser\(auth, client\.responsible_user_id \|\| ""\)/);
  const route = stripComments(read("app/api/admin/client-documents/received-offline/route.js"));
  assert.match(route, /const auth = await requireAdminApi\(request\);\s*if \(!auth\.ok\)/);
});

test("só em 'Aguardando documentação' sem lote salvo", () => {
  assert.equal(canOfferDocumentReceivedOffline({ status: "documentation_pending", hasBatch: false }), true);
  assert.equal(canOfferDocumentReceivedOffline({ status: "documentation_pending", hasBatch: true }), false);
  for (const status of ["in_service", "simulation_sent", "approval_pending", "approved", "archived", "do_not_contact"]) {
    assert.equal(canOfferDocumentReceivedOffline({ status, hasBatch: false }), false, status);
  }
});

test("marca vigente = último dos dois eventos; desfazer só logo depois; textos exatos", () => {
  const marked = { event_type: DOCUMENT_RECEIVED_OFFLINE_EVENT, occurred_at: "2026-10-19T12:00:00.000Z" };
  const undone = { event_type: DOCUMENT_RECEIVED_OFFLINE_UNDONE_EVENT, occurred_at: "2026-10-19T12:00:05.000Z" };
  assert.deepEqual(offlineMarkFromEvents([marked]), { receivedAt: marked.occurred_at });
  assert.equal(offlineMarkFromEvents([undone, marked]), null);
  assert.deepEqual(offlineMarkFromEvents([marked, undone, { ...marked, occurred_at: "2026-10-19T13:00:00.000Z" }]), { receivedAt: "2026-10-19T13:00:00.000Z" });
  assert.equal(offlineMarkFromEvents([]), null);
  const at = Date.parse(marked.occurred_at);
  assert.equal(canUndoOfflineMark({ receivedAt: marked.occurred_at }, at + OFFLINE_UNDO_MS), true);
  assert.equal(canUndoOfflineMark({ receivedAt: marked.occurred_at }, at + 5 * 60_000), false);
  assert.equal(canUndoOfflineMark(null), false);
  assert.equal(OFFLINE_UNDO_MS, 10_000);
  assert.equal(OFFLINE_CONFIRM_TITLE, "Marcar que você recebeu o 1º documento fora do CRM?");
  assert.equal(OFFLINE_CONFIRM_DESCRIPTION, "Não conta como atendimento nem como ponto.");
  assert.equal(offlineMarkLabel("x", () => "19/10"), "1º documento recebido por fora · 19/10");
  assert.ok(!/documentos recebidos/i.test(offlineMarkLabel("x")));
});

test("card: ação só com o sinal do servidor, confirmação [Marcar] [Cancelar] e Desfazer por 10 s", () => {
  const card = stripComments(read("components/clients/ClientCard.jsx"));
  assert.match(card, /\{client\.documentsOffline \? <DocumentsOfflineAction/);
  assert.match(card, /confirmLabel: "Marcar", cancelLabel: "Cancelar"/);
  assert.match(card, /setUndoUntil\(Date\.now\(\) \+ OFFLINE_UNDO_MS\)/);
  assert.match(card, /list\.setDocumentReceivedOffline\(client, \{ undo: true \}\)/);
  const query = read("lib/simulation-list-query.js");
  assert.equal((query.match(/applyDocumentsOfflineSignal\(supabase, /g) || []).length, 2);
});
