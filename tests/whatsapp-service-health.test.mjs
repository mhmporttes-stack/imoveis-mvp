import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CACHE_DOWN_MS, CACHE_UP_MS, HEALTH_TIMEOUT_MS, LEASE_DOWN_MS, buildEpisodeNotice, countNetworkSendFailures, evaluateServiceHealth,
  isHealthResponseOk, shouldPersistHealth, toPersistedHealth
} from "../lib/whatsapp-service-health-core.mjs";
import { decideCardWhatsapp, isConnectedChatFirst } from "../lib/client-card-whatsapp-core.mjs";

// WA-13d (dono, 2026-11-02): serviço do WhatsApp fora do ar -> botão abre app/WhatsApp Web; voltou -> Chat.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const NOW = Date.parse("2026-11-02T15:00:00Z");
const iso = (offsetMs) => new Date(NOW + offsetMs).toISOString();
const freshLease = { heartbeat_at: iso(-10_000) };
const run = (input) => evaluateServiceHealth({ now: NOW, lease: freshLease, ...input });

test("saudável: lease fresco e /health ok", () => {
  const result = run({ ping: true });
  assert.equal(result.down, false);
  assert.equal(result.transition, null);
});

test("lease sem renovar há mais de 3 min = fora do ar, desde o último sinal", () => {
  const result = run({ lease: { heartbeat_at: iso(-(LEASE_DOWN_MS + 60_000)) }, ping: null });
  assert.equal(result.down, true);
  assert.deepEqual(result.reasons, ["lease"]);
  assert.equal(result.transition.type, "down");
  assert.equal(result.transition.since, iso(-(LEASE_DOWN_MS + 60_000)));
});

test("lease com atraso curto (1 min) não derruba ninguém", () => {
  assert.equal(run({ lease: { heartbeat_at: iso(-60_000) }, ping: null }).down, false);
});

test("sem lease (tabela vazia/ausente) o lease não conta", () => {
  assert.equal(evaluateServiceHealth({ now: NOW, lease: null, ping: null }).down, false);
});

test("/health falha 1 vez = ainda no ar; 2 seguidas (leituras espaçadas) = fora do ar", () => {
  const first = run({ ping: false });
  assert.equal(first.down, false);
  assert.equal(first.healthFails, 1);
  const second = evaluateServiceHealth({ now: NOW + 60_000, lease: { heartbeat_at: iso(50_000) }, ping: false, prev: toPersistedHealth(first) });
  assert.equal(second.down, true);
  assert.deepEqual(second.reasons, ["health"]);
  assert.equal(second.transition.type, "down");
});

test("duas leituras quase simultâneas do /health valem uma só (instâncias diferentes)", () => {
  const first = run({ ping: false });
  const second = evaluateServiceHealth({ now: NOW + 3_000, lease: freshLease, ping: false, prev: toPersistedHealth(first) });
  assert.equal(second.healthFails, 1);
  assert.equal(second.down, false);
});

test("um /health ok no meio zera a contagem (corte curto não derruba)", () => {
  const first = run({ ping: false });
  const ok = evaluateServiceHealth({ now: NOW + 60_000, lease: freshLease, ping: true, prev: toPersistedHealth(first) });
  assert.equal(ok.healthFails, 0);
  const again = evaluateServiceHealth({ now: NOW + 120_000, lease: freshLease, ping: false, prev: toPersistedHealth(ok) });
  assert.equal(again.down, false);
});

test("falhas de envio por rede: 2 nos últimos 10 min derrubam; 1 só ou erro do destinatário não", () => {
  const rows = [
    { failed_at: iso(-60_000), error_message: "fetch failed" },
    { failed_at: iso(-120_000), error_message: "Falha ao comunicar com o serviço de WhatsApp individual (status 502)." },
    { failed_at: iso(-30_000), error_message: "Número sem WhatsApp" },
    { failed_at: iso(-11 * 60_000), error_message: "fetch failed" }
  ];
  assert.equal(countNetworkSendFailures(rows, { now: NOW }), 2);
  assert.equal(run({ ping: null, failureRows: rows }).down, true);
  assert.equal(run({ ping: null, failureRows: rows.slice(0, 1) }).down, false);
  assert.equal(run({ ping: null, failureRows: [rows[2]] }).down, false);
});

test("/health ok mais novo desmente falha de envio antiga", () => {
  const rows = [{ failed_at: iso(-60_000), error_message: "fetch failed" }, { failed_at: iso(-90_000), error_message: "ECONNREFUSED" }];
  assert.equal(run({ ping: true, failureRows: rows }).down, false);
});

test("histerese: depois de fora do ar só volta com /health ok E lease fresco", () => {
  const down = toPersistedHealth(run({ lease: { heartbeat_at: iso(-600_000) }, ping: null }));
  assert.equal(down.status, "down");
  // /health ok, mas lease ainda velho: continua fora do ar (sem oscilar)
  const stillDown = evaluateServiceHealth({ now: NOW, lease: { heartbeat_at: iso(-600_000) }, ping: true, prev: down });
  assert.equal(stillDown.down, true);
  assert.equal(stillDown.transition, null);
  assert.equal(stillDown.since, down.since);
  // /health falhando de novo: continua
  assert.equal(evaluateServiceHealth({ now: NOW, lease: freshLease, ping: false, prev: down }).down, true);
  // /health ok + lease fresco: voltou
  const back = evaluateServiceHealth({ now: NOW, lease: freshLease, ping: true, prev: down });
  assert.equal(back.down, false);
  assert.equal(back.transition.type, "up");
  assert.equal(back.transition.since, down.since);
});

test("fora do ar sem /health configurado: volta quando nenhum sinal resta", () => {
  const down = toPersistedHealth(run({ lease: { heartbeat_at: iso(-600_000) }, ping: null }));
  assert.equal(evaluateServiceHealth({ now: NOW, lease: freshLease, ping: null, prev: down }).down, false);
  assert.equal(evaluateServiceHealth({ now: NOW, lease: { heartbeat_at: iso(-600_000) }, ping: null, prev: down }).down, true);
});

test("só grava o estado quando muda de verdade", () => {
  const up = run({ ping: true });
  assert.equal(shouldPersistHealth(null, up), false);
  assert.equal(shouldPersistHealth(toPersistedHealth(up), up), false);
  const failing = run({ ping: false });
  assert.equal(shouldPersistHealth(toPersistedHealth(up), failing), true);
});

test("resposta do /health: ok e dono do lease", () => {
  assert.equal(isHealthResponseOk({ ok: true, lease: "held", serving: true }), true);
  assert.equal(isHealthResponseOk({ ok: true, lease: "waiting", serving: false }), false);
  assert.equal(isHealthResponseOk({ ok: true, lease: "shutting_down", serving: false }), false);
  assert.equal(isHealthResponseOk(null), false);
  assert.ok(HEALTH_TIMEOUT_MS <= 3000 && CACHE_DOWN_MS < CACHE_UP_MS && CACHE_UP_MS <= 60_000);
});

test("aviso ao dono: um por episódio, informativo; queda por lease divide a chave com o alerta de serviço parado", () => {
  const since = "2026-11-02T14:41:00.000Z";
  const down = buildEpisodeNotice({ type: "down", since, at: iso(0) });
  assert.match(down.body, /fora do ar desde 11:41/);
  assert.equal(down.dedupeKey, `wa_svc_unreachable:ep:${since}`);
  assert.equal(buildEpisodeNotice({ type: "down", since, at: iso(0) }).dedupeKey, down.dedupeKey);
  assert.equal(buildEpisodeNotice({ type: "down", since, at: iso(0) }, { leaseEpisodeKey: `wa_svc_stalled:${since}` }).dedupeKey, `wa_svc_stalled:${since}`);
  const back = buildEpisodeNotice({ type: "up", since, at: "2026-11-02T18:05:00.000Z" });
  assert.match(back.title, /voltou/);
  assert.match(back.body, /15:05/);
  assert.notEqual(back.dedupeKey, down.dedupeKey);
  assert.equal(buildEpisodeNotice({ type: "down", since: null }), null);
});

test("card: serviço fora do ar abre o wa.me para quem tem sessão marcada ativa (todos os perfis)", () => {
  const base = { stateKnown: true, sessionStatus: "connected", isOwnClient: true, phone: "14999998888", serviceDown: true };
  const mobile = decideCardWhatsapp({ ...base, device: "mobile" });
  assert.equal(mobile.action, "external");
  assert.equal(mobile.reason, "service_down");
  assert.equal(mobile.url, "https://wa.me/5514999998888");
  assert.match(decideCardWhatsapp({ ...base, device: "desktop" }).url, /^https:\/\/web\.whatsapp\.com\/send\?phone=5514999998888$/);
  assert.equal(decideCardWhatsapp({ ...base, sessionStatus: "reconnecting" }).action, "external");
  // voltou: volta ao Chat
  assert.equal(decideCardWhatsapp({ ...base, serviceDown: false }).action, "chat");
});

test("card: travas e exceções continuam valendo com o serviço fora do ar", () => {
  const base = { stateKnown: true, sessionStatus: "connected", isOwnClient: true, phone: "14999998888", serviceDown: true };
  assert.equal(decideCardWhatsapp({ ...base, clientStatus: "do_not_contact" }).action, "chat");
  assert.equal(decideCardWhatsapp({ ...base, clientStatus: "archived" }).action, "chat");
  assert.equal(decideCardWhatsapp({ ...base, stateKnown: false }).action, "chat");
  assert.equal(decideCardWhatsapp({ ...base, isOwnClient: false }).action, "chat");
  assert.equal(decideCardWhatsapp({ ...base, phone: "abc" }).action, "chat");
  // sem sessão pessoal o Chat atende pelo número oficial (não depende do serviço)
  assert.equal(decideCardWhatsapp({ ...base, sessionStatus: "disconnected" }).action, "chat");
  // Chat desligado e modo lista impressa mantêm o motivo próprio
  assert.equal(decideCardWhatsapp({ ...base, chatDisabled: true }).reason, "chat_disabled");
  assert.equal(decideCardWhatsapp({ ...base, printedListMode: true }).reason, "printed_list_mode");
});

test("isConnectedChatFirst: serviceDown força o caminho wa.me", () => {
  assert.equal(isConnectedChatFirst({ role: "broker", sessionStatus: "connected", serviceDown: true }), false);
  assert.equal(isConnectedChatFirst({ role: "associate", sessionStatus: "connected", serviceDown: true }), false);
  assert.equal(isConnectedChatFirst({ role: "broker", sessionStatus: "connected", serviceDown: false }), true);
  assert.equal(isConnectedChatFirst({ role: "broker", sessionStatus: "connected" }), true);
});

test("Meta Diária: tentativa registrada ANTES do destino, mesma contagem; serviço fora devolve wa.me sem chatUrl", () => {
  const src = read("lib/daily-goal.js");
  const fn = src.slice(src.indexOf("export async function registerDailyGoalAttempt("), src.indexOf("export async function registerDailyGoalAttemptAutomated("));
  assert.ok(fn.indexOf('from("daily_goal_attempts").insert') < fn.indexOf("isWhatsappServiceDown()"));
  assert.ok(fn.indexOf("isWhatsappServiceDown()") < fn.indexOf("return { attemptNumber"));
  assert.match(fn, /wouldOpenChat && !serviceDown/);
  assert.match(fn, /const whatsappUrl = `https:\/\/wa\.me\//);
  assert.match(fn, /serviceDown: wouldOpenChat && serviceDown/);
  // nenhuma segunda gravação de tentativa/pontuação no caminho do serviço fora do ar
  assert.equal((fn.match(/from\("daily_goal_attempts"\)\.insert/g) || []).length, 1);
  const dash = read("components/DailyGoalDashboard.jsx");
  assert.match(dash, /data\.serviceDown/);
  assert.match(dash, /SERVICE_DOWN_NOTICE/);
});

test("fiação: rota leve do card, cron e telas", () => {
  assert.match(read("app/api/admin/whatsapp-individual/card-state/route.js"), /isWhatsappServiceDown\(\)/);
  assert.match(read("app/api/admin/whatsapp-individual/card-state/route.js"), /requireAdminApi/);
  assert.match(read("app/api/cron/whatsapp-flows/route.js"), /getWhatsappServiceHealth\(\{ force: true \}\)/);
  assert.match(read("components/clients/useClientList.js"), /serviceDown: waState\?\.serviceDown === true/);
  assert.match(read("components/marketplace/MarketplaceChat.jsx"), /serviceDown: waState\?\.serviceDown === true/);
  assert.match(read("components/WhatsappChat.jsx"), /Abrir no WhatsApp/);
  assert.match(read("lib/whatsapp-service-stall.js"), /isServiceDown\(\)/);
});
