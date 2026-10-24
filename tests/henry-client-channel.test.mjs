import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { alertMemoryContext, composeHenryClientAlert, HENRY_ALERT_MEMORY_MARK } from "../lib/henry-voice-client-alerts-core.mjs";
import { appendDayTurns, dayTurns, modelHistoryFromDay } from "../lib/henry-memory-core.mjs";
import { buildHenryClientsReport, buildHenryConversationReport, describeChatChannels } from "../lib/henry-reports-core.mjs";
import { buildHenryStaticPrompt, henryNeedsTools } from "../lib/henry-voice-persona.mjs";
import { isSafeToSpeak } from "../lib/alexa-v2/sanitize.mjs";

// Dono, 2026-10-24: "O Henry acabou de me informar que entrou uma cliente nova e ela está comigo. Depois disso, eu
// perguntei se ela estava no número da API oficial ou no meu número pessoal. E aí ele disse que não conseguia visualizar."

const OWNER = "11111111-1111-1111-1111-111111111111";
const BRUNA = "22222222-2222-2222-2222-222222222222";
const fmt = (iso) => `fmt(${iso})`;

test("canal: oficial, pessoal do dono (Número 1/2 com apelido) e pessoal de outro corretor, sem telefone", () => {
  const official = describeChatChannels([{ official: true, ownerId: null, slot: null, lastMessageAt: "2026-10-24T12:00:00Z", lastMessageDirection: "inbound" }], { viewerId: OWNER, formatDate: fmt });
  assert.equal(official.onde, "no número oficial");
  assert.deepEqual(official.conversas, [{ canal: "número oficial", ultima_mensagem: "fmt(2026-10-24T12:00:00Z)", de_quem: "do cliente" }]);

  const mine = describeChatChannels([{ official: false, ownerId: OWNER, ownerName: "Matheus Machado", slot: 2, numberLabel: "Número 2 · Trabalho", lastMessageAt: "x", lastMessageDirection: "outbound" }], { viewerId: OWNER, formatDate: fmt });
  assert.equal(mine.onde, "no seu WhatsApp pessoal (Número 2 · Trabalho)");
  assert.equal(mine.conversas[0].de_quem, "sua");

  const other = describeChatChannels([{ official: false, ownerId: BRUNA, ownerName: "Bruna Souza", slot: 1, numberLabel: "Número 1", lastMessageAt: "x", lastMessageDirection: "outbound" }], { viewerId: OWNER, formatDate: fmt });
  assert.equal(other.onde, "no WhatsApp pessoal de Bruna (Número 1)");
  assert.equal(other.conversas[0].de_quem, "da equipe");

  const both = describeChatChannels([
    { official: false, ownerId: OWNER, ownerName: "Matheus", slot: 1, numberLabel: "Número 1", lastMessageAt: "b", lastMessageDirection: "inbound" },
    { official: true, ownerId: null, lastMessageAt: "a", lastMessageDirection: "outbound" }
  ], { viewerId: OWNER, formatDate: fmt });
  assert.equal(both.onde, "em 2 WhatsApps: no seu WhatsApp pessoal (Número 1) e no número oficial");

  assert.equal(describeChatChannels([], { viewerId: OWNER }).onde, "sem conversa no Chat");
  assert.equal(describeChatChannels(null, { viewerId: OWNER }).onde, "não conferido");
  for (const item of [official, mine, other, both]) assert.equal(/\d{8,}/.test(JSON.stringify(item)), false);
});

test("buscar_clientes e conversa do cliente trazem o canal (fatos + tela)", () => {
  const chat = describeChatChannels([{ official: false, ownerId: OWNER, ownerName: "Matheus", slot: 1, numberLabel: "Número 1", lastMessageAt: "x", lastMessageDirection: "inbound" }], { viewerId: OWNER, formatDate: fmt });
  const row = { id: "c1", full_name: "Maria Aparecida Souza", status: "novo", responsible_user_id: OWNER };
  const report = buildHenryClientsReport({ results: [{ query: { kind: "name", term: "Maria Aparecida Souza", label: "Maria Aparecida Souza" }, rows: [row], details: new Map([["c1", { chat }]]) }], brokerName: () => "Matheus Machado" });
  assert.deepEqual(report.facts[0].cliente.whatsapp, { onde: "no seu WhatsApp pessoal (Número 1)", conversas: chat.conversas });
  assert.ok(report.detail.sections[0].rows.some((item) => item.label === "WhatsApp" && /Seu WhatsApp pessoal \(Número 1\)/.test(item.value)));

  const missing = buildHenryClientsReport({ results: [{ query: { kind: "name", term: "Ana", label: "Ana" }, rows: [{ ...row, id: "c2" }] }] });
  assert.equal(missing.facts[0].cliente.whatsapp.onde, "não conferido");

  const conversation = buildHenryConversationReport({ clientName: "Maria", conversations: [{ last_message_at: "x" }], formatDate: fmt, chat });
  assert.equal(conversation.facts.whatsapp.onde, "no seu WhatsApp pessoal (Número 1)");
});

test("depois do aviso, 'ela está no oficial ou no meu pessoal?' tem a quem se referir (memória do dia → modelo)", () => {
  const events = [{ kind: "new", clientId: "c1", clientName: "Maria Aparecida Souza", receiverId: OWNER, path: [OWNER], at: "2026-10-24T12:00:00Z", waitingMinutes: null }];
  const users = new Map([[OWNER, { id: OWNER, name: "Matheus Machado", gender: "male" }]]);
  const spoken = composeHenryClientAlert(events, { users, ownerId: OWNER, random: () => 0 }).text;
  assert.ok(spoken);
  const context = alertMemoryContext(events, { users, ownerId: OWNER });
  assert.equal(context, `${HENRY_ALERT_MEMORY_MARK} Cliente do aviso: Maria Aparecida Souza (novo, com você).`);
  assert.ok(isSafeToSpeak(context), "a linha de contexto não pode virar o marcador de dado sensível na memória");

  // Mesmo caminho do servidor: rememberHenryAlert → appendDayTurns; answerHenry → modelHistoryFromDay.
  const stored = appendDayTurns(null, "2026-10-24", [{ role: "user", text: context }, { role: "assistant", text: spoken }]);
  const turns = dayTurns(stored, "2026-10-24");
  const { history } = modelHistoryFromDay(turns);
  assert.deepEqual(history.map((turn) => turn.role), ["user", "assistant"]);
  assert.match(history[0].text, /Maria Aparecida Souza/);
  assert.equal(history[1].text, spoken);

  // A pergunta de seguimento liga as ferramentas e o prompt manda resolver "ela" e responder o canal pelo buscar_clientes.
  assert.equal(henryNeedsTools("ela está no oficial ou no meu pessoal?"), true);
  const prompt = buildHenryStaticPrompt();
  assert.match(prompt, /\[Aviso do Henry\]/);
  assert.match(prompt, /whatsapp\.onde/);
  assert.match(prompt, /Nunca diga que não consegue ver/);
});

test("contexto do aviso: transferido, vários clientes, chegada fora, sem telefone/id", () => {
  const users = new Map([[BRUNA, { id: BRUNA, name: "Bruna Souza", gender: "female" }]]);
  const many = alertMemoryContext([
    { kind: "transfer", clientName: "João Pedro Lima", receiverId: BRUNA },
    { kind: "new", clientName: "Ana Paula", receiverId: OWNER },
    { kind: "arrival", userId: BRUNA, name: "Bruna" }
  ], { users, ownerId: OWNER });
  assert.equal(many, `${HENRY_ALERT_MEMORY_MARK} Clientes do aviso: João Pedro Lima (transferido, com a Bruna); Ana Paula (novo, com você).`);
  assert.equal(alertMemoryContext([{ kind: "arrival", userId: BRUNA }], { users }), "");
  assert.equal(many.includes(BRUNA), false);
});

test("leitura do canal reaproveita o escopo e os números do Chat (sem nova definição)", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  const start = chat.indexOf("export async function listClientChatChannels");
  assert.ok(start > 0);
  const body = chat.slice(start, chat.indexOf("\n}\n", start));
  for (const piece of ["chatScope(auth)", "canSeeConversation(", "conversationSessionOwner(", "slotDisplayName(", "isGroupConversation(", '.is("private_at", null)', '.is("deleted_at", null)']) {
    assert.ok(body.includes(piece), piece);
  }
  assert.equal(/\.(insert|update|upsert|delete)\(/.test(body), false, "só leitura");
  const reports = readFileSync(new URL("../lib/henry-reports.js", import.meta.url), "utf8");
  assert.match(reports, /listClientChatChannels\(ids, auth\)/);
  const alerts = readFileSync(new URL("../lib/henry-voice-client-alerts.js", import.meta.url), "utf8");
  assert.match(alerts, /rememberHenryAlert\(auth, alertMemoryContext\(clientEvents/);
});
