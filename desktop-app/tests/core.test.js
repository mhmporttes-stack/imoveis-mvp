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
