import test from "node:test";
import assert from "node:assert/strict";
import {
  ALERT_KIND, INFORMATIVE_TIMING, buildReplyWaitingDelivery, enqueueInformative, normalizeAlertKind,
  renderAlertTemplate, replyWaitingDedupeKey, splitPendingAlerts
} from "../lib/crm-alerts-core.mjs";

const definition = { id: "d1", enabled: true, kind: "important", title: "Cliente aguardando resposta", body_template: "{primeiro_nome}, o cliente {cliente} está aguardando sua resposta há mais de {minutos} minutos." };

test("só dois tipos existem", () => {
  assert.equal(normalizeAlertKind("informative"), "informative");
  assert.equal(normalizeAlertKind("important"), "important");
  assert.equal(normalizeAlertKind("urgente"), null);
});

test("Informativo dura ~5 s no total", () => {
  const total = INFORMATIVE_TIMING.enterMs + INFORMATIVE_TIMING.visibleMs + INFORMATIVE_TIMING.exitMs;
  assert.ok(total >= 4800 && total <= 5200, String(total));
});

test("mensagem do exemplo do dono", () => {
  const delivery = buildReplyWaitingDelivery({ definition, broker: { id: "b1", name: "Eduardo Bueno" }, clientName: "Fulano", minutes: 10, conversationId: "c1", streakStartedAt: "2026-10-02T12:00:00Z" });
  assert.equal(delivery.body, "Eduardo, o cliente Fulano está aguardando sua resposta há mais de 10 minutos.");
  assert.equal(delivery.kind, ALERT_KIND.IMPORTANT);
  assert.equal(delivery.recipient_id, "b1");
  assert.equal(delivery.dedupe_key, replyWaitingDedupeKey("c1", "2026-10-02T12:00:00.000Z"));
});

test("mesmo evento gera a mesma chave (nunca duplica); espera nova gera outra", () => {
  assert.equal(replyWaitingDedupeKey("c1", "2026-10-02T12:00:00Z"), replyWaitingDedupeKey("c1", "2026-10-02T12:00:00.000Z"));
  assert.notEqual(replyWaitingDedupeKey("c1", "2026-10-02T12:00:00Z"), replyWaitingDedupeKey("c1", "2026-10-02T13:00:00Z"));
});

test("definição desligada ou sem corretor não gera alerta", () => {
  assert.equal(buildReplyWaitingDelivery({ definition: { ...definition, enabled: false }, broker: { id: "b1" }, clientName: "X", minutes: 10, conversationId: "c1", streakStartedAt: "2026-10-02T12:00:00Z" }), null);
  assert.equal(buildReplyWaitingDelivery({ definition, broker: null, clientName: "X", minutes: 10, conversationId: "c1", streakStartedAt: "2026-10-02T12:00:00Z" }), null);
});

test("variável vazia não deixa sobra na frase", () => {
  assert.equal(renderAlertTemplate("{primeiro_nome}, olá {x}.", { primeiro_nome: "Ana" }), "Ana, olá.");
});

test("pendentes: Importante até confirmar (mais antigo primeiro); Informativo só uma vez e recente", () => {
  const now = Date.parse("2026-10-02T12:00:00Z");
  const rows = [
    { id: "i2", kind: "important", created_at: "2026-10-02T11:50:00Z" },
    { id: "i1", kind: "important", created_at: "2026-10-02T11:00:00Z", shown_at: "2026-10-02T11:01:00Z" },
    { id: "i0", kind: "important", created_at: "2026-10-02T10:00:00Z", acknowledged_at: "2026-10-02T10:05:00Z" },
    { id: "n1", kind: "informative", created_at: "2026-10-02T11:59:00Z" },
    { id: "n0", kind: "informative", created_at: "2026-10-02T11:59:00Z", shown_at: "2026-10-02T11:59:10Z" },
    { id: "nOld", kind: "informative", created_at: "2026-10-02T10:00:00Z" }
  ];
  const { important, informative } = splitPendingAlerts(rows, now);
  assert.deepEqual(important.map((r) => r.id), ["i1", "i2"]);
  assert.deepEqual(informative.map((r) => r.id), ["n1"]);
});

test("fila do Informativo não repete o que já está na tela ou já foi exibido", () => {
  const queue = enqueueInformative([{ id: "a" }], [{ id: "a" }, { id: "b" }, { id: "c" }], new Set(["c"]));
  assert.deepEqual(queue.map((r) => r.id), ["a", "b"]);
});
