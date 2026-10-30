// "Primeira mensagem = link da simulação" (regra do dono, 2026-10-09).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { pickProtectedClientIds } from "../lib/whatsapp-attendance-core.mjs";
import { SIMULATION_FIRST_DONE_MESSAGE, SIMULATION_FIRST_MESSAGE, isPresentationLinkMessage, requiresSimulationFirst, simulationFirstMessageFor } from "../lib/simulation-first-core.mjs";

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
  assert.equal(requiresSimulationFirst({ ...base, status: "completed" }), true, "simulação feita mas não enviada continua travando");
  assert.equal(requiresSimulationFirst({ ...base, created_at: "2026-10-09T08:00:00Z" }), false);
  assert.equal(requiresSimulationFirst(null), false);
});

test("Simulação realizada sem link: continua travando, mas o texto pede só o link (dono, 2026-10-22, #C1016)", () => {
  assert.equal(requiresSimulationFirst({ ...base, status: "completed" }), true);
  assert.equal(simulationFirstMessageFor("completed"), SIMULATION_FIRST_DONE_MESSAGE);
  assert.doesNotMatch(SIMULATION_FIRST_DONE_MESSAGE, /faça a simulação/i);
  assert.match(SIMULATION_FIRST_DONE_MESSAGE, /Simulação → Enviar link/);
  for (const status of ["pending", "in_service", "automated_service"]) assert.equal(simulationFirstMessageFor(status), SIMULATION_FIRST_MESSAGE, status);
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /new WhatsappChatError\(simulationFirstMessageFor\(state\.status\), \{ status: 409, code: "SIMULATION_FIRST" \}\)/);
  assert.match(chat, /simulationFirstDone: Boolean\(simulationFirst\?\.done\)/);
  const ui = readFileSync(new URL("../components/WhatsappChat.jsx", import.meta.url), "utf8");
  assert.match(ui, /conversation\.simulationFirstDone[\s\S]{0,200}\? SIMULATION_FIRST_DONE_MESSAGE/);
});

test("responsável que já mandou mensagem ao cliente desde que o recebeu não é travado de novo (caso Taislane/Jennyfer, 2026-10-30)", () => {
  // Transferida à mão em 14:29 (status Aguardando contato, fora da lista); 1ª mensagem 14:59; cliente respondeu e o
  // status voltou a "Em atendimento" -> antes a trava reativava e recusava a 2ª mensagem.
  const taislane = { ...base, status: "in_service", primary_monthly_income: 1800, created_at: "2026-10-06T19:33:26Z", responsible_changed_at: "2026-10-30T14:29:18Z" };
  assert.equal(requiresSimulationFirst(taislane), true, "sem mensagem humana a trava continua (1ª mensagem = simulação)");
  const conversations = [{ client_id: "c1", last_human_reply_at: "2026-10-30T14:59:29Z", assumed_at: null }];
  const humanMessaged = pickProtectedClientIds(conversations, [{ id: "c1", ...taislane }], { messagesOnly: true }).has("c1");
  assert.equal(humanMessaged, true);
  assert.equal(requiresSimulationFirst(taislane, { humanMessaged }), false);
  // Mensagem de um responsável ANTERIOR (antes de receber) ou só "Assumir atendimento" não libera.
  const old = [{ client_id: "c1", last_human_reply_at: "2026-10-07T10:00:00Z", assumed_at: null }];
  assert.equal(pickProtectedClientIds(old, [{ id: "c1", ...taislane }], { messagesOnly: true }).has("c1"), false);
  const assumed = [{ client_id: "c1", last_human_reply_at: null, assumed_at: "2026-10-30T14:40:00Z" }];
  assert.equal(pickProtectedClientIds(assumed, [{ id: "c1", ...taislane }], { messagesOnly: true }).has("c1"), false);
  // A porta do Chat usa o mesmo sinal.
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /pickProtectedClientIds\(replyRows, \[\{ id: conversation\.client_id[^\]]*\], \{ messagesOnly: true \}\)/);
  assert.match(chat, /requiresSimulationFirst\(client, \{ humanMessaged \}\)/);
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

test("conversa arquivada sai da lista principal e fica em Arquivadas (2026-10-09)", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /if \(safeFilter !== "finished" && safeFilter !== "private" && safeFilter !== "private_unseen" && !groupsTab && !term\) request = request\.neq\("status", "finished"\);/);
});

test("abrir cliente no Chat segue o número em que ele está sendo atendido (2026-10-09)", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /if \(current\?\.\[0\]\?\.session_key\) sessionKey = current\[0\]\.session_key;/);
});

test("link interno do CRM (/admin/) não pode ir para o cliente (2026-10-09)", async () => {
  const { hasInternalCrmLink } = await import("../lib/simulation-first-core.mjs");
  assert.equal(hasInternalCrmLink("https://www.matheusmachadoimoveis.com.br/admin/simulacoes/4d33/apresentacao"), true);
  assert.equal(hasInternalCrmLink("https://www.matheusmachadoimoveis.com.br/s/AbCdEf123456"), false);
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /if \(hasInternalCrmLink\(body\)\) throw new WhatsappChatError\(INTERNAL_LINK_MESSAGE/);
});

test("número oficial pede a prévia do link (preview_url) em texto com link (2026-10-09)", () => {
  const master = readFileSync(new URL("../lib/whatsapp-master.js", import.meta.url), "utf8");
  assert.match(master, /preview_url: true/);
  assert.match(master, /\.\.\.withLinkPreview\(message\)/);
});

test("liberação manual do dono tira a trava da primeira mensagem", async () => {
  const { requiresSimulationFirst } = await import("../lib/simulation-first-core.mjs");
  const client = { distribution_type: "round_robin", primary_monthly_income: 3000, status: "in_service", created_at: "2026-10-12T12:49:00Z" };
  assert.equal(requiresSimulationFirst(client), true);
  assert.equal(requiresSimulationFirst({ ...client, simulation_first_waived_at: "2026-10-12T15:30:00Z" }), false);
});
