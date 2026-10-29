// EXT-1 (dono, 2026-10-29): tela "Extensões" do CRM — regras puras (lib/browser-extensions-core.mjs) e travas de
// permissão/estrutura das rotas.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CONFIG_FIELDS,
  buildExtensionHealthView,
  buildExtensionRuntime,
  compareVersions,
  defaultExtensionConfig,
  extensionForToken,
  isOutdated,
  mergeHealth,
  normalizeControl,
  normalizeExtensionConfig,
  normalizeHealthReport,
  scrubThirdPartyText
} from "../lib/browser-extensions-core.mjs";

const ler = (caminho) => readFileSync(new URL(caminho, import.meta.url), "utf8");

test("padrões: Instagram segue 20 por dia (faixa 0–40); Marketplace publica 3 (sem teto de mensagens do chat)", () => {
  assert.equal(defaultExtensionConfig("instagram").followPerDay, 20);
  const follow = CONFIG_FIELDS.instagram.find((f) => f.key === "followPerDay");
  assert.deepEqual([follow.min, follow.max], [0, 40]);
  assert.deepEqual(defaultExtensionConfig("marketplace"), { publishPerDay: 3, publishStartHour: 8, publishEndHour: 20 });
  assert.ok(!CONFIG_FIELDS.marketplace.some((f) => /chat|message|mensag/i.test(`${f.key} ${f.label}`)), "dono não quer teto diário de mensagens do chat");
});

test("normalizeExtensionConfig: faixa fechada, lixo vira padrão, horário invertido volta ao padrão", () => {
  assert.equal(normalizeExtensionConfig("instagram", { followPerDay: 99 }).followPerDay, 40);
  assert.equal(normalizeExtensionConfig("instagram", { followPerDay: -3 }).followPerDay, 0);
  assert.equal(normalizeExtensionConfig("instagram", { followPerDay: "abc" }).followPerDay, 20);
  assert.equal(normalizeExtensionConfig("instagram", { followPerDay: "" }).followPerDay, 20);
  const horas = normalizeExtensionConfig("instagram", { startHour: 23, endHour: 5 });
  assert.deepEqual([horas.startHour, horas.endHour], [5, 22]);
  assert.equal(normalizeExtensionConfig("marketplace", { publishPerDay: 4.6 }).publishPerDay, 5);
  assert.deepEqual(Object.keys(normalizeExtensionConfig("instagram", { extra: 1 })).sort(), CONFIG_FIELDS.instagram.map((f) => f.key).sort());
});

test("Parar tudo: só true explícito para", () => {
  assert.equal(normalizeControl({ stopped: true }).stopped, true);
  assert.equal(normalizeControl({ stopped: "true" }).stopped, false);
  assert.equal(normalizeControl(null).stopped, false);
});

test("versões: compara por número, versão atrasada é avisada", () => {
  assert.equal(compareVersions("1.9.10", "1.10.0"), -1);
  assert.equal(compareVersions("1.2.0", "1.2"), 0);
  assert.equal(compareVersions("x", "1.0"), null);
  assert.equal(isOutdated("1.1.11", "1.2.0"), true);
  assert.equal(isOutdated("1.2.0", "1.2.0"), false);
  const rt = buildExtensionRuntime("instagram", { control: { stopped: true }, config: { followPerDay: 25 }, latestVersion: "1.2.0", runningVersion: "1.1.11", downloadUrl: "https://crm/x" });
  assert.equal(rt.stopped, true);
  assert.equal(rt.config.followPerDay, 25);
  assert.equal(rt.outdated, true);
});

test("chave pelo prefixo: igs_ = Seguidor, mkp_ = Marketplace; curta/estranha = nenhuma", () => {
  assert.equal(extensionForToken(`igs_${"a".repeat(48)}`), "instagram");
  assert.equal(extensionForToken(`mkp_${"b".repeat(48)}`), "marketplace");
  assert.equal(extensionForToken("igs_curta"), "");
  assert.equal(extensionForToken(`xyz_${"a".repeat(48)}`), "");
});

test("sinal de saúde: sem dado de terceiros; erros só das últimas 24 h; última rodada ok guardada", () => {
  assert.equal(scrubThirdPartyText("Falhou com @maria.s, ligue (14) 99999-1234 ou maria@x.com https://instagram.com/maria"), "Falhou com @…, ligue ([número] ou [e-mail] [link]");
  const t0 = new Date("2026-10-29T12:00:00Z");
  const r1 = normalizeHealthReport({ ok: true, stage: "ok", today: { follow: { done: 3, limit: 20 }, "bad key!": { done: 1 } }, errors: [{ at: "2026-10-29T11:00:00Z", text: "erro com @fulano" }], selectorFailures: [{ at: "2026-10-29T11:30:00Z", name: "perfil: botão" }] });
  assert.deepEqual(Object.keys(r1.today), ["follow"]);
  assert.equal(r1.errors[0].text, "erro com @…");
  const h1 = mergeHealth(null, r1, { now: t0, version: "1.2.0" });
  assert.equal(h1.lastOkAt, t0.toISOString());
  assert.equal(h1.version, "1.2.0");
  const t1 = new Date("2026-10-30T13:00:00Z");
  const h2 = mergeHealth(h1, normalizeHealthReport({ ok: false, error: "x", errors: [{ at: "2026-10-30T12:59:00Z", text: "novo" }] }), { now: t1 });
  assert.equal(h2.lastOkAt, t0.toISOString(), "rodada com erro não apaga a última ok");
  assert.deepEqual(h2.errors.map((e) => e.text), ["novo"], "erro de mais de 24 h sai");
  const view = buildExtensionHealthView(h2, { latestVersion: "1.2.1", now: t1 });
  assert.equal(view.outdated, true);
  assert.equal(view.minutesSinceSignal, 0);
  assert.equal(view.errors24h.length, 1);
});

test("rotas: tela e API só do admin geral REAL; extensões só com a chave; zip vai no build da Vercel", () => {
  for (const rota of ["../app/api/admin/extensoes/route.js", "../app/api/admin/extensoes/chave/route.js", "../app/api/admin/extensoes/download/route.js"]) {
    const codigo = ler(rota);
    assert.match(codigo, /requireRealGeneralAdminApi\(request\)/, rota);
  }
  assert.match(ler("../app/admin/extensoes/page.jsx"), /requireGeneralAdminPage\(\);\s*if \(auth\.accountSwitchMode\) redirect/);
  for (const rota of ["../app/api/extensoes/estado/route.js", "../app/api/extensoes/saude/route.js"]) {
    assert.match(ler(rota), /authenticateExtensionRequest\(request, "extensoes-/, rota);
  }
  assert.match(ler("../app/api/extensoes/extension-request.js"), /checkPublicRateLimit/);
  assert.match(ler("../next.config.mjs"), /"\/api\/admin\/extensoes\/download": \["\.\/ferramentas\/\*\.zip"\]/);
  // Parar tudo não dispara o aviso "extensão sem sinal" (MKT-2g).
  assert.match(ler("../lib/marketplace-chat-core.mjs"), /if \(alerted \|\| stopped\) return \{ action: "none" \};/);
});
