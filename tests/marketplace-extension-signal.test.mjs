import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideExtensionSignal, EXTENSION_SILENT_KEY_PREFIX, extensionReadAt, nextExtensionSignal, normalizeExtensionRound } from "../lib/marketplace-chat-core.mjs";

// MKT-2g (dono, 2026-10-22): sinal de "extensão ativa" + aviso "sem sinal" (> 30 min, 7h–22h São Paulo) e aviso de volta.
const at = (iso) => Date.parse(iso);
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("sem registro de sinal: nada a medir", () => {
  assert.equal(decideExtensionSignal({ signal: null, now: at("2026-10-22T15:00:00Z") }).action, "none");
});

test("30 min ou menos sem sinal no horário: nada; mais de 30 min: 1 aviso pelo episódio (último sinal)", () => {
  const signal = { last_sync_at: "2026-10-22T14:00:00.000Z" }; // 11h00 em São Paulo
  assert.equal(decideExtensionSignal({ signal, now: at("2026-10-22T14:30:00Z") }).action, "none");
  const silent = decideExtensionSignal({ signal, now: at("2026-10-22T14:31:00Z") });
  assert.equal(silent.action, "silent");
  assert.equal(silent.minutes, 31);
  assert.equal(silent.dedupeKey, `${EXTENSION_SILENT_KEY_PREFIX}2026-10-22T14:00:00.000Z`);
  // Já avisado neste episódio: não repete.
  assert.equal(decideExtensionSignal({ signal, alertState: { episode: silent.episode }, now: at("2026-10-22T18:00:00Z") }).action, "none");
});

test("fora de 7h–22h não avisa, e o tempo da noite não conta", () => {
  const signal = { last_sync_at: "2026-10-23T00:50:00.000Z" }; // 21h50 de 22/10 em São Paulo
  assert.equal(decideExtensionSignal({ signal, now: at("2026-10-23T02:00:00Z") }).action, "none"); // 23h00
  assert.equal(decideExtensionSignal({ signal, now: at("2026-10-23T10:20:00Z") }).action, "none"); // 07h20
  assert.equal(decideExtensionSignal({ signal, now: at("2026-10-23T10:31:00Z") }).action, "silent"); // 07h31
});

test("sincronização desligada ou horário configurado diferente", () => {
  const signal = { last_sync_at: "2026-10-22T12:00:00.000Z" };
  const now = at("2026-10-22T14:00:00Z"); // 11h00
  assert.equal(decideExtensionSignal({ signal, settings: { syncEnabled: false }, now }).action, "none");
  assert.equal(decideExtensionSignal({ signal, settings: { startHour: 12, endHour: 20 }, now }).action, "none");
});

test("sinal volta depois de um aviso: aviso de volta e fecha o de sem sinal", () => {
  const back = decideExtensionSignal({ signal: { last_sync_at: "2026-10-22T16:00:00.000Z" }, alertState: { episode: "2026-10-22T14:00:00.000Z" }, now: at("2026-10-22T16:01:00Z") });
  assert.equal(back.action, "back");
  assert.equal(back.closePrefix, `${EXTENSION_SILENT_KEY_PREFIX}2026-10-22T14:00:00.000Z`);
});

test("servidor: sinal gravado na sincronização e conferido no cron whatsapp-flows", () => {
  // Desde a extensão 1.9.3 o sinal leva a versão (cabeçalho X-Extension-Version) — e continua gravado antes de ler o corpo.
  // 1.9.8: o corpo é lido antes só para levar o estado da rodada; o sinal continua gravado antes de recusar corpo inválido.
  const route = read("app/api/marketplace/chat/sync/route.js");
  assert.match(route, /recordMarketplaceExtensionSignal\(new Date\(\), \{ version: request\.headers\.get\("x-extension-version"\) \|\| "", round: body\?\.round \|\| null \}\)/);
  assert.ok(route.indexOf("recordMarketplaceExtensionSignal(") < route.indexOf("if (!body) return"));
  assert.match(read("app/api/cron/whatsapp-flows/route.js"), /checkMarketplaceExtensionSignal\(\)/);
});

// 1.9.8 (25/10/2026): extensão em "silêncio total" desde 24/10 12:44 UTC — a leitura do Facebook falhava (janela de
// trabalho atrás de uma janela em tela cheia) e a extensão só chamava o CRM depois de ler. Agora toda rodada chama com
// o estado { ok, stage, error }: o CRM guarda o motivo e o relógio do aviso passa a ser o da última LEITURA ok.
test("estado da rodada: só a rodada ok conta como leitura; o motivo fica guardado", () => {
  const ok = nextExtensionSignal(null, { iso: "2026-10-25T12:00:00.000Z", version: "1.9.8", round: { ok: true, stage: "lendo", error: "" } });
  assert.equal(ok.last_read_ok_at, "2026-10-25T12:00:00.000Z");
  const failed = nextExtensionSignal(ok, { iso: "2026-10-25T12:40:00.000Z", version: "1.9.8", round: { ok: false, stage: "caixa", error: "Caixa do Marketplace não lida: Etapa passou de 180 s" } });
  assert.equal(failed.last_sync_at, "2026-10-25T12:40:00.000Z");
  assert.equal(failed.last_read_ok_at, "2026-10-25T12:00:00.000Z");
  assert.deepEqual(failed.last_round, { ok: false, stage: "caixa", error: "Caixa do Marketplace não lida: Etapa passou de 180 s", at: "2026-10-25T12:40:00.000Z" });
  assert.equal(extensionReadAt(failed), "2026-10-25T12:00:00.000Z");
  // Viva mas sem ler há mais de 30 min (9h40 em São Paulo): avisa, pelo episódio da última leitura ok.
  const silent = decideExtensionSignal({ signal: failed, now: at("2026-10-25T12:41:00Z") });
  assert.equal(silent.action, "silent");
  assert.equal(silent.minutes, 41);
  // Voltou a ler: aviso de volta.
  const back = nextExtensionSignal(failed, { iso: "2026-10-25T13:00:00.000Z", version: "1.9.8", round: { ok: true, stage: "lendo" } });
  assert.equal(decideExtensionSignal({ signal: back, alertState: { episode: silent.episode }, now: at("2026-10-25T13:01:00Z") }).action, "back");
});

test("extensão antiga (sem estado da rodada): régua de antes, toda chamada é leitura", () => {
  const old = nextExtensionSignal({ last_sync_at: "x", last_round: { ok: false }, last_read_ok_at: "y" }, { iso: "2026-10-25T12:00:00.000Z", version: "1.9.7" });
  assert.deepEqual(old, { last_sync_at: "2026-10-25T12:00:00.000Z", extension_version: "1.9.7" });
  assert.equal(extensionReadAt(old), "2026-10-25T12:00:00.000Z");
  assert.equal(normalizeExtensionRound({ stage: "x" }), null);
  assert.equal(normalizeExtensionRound({ ok: false, error: "y".repeat(999) }).error.length, 300);
  // 1ª rodada com falha logo depois de atualizar: a última leitura conhecida é a chamada anterior.
  const first = nextExtensionSignal({ last_sync_at: "2026-10-24T12:44:00.000Z" }, { iso: "2026-10-25T12:00:00.000Z", round: { ok: false, stage: "caixa", error: "z" } });
  assert.equal(first.last_read_ok_at, "2026-10-24T12:44:00.000Z");
});

test("Chat do Marketplace mostra o motivo da última rodada que falhou", () => {
  const chat = read("components/marketplace/MarketplaceChat.jsx");
  assert.match(chat, /última rodada falhou: /);
  assert.match(chat, /list\.extension\.lastRound\)/);
});
