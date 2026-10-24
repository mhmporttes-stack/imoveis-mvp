// Regras puras do app de desktop (node --test tests/*.test.js, dentro de desktop-app/).
"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { CRM_HOME, classifyNavigation, formatLogLine, isAllowedOrigin, shouldGrantPermission, validateAction } = require("../src/core");

test("só a origem de produção do CRM é aceita", () => {
  assert.equal(isAllowedOrigin(CRM_HOME), true);
  assert.equal(isAllowedOrigin("https://matheusmachadoimoveis.com.br/admin"), true);
  for (const url of [
    "http://www.matheusmachadoimoveis.com.br/admin",
    "https://www.matheusmachadoimoveis.com.br.evil.com/",
    "https://evil.com/?https://www.matheusmachadoimoveis.com.br",
    "https://imoveis-mvp.vercel.app/admin",
    "https://www.matheusmachadoimoveis.com.br:8443/",
    "file:///C:/x.html",
    "",
    null
  ]) assert.equal(isAllowedOrigin(url), false, String(url));
});

test("navegação: CRM no app, resto para o sistema, desconhecido bloqueado", () => {
  assert.equal(classifyNavigation("https://www.matheusmachadoimoveis.com.br/admin/simulacoes"), "app");
  assert.equal(classifyNavigation("https://open.spotify.com/track/abc"), "external");
  assert.equal(classifyNavigation("https://wa.me/5514999999999"), "external");
  assert.equal(classifyNavigation("spotify:track:abc"), "external");
  assert.equal(classifyNavigation("mailto:a@b.com"), "external");
  assert.equal(classifyNavigation("file:///C:/Windows/system32/calc.exe"), "block");
  assert.equal(classifyNavigation("javascript:alert(1)"), "block");
  assert.equal(classifyNavigation("ms-settings:display"), "block");
  assert.equal(classifyNavigation("nada"), "block");
});

test("permissões automáticas só para o CRM e só da lista", () => {
  const crm = "https://www.matheusmachadoimoveis.com.br/admin";
  assert.equal(shouldGrantPermission({ permission: "media", origin: crm, mediaTypes: ["audio"] }), true);
  assert.equal(shouldGrantPermission({ permission: "media", origin: crm, mediaTypes: ["audio", "video"] }), true);
  assert.equal(shouldGrantPermission({ permission: "notifications", origin: crm }), true);
  assert.equal(shouldGrantPermission({ permission: "media", origin: "https://evil.com", mediaTypes: ["audio"] }), false);
  assert.equal(shouldGrantPermission({ permission: "notifications", origin: "https://open.spotify.com" }), false);
  assert.equal(shouldGrantPermission({ permission: "geolocation", origin: crm }), false);
  assert.equal(shouldGrantPermission({ permission: "openExternal", origin: crm }), false);
  assert.equal(shouldGrantPermission({ permission: "media", origin: crm, mediaTypes: ["screen"] }), false);
});

test("ações da ponte: lista fechada e formatos validados", () => {
  assert.deepEqual(validateAction("openSpotify", { uri: "spotify:playlist:37i9dQZF1DX0FOF1IUWK1W" }), { ok: true, action: "openSpotify", args: { uri: "spotify:playlist:37i9dQZF1DX0FOF1IUWK1W" } });
  assert.equal(validateAction("openSpotify", { uri: "spotify:track:abc;calc" }).ok, false);
  assert.equal(validateAction("openSpotify", { uri: "https://open.spotify.com/x" }).ok, false);
  assert.equal(validateAction("openUrl", { url: "https://open.spotify.com/search/samba" }).ok, true);
  assert.equal(validateAction("openUrl", { url: "http://exemplo.com" }).ok, false);
  assert.equal(validateAction("openUrl", { url: "file:///C:/x" }).ok, false);
  assert.equal(validateAction("openUrl", { url: "ms-settings:display" }).ok, false);
  assert.equal(validateAction("screenOff").ok, true);
  assert.equal(validateAction("screenOn", { comando: "rm -rf" }).ok, true);
  assert.deepEqual(validateAction("screenOn", { comando: "x" }).args, {});
  assert.equal(validateAction("exec", { cmd: "calc" }).ok, false);
  assert.equal(validateAction("__proto__").ok, false);
  const notice = validateAction("notify", { title: "Henry\n\u0007", body: "x".repeat(500) });
  assert.equal(notice.ok, true);
  assert.equal(notice.args.title, "Henry");
  assert.equal(notice.args.body.length, 200);
  assert.equal(validateAction("notify", { title: "  " }).ok, false);
});

test("linha do log: uma linha só, sem quebra", () => {
  const line = formatLogLine({ at: new Date("2026-10-23T12:00:00Z"), action: "openSpotify", ok: true, detail: "spotify:track:abc\nfalso" });
  assert.equal(line, "2026-10-23T12:00:00.000Z openSpotify ok spotify:track:abc falso\n");
  assert.match(formatLogLine({ action: "screenOff", ok: false }), / screenOff recusado\n$/);
});

// --- Fase 1.1 (dono, 2026-10-23): onWake + speakLocal ---------------------------------------------------------------
const {
  BRIDGE_ACTIONS,
  MAX_SPEAK_TEXT,
  WAKE_GRAMMAR,
  WAKE_TARGETS,
  WAKE_WORDS_EXCLUDED,
  WAKE_WORDS_NOT_IN_MODEL,
  detectWakeInResult,
  pcmToWav,
  shouldGrantWakePermission
} = require("../src/core");

test("lista fechada: só a speakLocal entrou nas ações (onWake é evento, não ação)", () => {
  assert.deepEqual([...BRIDGE_ACTIONS], ["openSpotify", "openUrl", "notify", "screenOff", "screenOn", "speakLocal"]);
  assert.equal(validateAction("onWake").ok, false);
  assert.equal(validateAction("speakLocalShell", { text: "x" }).ok, false);
  const preload = require("node:fs").readFileSync(require("node:path").join(__dirname, "..", "src", "preload.js"), "utf8");
  const exposed = [...preload.matchAll(/^ {4}([A-Za-z]+):/gm)].map((match) => match[1]);
  assert.deepEqual(exposed.sort(), ["isDesktopApp", "notify", "henryFullscreen", "onActivate", "onWake", "onWindowVisibility", "openSpotify", "openUrl", "screenOff", "screenOn", "speakLocal", "version"].sort());
});

test("speakLocal: só string, até 1.000 caracteres, uma linha só", () => {
  assert.deepEqual(validateAction("speakLocal", { text: "Chefe? Pode falar." }), { ok: true, action: "speakLocal", args: { text: "Chefe? Pode falar." } });
  assert.equal(validateAction("speakLocal", { text: "linha 1\nlinha 2\r\n& calc.exe" }).args.text, "linha 1 linha 2 & calc.exe");
  assert.equal(validateAction("speakLocal", { text: "x".repeat(MAX_SPEAK_TEXT) }).ok, true);
  assert.equal(validateAction("speakLocal", { text: "x".repeat(MAX_SPEAK_TEXT + 1) }).error, "texto_longo");
  for (const text of [undefined, null, 42, ["oi"], { toString: () => "oi" }]) assert.equal(validateAction("speakLocal", { text }).error, "texto_invalido", String(text));
  assert.equal(validateAction("speakLocal", { text: " \n\t " }).error, "texto_vazio");
  assert.equal(validateAction("speakLocal").ok, false);
});

test("WAV do Piper: cabeçalho RIFF certo", () => {
  const wav = pcmToWav(Buffer.alloc(100), 22050);
  assert.equal(wav.length, 144);
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
  assert.equal(wav.readUInt32LE(24), 22050);
  assert.equal(wav.readUInt32LE(40), 100);
});

test("gramática do nome: variantes do CRM no modelo + [unk], sem palavra comum como alvo", async () => {
  const { WAKE_WORDS_STRONG, WAKE_WORDS_WEAK } = await import("../../lib/henry-voice-core.mjs");
  assert.equal(WAKE_GRAMMAR[WAKE_GRAMMAR.length - 1], "[unk]");
  for (const target of WAKE_TARGETS) assert.ok(WAKE_GRAMMAR.includes(target));
  // Toda variante do CRM está decidida: alvo, fora do modelo ou excluída de propósito.
  const decided = new Set([...WAKE_TARGETS.flatMap((item) => item.split(" ")), ...WAKE_WORDS_NOT_IN_MODEL, ...WAKE_WORDS_EXCLUDED]);
  for (const word of [...WAKE_WORDS_STRONG, ...WAKE_WORDS_WEAK]) assert.ok(decided.has(word), word);
  // As fracas (Henrique, René...) nunca acordam sozinhas.
  for (const word of WAKE_WORDS_EXCLUDED) assert.equal(WAKE_TARGETS.includes(word), false, word);
});

test("detecção do nome: palavra/frase alvo com confiança mínima", () => {
  assert.deepEqual(detectWakeInResult({ result: [{ word: "henry", conf: 0.9 }] }), { phrase: "henry", confidence: 0.9 });
  assert.equal(detectWakeInResult({ result: [{ word: "rei", conf: 0.8 }, { word: "ri", conf: 0.6 }] }).phrase, "rei ri");
  assert.equal(detectWakeInResult({ result: [{ word: "rei", conf: 0.9 }, { word: "[unk]", conf: 1 }, { word: "ri", conf: 0.9 }] }), null);
  assert.equal(detectWakeInResult({ result: [{ word: "henri", conf: 0.1 }] }), null);
  assert.equal(detectWakeInResult({ result: [{ word: "henrique", conf: 1 }, { word: "renda", conf: 1 }] }), null);
  assert.equal(detectWakeInResult({ result: [{ word: "[unk]", conf: 1 }] }), null);
  assert.equal(detectWakeInResult(null), null);
  assert.equal(detectWakeInResult({ result: "henry" }), null);
});

test("microfone da escuta do nome: só a página local, só áudio", () => {
  assert.equal(shouldGrantWakePermission({ permission: "media", origin: "mm-wake://app/wake.html", mediaTypes: ["audio"] }), true);
  assert.equal(shouldGrantWakePermission({ permission: "media", origin: "mm-wake://app/wake.html", mediaTypes: ["video"] }), false);
  assert.equal(shouldGrantWakePermission({ permission: "media", origin: "mm-wake://app/wake.html", mediaTypes: [] }), false);
  assert.equal(shouldGrantWakePermission({ permission: "notifications", origin: "mm-wake://app/wake.html" }), false);
  assert.equal(shouldGrantWakePermission({ permission: "media", origin: "mm-wake://outro/", mediaTypes: ["audio"] }), false);
  assert.equal(shouldGrantWakePermission({ permission: "media", origin: "https://www.matheusmachadoimoveis.com.br", mediaTypes: ["audio"] }), false);
  // E o contrário: a origem local nunca ganha as permissões do CRM.
  assert.equal(shouldGrantPermission({ permission: "media", origin: "mm-wake://app/wake.html", mediaTypes: ["audio"] }), false);
});

// --- 1.3.1 (app lento, 2026-10-23): janela minimizada/na bandeja avisa a página -------------------------------------
test("isWindowHidden: minimizada, escondida na bandeja ou sem janela = oculta", () => {
  const { isWindowHidden } = require("../src/core");
  assert.equal(isWindowHidden({ exists: true, visible: true, minimized: false }), false);
  assert.equal(isWindowHidden({ exists: true, visible: true, minimized: true }), true);
  assert.equal(isWindowHidden({ exists: true, visible: false, minimized: false }), true);
  assert.equal(isWindowHidden({ exists: false }), true);
});
