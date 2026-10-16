// Sino do cabeçalho com TODAS as notificações (pedido do dono, 2026-10-16): alertas da Central + notificações do sino antigo.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = (file) => readFileSync(new URL(`../${file}`, import.meta.url), "utf8");

test("o histórico do sino soma os alertas da Central e as notificações (cliente novo, atividade, transferência) do próprio usuário", () => {
  const code = read("lib/crm-alerts.js");
  assert.ok(code.includes("const notificationItems = await listMyBellNotifications(auth, since);"));
  assert.ok(code.includes("[...alertItems, ...notificationItems]"));
  assert.ok(code.includes('.from("crm_notifications")') && code.includes('.eq("recipient_user_id", me)'));
  for (const type of ["new_client", "scheduled_activity", "clients_transferred"]) assert.ok(code.includes(type), type);
  assert.ok(code.includes("const me = recipientOf(auth);"), '"Alterar conta" nunca lê as notificações da pessoa emulada');
  assert.ok(code.includes("return [];\n  }\n}"), "falha na leitura = só os alertas");
});

test("tela: abrir uma notificação do sino antigo marca como lida (mesma rota da lista) e desconta o ponto vermelho", () => {
  const ui = read("components/alerts/NotificationHistoryButton.jsx");
  assert.ok(ui.includes('item.source === "notification" && !item.acknowledged && item.notificationId'));
  assert.ok(ui.includes("fetch(`/api/crm-notifications/${item.notificationId}`, { method: \"PATCH\" })"));
  assert.ok(ui.includes("setPending((value) => Math.max(0, value - 1));"));
  assert.ok(ui.includes('item.source === "notification" ? " · não lida" : " · não confirmada"'));
  assert.ok(ui.includes("item.label || KIND_LABEL[item.kind]"));
});
