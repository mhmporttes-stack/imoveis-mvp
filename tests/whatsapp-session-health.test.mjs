import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildSessionHealthRows, describeDisconnectCode, isDropEvent, lastDays, saoPauloDay } from "../lib/whatsapp-session-health-core.mjs";
import { filterProfilesForScope, resolveTeamMetaScope } from "../lib/team-meta-scope-core.mjs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
const now = new Date("2026-10-10T15:00:00.000Z").getTime();
const users = [
  { id: "A", name: "Ana Souza", status: "active" },
  { id: "B", name: "Bruna Santos", status: "active" },
  { id: "OFF", name: "Inativa", status: "inactive" }
];
const hoursAgo = (h) => new Date(now - h * 3_600_000).toISOString();

test("7 dias no fuso de São Paulo, do mais antigo ao de hoje", () => {
  const days = lastDays(now);
  assert.equal(days.length, 7);
  assert.equal(days.at(-1), "2026-10-10");
  assert.equal(days[0], "2026-10-04");
  // 02:00 UTC ainda é o dia anterior em São Paulo (UTC-3)
  assert.equal(saoPauloDay(new Date("2026-10-10T02:00:00Z").getTime()), "2026-10-09");
});

test("uma linha por corretor+número, quedas por dia só de 'disconnected' (515 não conta), último erro e fila", () => {
  const sessions = [
    { user_id: "B", slot: 1, status: "connected", last_connected_at: hoursAgo(1), last_disconnect_code: 500, last_disconnect_at: hoursAgo(2), last_error: null },
    { user_id: "B", slot: 2, status: "error", last_connected_at: hoursAgo(5), last_disconnect_code: 500, last_disconnect_at: hoursAgo(3), last_error: "needs_attention:repeated_drops: texto" },
    { user_id: "A", slot: 1, status: "connected", last_connected_at: hoursAgo(30), last_disconnect_code: null, last_error: null }
  ];
  const telemetry = [
    ...[2, 3, 4, 6].map((h) => ({ user_id: "B", session_slot: 2, status_code: 500, reason: "bad_session_or_stream_error", kind: "transient", occurred_at: hoursAgo(h) })),
    { user_id: "B", session_slot: 2, status_code: 515, reason: "restart_required", kind: "restart", occurred_at: hoursAgo(1) },
    { user_id: "B", session_slot: 1, status_code: 408, reason: "timed_out", kind: "transient", occurred_at: hoursAgo(26) }
  ];
  const rows = buildSessionHealthRows({ sessions, telemetry, queueByBroker: { A: 4, B: 10 }, users, now });
  assert.equal(rows.length, 3);
  // Quem precisa de atenção (Número 2 da Bruna: parou de reconectar) vem primeiro
  assert.equal(rows[0].key, "B:2");
  assert.equal(rows[0].needsAttention, true);
  assert.equal(rows[0].dropsTotal, 4, "o 515 (reinício normal) não é queda");
  assert.equal(rows[0].drops24h, 4);
  assert.equal(rows[0].lastErrorCode, 500);
  assert.match(rows[0].lastErrorLabel, /500/);
  assert.match(rows[0].lastErrorReason, /Muitas quedas/);
  assert.equal(rows[0].queuePending, 10);
  assert.equal(rows[0].drops.length, 7);
  const b1 = rows.find((row) => row.key === "B:1");
  assert.equal(b1.dropsTotal, 1);
  assert.equal(b1.drops24h, 0);
  assert.equal(b1.needsAttention, false);
  const ana = rows.find((row) => row.brokerId === "A");
  assert.equal(ana.dropsTotal, 0);
  assert.equal(ana.queuePending, 4);
  assert.equal(ana.lastErrorLabel, "");
});

test("sem a coluna de número (migration pendente) tudo é Número 1; fila indisponível vem nula; inativos ficam fora", () => {
  const rows = buildSessionHealthRows({
    sessions: [{ user_id: "A", status: "disconnected", last_connected_at: null }, { user_id: "OFF", status: "connected" }, { user_id: "GHOST", status: "connected" }],
    telemetry: [{ user_id: "A", status_code: 401, occurred_at: hoursAgo(1) }],
    queueByBroker: {}, users, now
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].slot, 1);
  assert.equal(rows[0].queuePending, null);
  assert.equal(rows[0].dropsTotal, 1);
});

test("três quedas em 24 h marcam atenção mesmo conectado", () => {
  const telemetry = [1, 2, 3].map((h) => ({ user_id: "A", session_slot: 1, status_code: 428, occurred_at: hoursAgo(h) }));
  const [row] = buildSessionHealthRows({ sessions: [{ user_id: "A", slot: 1, status: "connected" }], telemetry, users, now });
  assert.equal(row.needsAttention, true);
});

test("códigos legíveis e reinício 515 não conta", () => {
  assert.match(describeDisconnectCode(440), /Outra conexão/);
  assert.equal(describeDisconnectCode(777), "Código 777");
  assert.equal(describeDisconnectCode(null), "");
  assert.equal(isDropEvent({ status_code: 515 }), false);
  assert.equal(isDropEvent({ status_code: 500 }), true);
});

test("escopo de equipe (T-35): gestora só a equipe sem ela mesma; admin todos; outro perfil negado", () => {
  const profiles = [{ id: "M" }, { id: "A" }, { id: "B" }, { id: "C" }];
  const team = resolveTeamMetaScope({ isManager: true, profileId: "M", managedUserIds: ["M", "A", "B"] });
  assert.deepEqual(filterProfilesForScope(profiles, team).map((p) => p.id), ["A", "B"]);
  assert.equal(filterProfilesForScope(profiles, resolveTeamMetaScope({ isOwner: true })).length, 4);
  assert.equal(resolveTeamMetaScope({ profileId: "A" }).mode, "denied");
});

test("rota e lib: guard de gestão, recorte no backend, somente leitura da fila e da telemetria", () => {
  const route = read("app/api/admin/whatsapp-individual/health/route.js");
  assert.ok(route.includes("requireBrokerManagementApi(request)"));
  assert.ok(route.indexOf("requireBrokerManagementApi") < route.indexOf("getWhatsappSessionHealth"));
  const lib = read("lib/whatsapp-session-health.js");
  assert.ok(lib.includes("resolveTeamMetaScope") && lib.includes("filterProfilesForScope"));
  assert.ok(lib.includes('scope.mode === "denied"'));
  assert.ok(!/\.(insert|update|delete|upsert|rpc)\(/.test(lib), "painel é somente leitura");
  assert.ok(!/phone_number|qr_data|pairing_code/.test(lib), "nunca lê telefone, QR nem código de pareamento");
  assert.ok(read("components/DailyGoalAdmin.jsx").includes("<WhatsappSessionHealthPanel />"));
});
