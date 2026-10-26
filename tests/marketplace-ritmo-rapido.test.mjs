// Ritmo mais rápido do Chat do Marketplace (REGRA OFICIAL — dono, 2026-10-26, extensão 1.9.9): "Pode aumentar os envios
// por hora para 40. Eu quero que as respostas acumuladas saiam uma a cada 30 segundos."
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  AUTO_REPLY_SPACING_MS,
  DEFAULT_CHAT_SETTINGS,
  autoReplySpacingMs,
  evaluateOutboxGate,
  normalizeChatSettings,
  pickOutboxCandidate
} from "../lib/marketplace-chat-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("limite por hora: 40 de padrão; teto de 40 bloqueia (cada tentativa conta)", () => {
  assert.equal(DEFAULT_CHAT_SETTINGS.maxSendsPerHour, 40);
  assert.equal(normalizeChatSettings({}).maxSendsPerHour, 40);
  // Valor gravado na tela continua prevalecendo (crm_settings `marketplace_chat`).
  assert.equal(normalizeChatSettings({ maxSendsPerHour: 20 }).maxSendsPerHour, 20);
  assert.equal(evaluateOutboxGate({ sentLastHour: 39, attemptsLastHour: 39 }).allowed, true);
  assert.equal(evaluateOutboxGate({ sentLastHour: 0, attemptsLastHour: 40 }).reason, "limite_por_hora");
  assert.equal(evaluateOutboxGate({ sentLastHour: 40, attemptsLastHour: 0 }).reason, "limite_por_hora");
});

test("automáticas acumuladas: 30 s fixos entre uma e outra; resposta do corretor passa na frente", () => {
  assert.equal(AUTO_REPLY_SPACING_MS, 30 * 1000);
  assert.equal(autoReplySpacingMs(DEFAULT_CHAT_SETTINGS.maxSendsPerHour), 30 * 1000);
  const now = new Date("2026-10-27T11:00:00Z");
  const auto = { id: "a", conversation_id: "c1", auto_kind: "availability", send_after: "2026-10-27T10:59:00Z" };
  const human = { id: "h", conversation_id: "c2", sender_user_id: "u1", created_at: "2026-10-27T10:59:30Z" };
  assert.equal(pickOutboxCandidate([auto, human], { now }).id, "h");
});

test("fila sem resposta pronta: o CRM avisa a hora da próxima automática (`nextAt`) para a extensão esperar", () => {
  const source = read("lib/marketplace-chat.js");
  assert.match(source, /\.gt\("send_after", now\.toISOString\(\)\)\.order\("send_after", \{ ascending: true \}\)\.limit\(1\)/);
  assert.match(source, /return \{ message: null, reason: "fila_vazia", nextAt: /);
  // Limite por hora atingido: sai antes, sem `nextAt` (a extensão não espera).
  assert.match(source, /if \(!gate\.allowed\) return \{ message: null, reason: gate\.reason \};/);
});
