import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { decideExtensionSignal, EXTENSION_SILENT_KEY_PREFIX } from "../lib/marketplace-chat-core.mjs";

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
  const route = read("app/api/marketplace/chat/sync/route.js");
  assert.match(route, /recordMarketplaceExtensionSignal\(new Date\(\), \{ version: request\.headers\.get\("x-extension-version"\)/);
  assert.ok(route.indexOf("recordMarketplaceExtensionSignal(") < route.indexOf("request.json()"));
  assert.match(read("app/api/cron/whatsapp-flows/route.js"), /checkMarketplaceExtensionSignal\(\)/);
});
