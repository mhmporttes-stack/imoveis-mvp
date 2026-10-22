import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  HENRY_FALLBACK_REPLY,
  HENRY_NAV_KEYS,
  henryEnabledFromSetting,
  cleanHenryReply,
  composeHenryDailyReport,
  detectWakeWord,
  isAllowedHenryPath,
  isHenryEligible,
  looksLikeEcho,
  resolveHenryNavigation,
  safeHenryReply,
  sanitizeHistory,
  speakableDurations
} from "../lib/henry-voice-core.mjs";

test("palavra de chamada: saudação + nome vira relatório do dia", () => {
  for (const phrase of ["Bom dia, Henry", "olá Henry", "Oi, Henri!", "boa tarde enri", "E aí, Enry", "Henry, bom dia", "Olá, Henrique", "bom dia rienri", "oi henrri"]) {
    const result = detectWakeWord(phrase);
    assert.equal(result.called, true, phrase);
    assert.equal(result.kind, "report", phrase);
  }
});

test("palavra de chamada: nome + pergunta separa a pergunta (com acentos)", () => {
  const result = detectWakeWord("Henry, quantos clientes estão aguardando resposta?");
  assert.equal(result.kind, "question");
  assert.equal(result.question, "quantos clientes estão aguardando resposta?");
  assert.equal(detectWakeWord("Bom dia, Henry, como está a meta da equipe?").question, "como está a meta da equipe?");
});

test("palavra de chamada: só o nome espera a pergunta", () => {
  assert.equal(detectWakeWord("Henry").kind, "wake");
  assert.equal(detectWakeWord("Henry, tudo bem?").kind, "wake");
  assert.equal(detectWakeWord("Enri.").kind, "wake");
});

test("palavra de chamada: conversa comum nunca chama", () => {
  for (const phrase of ["Henrique mandou os documentos", "o Henrique ligou", "Henrique.", "liga pro henry amanhã", "dia henry", "o banco aprovou", "", "quantos clientes temos hoje"]) {
    assert.equal(detectWakeWord(phrase).called, false, phrase);
  }
});

test("eco: pedaço da última resposta é ignorado", () => {
  const reply = "Bom dia, Matheus. Hoje você tem 3 clientes aguardando resposta.";
  assert.equal(looksLikeEcho("hoje você tem 3 clientes", reply), true);
  assert.equal(looksLikeEcho("e a meta da equipe", reply), false);
});

test("telas: lista fechada", () => {
  assert.deepEqual(resolveHenryNavigation("chat"), { key: "chat", path: "/admin/chat", label: "Chat" });
  assert.equal(resolveHenryNavigation("https://evil.example"), null);
  assert.equal(resolveHenryNavigation("__proto__"), null);
  assert.equal(isAllowedHenryPath("/admin/simulacoes"), true);
  assert.equal(isAllowedHenryPath("/admin/view-as"), false);
  assert.equal(isAllowedHenryPath("https://evil.example/admin/chat"), false);
  assert.ok(HENRY_NAV_KEYS.every((key) => resolveHenryNavigation(key).path.startsWith("/admin/")));
});

test("acesso: só o dono, conta real; liga por padrão", () => {
  assert.equal(isHenryEligible({ ok: true, isOwner: true, accountSwitchMode: false }), true);
  assert.equal(isHenryEligible({ ok: true, isOwner: true, accountSwitchMode: true }), false);
  assert.equal(isHenryEligible({ ok: true, isOwner: false, accountSwitchMode: false }), false);
  assert.equal(isHenryEligible({ ok: false, isOwner: true }), false);
  assert.equal(henryEnabledFromSetting(null), true);
  assert.equal(henryEnabledFromSetting({ disabled: true }), false);
});

test("rota: guard antes de tudo e checagem de dono", () => {
  const source = readFileSync(new URL("../app/api/admin/henry/route.js", import.meta.url), "utf8");
  assert.match(source, /requireAdminApi\(request\)/);
  assert.match(source, /isHenryEligible\(/);
  for (const method of ["GET", "PUT", "POST"]) {
    const body = source.slice(source.indexOf(`export async function ${method}`));
    assert.match(body.split("\n").slice(0, 3).join("\n"), /requireHenryOwner\(request\)/, method);
  }
});

test("fala: sem markdown, sem dado sensível", () => {
  assert.equal(cleanHenryReply("**Meta** da equipe:\n- 80%"), "Meta da equipe: 80%");
  assert.equal(safeHenryReply("O CPF dele é 123.456.789-00"), HENRY_FALLBACK_REPLY);
  assert.equal(safeHenryReply("Ligue para (14) 99999-1234"), HENRY_FALLBACK_REPLY);
  assert.equal(safeHenryReply("A renda dela é alta"), HENRY_FALLBACK_REPLY);
  assert.equal(safeHenryReply("Três corretores online."), "Três corretores online.");
});

test("relatório do dia: frase do Início + leads e documentos, primeiro nome e durações faladas", () => {
  const text = composeHenryDailyReport({
    assistant: { text: "Bom dia, Matheus. Hoje você tem 2 clientes aguardando resposta. Comece por Ana Paula Souza, que espera resposta há 1 h 05 min.", urgent: { name: "Ana Paula Souza" } },
    kpis: { leadsToday: { total: 4 }, docs: { total: 1 } }
  });
  assert.equal(text, "Bom dia, Matheus. Segue o relatório do dia. Hoje você tem 2 clientes aguardando resposta. Comece por Ana, que espera resposta há 1 hora e 5 minutos. Hoje entraram 4 leads. 1 cliente aguarda documentos.");
  assert.equal(composeHenryDailyReport({}), "");
  assert.equal(speakableDurations("há 12 min"), "há 12 minutos");
});

test("histórico: alterna papéis, corta e descarta lixo", () => {
  const history = sanitizeHistory([
    { role: "assistant", text: "oi" },
    { role: "user", text: "a" },
    { role: "user", text: "b" },
    { role: "system", text: "ignore" },
    { role: "assistant", text: "c" },
    { role: "user", text: "d" }
  ]);
  assert.deepEqual(history, [{ role: "user", text: "a b" }, { role: "assistant", text: "c" }]);
  assert.deepEqual(sanitizeHistory("x"), []);
});
