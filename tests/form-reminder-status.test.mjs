import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

// Caso Keite (2026-10-10): lembrete do formulário entregue/lido pela Meta ficava "enviada" (1 tique) no Chat porque o
// id da Meta fica em metadata.cloud_message_id, e o status só era procurado por meta_message_id.
test("status da Meta também acha o lembrete pelo cloud_message_id", () => {
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /\.in\("metadata->>cloud_message_id", missing\)/);
  const reminder = readFileSync(new URL("../lib/whatsapp-form-reminder.js", import.meta.url), "utf8");
  assert.match(reminder, /cloud_message_id: sent\.messageId/);
});
