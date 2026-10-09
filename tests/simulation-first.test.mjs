// "Primeira mensagem = link da simulação" (regra do dono, 2026-10-09).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { isPresentationLinkMessage, requiresSimulationFirst } from "../lib/simulation-first-core.mjs";

const base = { distribution_type: "round_robin", primary_monthly_income: 3100, status: "pending", created_at: "2026-10-09T14:00:00Z" };

test("cliente da roleta com dados e sem simulação enviada: trava", () => {
  assert.equal(requiresSimulationFirst(base), true);
  assert.equal(requiresSimulationFirst({ ...base, status: "in_service" }), true);
  assert.equal(requiresSimulationFirst({ ...base, status: "automated_service" }), true);
});

test("não trava: simulação enviada, sem dados, link pessoal, depois da simulação ou anterior à regra", () => {
  assert.equal(requiresSimulationFirst(base, { presentationSent: true }), false);
  assert.equal(requiresSimulationFirst({ ...base, primary_monthly_income: 0 }), false);
  assert.equal(requiresSimulationFirst({ ...base, distribution_type: "" }), false);
  assert.equal(requiresSimulationFirst({ ...base, status: "simulation_sent" }), false);
  assert.equal(requiresSimulationFirst({ ...base, created_at: "2026-10-09T08:00:00Z" }), false);
  assert.equal(requiresSimulationFirst(null), false);
});

test("só o link da apresentação passa", () => {
  assert.equal(isPresentationLinkMessage("https://www.matheusmachadoimoveis.com.br/s/AbCdEf123456"), true);
  assert.equal(isPresentationLinkMessage("Oi, meu nome é Bruna"), false);
  assert.equal(isPresentationLinkMessage("https://www.matheusmachadoimoveis.com.br/simulacao?ref=bruna"), false);
});

test("todas as portas de envio do Chat passam pela trava", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  for (const fn of ["sendChatMessage(id, text, auth", "sendChatTemplate(id", "sendChatMedia(id", "sendUploadedChatMedia(id", "sendChatShortcut(id"]) {
    const start = chat.indexOf(`export async function ${fn}`);
    const body = chat.slice(start, start + 1200);
    assert.match(body, /await assertSimulationFirst\(conversation, auth/, fn);
  }
});

test("finalizar a conversa zera o não lido (2026-10-09)", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /if \(status === "finished"\) \{\n\s+patch\.unread_count = 0;/);
});

test("resposta humana zera o 'não lida'; automação não (2026-10-09)", () => {
  const sql = readFileSync(new URL("../supabase/migrations/20261009150000_whatsapp_outbound_clears_unread.sql", import.meta.url), "utf8");
  assert.match(sql, /unread_count = case when p_mark_in_service and \(c\.last_message_at is null or p_at >= c\.last_message_at\) then 0 else c\.unread_count end/);
});
