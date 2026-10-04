import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  ATTENTION_COOLDOWN_MS, ATTENTION_LINK, attentionDedupeKey, attentionKeyPrefix, buildAttentionDeliveries, classifySessionAttention,
  describeAttention, inAttentionCooldown, parseAttentionReason, resolveAttentionRecipients
} from "../lib/whatsapp-session-attention-core.mjs";
import { alertLink } from "../lib/crm-alerts-core.mjs";

const users = [
  { id: "G", role: "admin", status: "active" },
  { id: "G2", role: "admin", status: "inactive" },
  { id: "M1", role: "manager", status: "active" },
  { id: "M2", role: "manager", status: "active" },
  { id: "A", name: "Ana Souza", role: "broker", status: "active", manager_id: "M1" },
  { id: "C", name: "Caio Lima", role: "broker", status: "active", manager_id: "M2" },
  { id: "SOLO", name: "Sem Gestora", role: "broker", status: "active", manager_id: null }
];
const definition = {
  id: "def", enabled: true, kind: "important", title: "WhatsApp precisa de atenção",
  body_template: "WhatsApp de {corretor}: {estado} ({horario}). {motivo} {acao}"
};
const T0 = "2026-10-04T12:00:00.000Z";
const NOW = new Date("2026-10-04T15:30:00.000Z").getTime();
const SECRET_SHAPES = [/\d{10,}/, /token/i, /secret/i, /creds/i, /\(40[0-9]\)/, /needs_attention/, /@s\.whatsapp/];

// Simula o servidor (notifyWhatsappSessionAttention) com banco em memória: mesma ordem de decisões.
function makeSim() {
  const session = new Map();
  const deliveries = [];
  let clock = NOW;
  function apply(userId, status, error = "") {
    const prev = session.get(userId) || null;
    session.set(userId, { status, last_connected_at: status === "connected" ? new Date(clock).toISOString() : prev?.last_connected_at || null });
    if (status === "connected") {
      if (prev && prev.status !== "connected") for (const d of deliveries) if (d.dedupe_key.startsWith(attentionKeyPrefix(userId)) && !d.closed) d.closed = true;
      return;
    }
    const classification = classifySessionAttention({ status, error, prev });
    if (!classification) return;
    const recipients = resolveAttentionRecipients(users, userId);
    if (!recipients.length) return;
    const key = attentionDedupeKey(userId, classification.reason, prev, clock);
    const last = deliveries.filter((d) => d.dedupe_key.startsWith(`wa_attn:${userId}:${classification.reason}:`)).sort((a, b) => b.created_at - a.created_at)[0];
    const same = deliveries.some((d) => d.dedupe_key === key);
    if (!same && last && inAttentionCooldown(new Date(last.created_at).toISOString(), clock)) return;
    const rows = buildAttentionDeliveries({ definition, recipientIds: recipients, brokerId: userId, brokerName: users.find((u) => u.id === userId).name, classification, dedupeKey: key, at: clock });
    for (const row of rows) if (!deliveries.some((d) => d.recipient_id === row.recipient_id && d.dedupe_key === row.dedupe_key)) deliveries.push({ ...row, created_at: clock });
  }
  return { apply, deliveries, session, advance: (ms) => { clock += ms; } };
}
const connected = (sim, id) => sim.session.set(id, { status: "connected", last_connected_at: T0 });
const ERR = (reason) => `needs_attention:${reason}: texto do serviço com código 403`;

test("needs_attention (qualquer motivo) gera alerta para a gestora do corretor e para o admin ativo, nunca para o corretor", () => {
  for (const reason of ["forbidden", "connection_replaced", "multidevice_mismatch", "unrecognized_code", "algo_novo"]) {
    const sim = makeSim();
    connected(sim, "A");
    sim.apply("A", "error", ERR(reason));
    assert.deepEqual(sim.deliveries.map((d) => d.recipient_id).sort(), ["G", "M1"], reason);
    for (const d of sim.deliveries) { assert.equal(d.context.state, "needs_attention"); assert.equal(d.context.broker_id, "A"); }
  }
});

test("retry_limit gera alerta com estado próprio", () => {
  const sim = makeSim();
  connected(sim, "A");
  sim.apply("A", "error", ERR("retry_limit"));
  assert.equal(sim.deliveries.length, 2);
  assert.equal(sim.deliveries[0].context.state, "retry_limit");
  assert.match(sim.deliveries[0].body, /reconexão automática esgotada/);
});

test("qr_expired: alerta só se a conta já esteve conectada; QR inicial abandonado não alerta", () => {
  const initial = makeSim();
  initial.apply("A", "qr_required");
  initial.apply("A", "disconnected", "qr_expired");
  assert.equal(initial.deliveries.length, 0, "primeira conexão sem escanear");
  const noRow = makeSim();
  noRow.apply("A", "disconnected", "qr_expired");
  assert.equal(noRow.deliveries.length, 0);

  const used = makeSim();
  connected(used, "A");
  used.apply("A", "qr_required");
  used.apply("A", "disconnected", "qr_expired");
  assert.equal(used.deliveries.length, 2);
  assert.equal(used.deliveries[0].context.state, "qr_expired");
});

test("estados que NÃO alertam aqui: reconnecting, connecting, qr_required, logout (já coberto), error sem selo", () => {
  const sim = makeSim();
  connected(sim, "A");
  for (let i = 0; i < 20; i += 1) { sim.advance(5000); sim.apply("A", "reconnecting", "Connection Closed"); }
  sim.apply("A", "connecting");
  sim.apply("A", "qr_required");
  sim.apply("A", "pairing_code_required");
  sim.apply("A", "disconnected", "logged_out");
  sim.apply("A", "error", "falha qualquer sem o selo");
  assert.equal(sim.deliveries.length, 0);
  assert.equal(classifySessionAttention({ status: "disconnected", error: "", prev: { last_connected_at: T0 } }), null);
  assert.equal(classifySessionAttention({ status: "connected", error: ERR("forbidden"), prev: null }), null, "last_error velho não decide");
});

test("mesma ocorrência repetida (poll/webhook duplicado/corrida) não repete; destinatários não duplicam", () => {
  const sim = makeSim();
  connected(sim, "A");
  for (let i = 0; i < 5; i += 1) sim.apply("A", "error", ERR("forbidden"));
  assert.equal(sim.deliveries.length, 2);
  // tentativa manual de reconectar que falha igual, sem ter conectado: mesma ocorrência
  sim.advance(2 * ATTENTION_COOLDOWN_MS);
  sim.apply("A", "connecting");
  sim.apply("A", "error", ERR("forbidden"));
  assert.equal(sim.deliveries.length, 2);
});

test("novo incidente legítimo alerta de novo: conectou de novo e caiu; ou motivo diferente", () => {
  const sim = makeSim();
  connected(sim, "A");
  sim.apply("A", "error", ERR("forbidden"));
  assert.equal(sim.deliveries.length, 2);
  sim.advance(60_000);
  sim.apply("A", "error", ERR("retry_limit")); // transição diferente
  assert.equal(sim.deliveries.length, 4);
  sim.advance(60_000);
  sim.apply("A", "connected"); // volta
  assert.ok(sim.deliveries.every((d) => d.closed), "voltou a conectar: alertas pendentes encerrados");
  sim.advance(ATTENTION_COOLDOWN_MS + 60_000);
  sim.apply("A", "error", ERR("forbidden")); // nova conexão, novo incidente
  assert.equal(sim.deliveries.length, 6);
  assert.equal(sim.deliveries.filter((d) => !d.closed).length, 2);
});

test("flapping conecta/falha em minutos: cooldown por corretor+motivo evita rajada", () => {
  const sim = makeSim();
  connected(sim, "A");
  sim.apply("A", "error", ERR("forbidden"));
  for (let i = 0; i < 5; i += 1) { sim.advance(30_000); sim.apply("A", "connected"); sim.advance(30_000); sim.apply("A", "error", ERR("forbidden")); }
  assert.equal(sim.deliveries.length, 2);
});

test("chave de ocorrência: mesma conexão = mesma chave; conexão/motivo/corretor diferente = chave diferente", () => {
  const prev = { last_connected_at: T0 };
  assert.equal(attentionDedupeKey("A", "forbidden", prev, NOW), attentionDedupeKey("A", "forbidden", { last_connected_at: new Date(T0) }, NOW + 9999));
  assert.notEqual(attentionDedupeKey("A", "forbidden", prev, NOW), attentionDedupeKey("A", "forbidden", { last_connected_at: "2026-10-04T13:00:00.000Z" }, NOW));
  assert.notEqual(attentionDedupeKey("A", "forbidden", prev, NOW), attentionDedupeKey("A", "retry_limit", prev, NOW));
  assert.notEqual(attentionDedupeKey("A", "forbidden", prev, NOW), attentionDedupeKey("C", "forbidden", prev, NOW));
  assert.match(attentionDedupeKey("A", "forbidden", null, NOW), /nunca:2026-10-04$/);
});

test("destinatários: gestora do corretor + admin ativo; sem gestora cai no admin; outra equipe e admin inativo nunca", () => {
  assert.deepEqual(resolveAttentionRecipients(users, "A").sort(), ["G", "M1"]);
  assert.deepEqual(resolveAttentionRecipients(users, "C").sort(), ["G", "M2"]);
  assert.deepEqual(resolveAttentionRecipients(users, "SOLO"), ["G"]);
  assert.equal(resolveAttentionRecipients(users, "A").includes("M2"), false);
  assert.equal(resolveAttentionRecipients(users, "A").includes("G2"), false);
  assert.equal(resolveAttentionRecipients(users, "A").includes("A"), false);
});

test("conteúdo: nome do corretor, estado, motivo e ação em português simples, horário de Brasília, sem dado sensível", () => {
  for (const reason of ["forbidden", "connection_replaced", "multidevice_mismatch", "unrecognized_code", "retry_limit", "qr_expired"]) {
    const state = reason === "retry_limit" ? "retry_limit" : reason === "qr_expired" ? "qr_expired" : "needs_attention";
    const body = describeAttention({ classification: { state, reason }, brokerName: "Ana Souza", at: NOW });
    assert.match(body, /^WhatsApp de Ana Souza: /);
    assert.match(body, /12\/10|04\/10 às 12:30/, "horário em America/Sao_Paulo (UTC-3)");
    for (const shape of SECRET_SHAPES) assert.doesNotMatch(body, shape, `${reason}: ${shape}`);
    assert.doesNotMatch(body, /\{|\}/);
  }
  assert.match(describeAttention({ classification: { state: "needs_attention", reason: "forbidden" }, brokerName: "Ana", at: NOW }), /Verifique o aparelho/);
  assert.match(describeAttention({ classification: { state: "qr_expired", reason: "qr_expired" }, brokerName: "Ana", at: NOW }), /novo QR Code/);
  assert.match(describeAttention({ classification: { state: "needs_attention", reason: "x" }, brokerName: "", at: NOW }), /um corretor/);
});

test("entrega: tipo da definição, clique para rota real e segura, contexto sem credencial/telefone/mensagem", () => {
  const rows = buildAttentionDeliveries({ definition, recipientIds: ["G", "M1", "G"], brokerId: "A", brokerName: "Ana Souza", classification: { state: "needs_attention", reason: "forbidden" }, dedupeKey: "k", at: NOW });
  assert.equal(rows.length, 2);
  for (const row of rows) {
    assert.equal(row.kind, "important");
    assert.equal(row.context.link, ATTENTION_LINK);
    assert.equal(alertLink(row.context), "/admin/meta-diaria");
    assert.deepEqual(Object.keys(row.context).sort(), ["broker_id", "link", "occurred_at", "reason", "source", "state"]);
    assert.equal(JSON.stringify(row).match(/\d{10,}/), null);
  }
  assert.equal(buildAttentionDeliveries({ definition: { ...definition, enabled: false }, recipientIds: ["G"], brokerId: "A", classification: { state: "needs_attention", reason: "forbidden" }, dedupeKey: "k" }).length, 0);
  assert.equal(buildAttentionDeliveries({ definition: null, recipientIds: ["G"], brokerId: "A", classification: { state: "needs_attention", reason: "forbidden" }, dedupeKey: "k" }).length, 0);
  assert.equal(buildAttentionDeliveries({ definition: { ...definition, kind: "informative" }, recipientIds: ["G"], brokerId: "A", classification: { state: "needs_attention", reason: "forbidden" }, dedupeKey: "k" })[0].kind, "informative");
});

test("alertLink aceita só rota interna do painel", () => {
  assert.equal(alertLink({ link: "/admin/chat" }), "/admin/chat");
  for (const bad of ["https://evil.com", "//evil.com", "/admin//evil", "/administrador", "javascript:alert(1)", "/admin/\\x", "", null, 3]) assert.equal(alertLink({ link: bad }), "", String(bad));
  assert.equal(alertLink(null), "");
});

test("parseAttentionReason extrai o motivo e protege contra formato estranho", () => {
  assert.equal(parseAttentionReason("needs_attention:forbidden: O WhatsApp recusou"), "forbidden");
  assert.equal(parseAttentionReason("needs_attention:retry_limit: Limite de 6"), "retry_limit");
  assert.equal(parseAttentionReason("needs_attention:<script>: x"), "unrecognized_code");
  assert.equal(parseAttentionReason("logged_out"), "");
  assert.equal(parseAttentionReason(null), "");
});

test("integração no código: gatilho único no applyIndividualSessionStatus, falha nunca derruba o status, rota real existe", () => {
  const lib = readFileSync(new URL("../lib/whatsapp-individual.js", import.meta.url), "utf8");
  assert.match(lib, /notifyWhatsappSessionAttention\(userId, prevRow, \{ status, error \}\)/);
  const server = readFileSync(new URL("../lib/whatsapp-session-attention.js", import.meta.url), "utf8");
  assert.match(server, /catch \(err\)[\s\S]*return \{ alerted: false, reason: "erro" \}/);
  assert.match(server, /definicao_ausente/);
  assert.ok(readFileSync(new URL("../app/admin/meta-diaria/page.jsx", import.meta.url), "utf8").length > 0);
  const migration = readFileSync(new URL("../supabase/migrations/20261004120000_whatsapp_session_attention_alert_definition.sql", import.meta.url), "utf8");
  assert.match(migration, /on conflict \(key\) do nothing/);
  assert.match(migration, /'whatsapp_session_attention'/);
});
