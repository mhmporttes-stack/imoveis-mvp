// Foto do cliente no Chat (2026-10-09).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { contactPhotoViewUrl, pickPhotoSession, shouldRefreshContactPhoto, CONTACT_PHOTO_BATCH } from "../lib/whatsapp-contact-photo-core.mjs";

const NOW = Date.parse("2026-10-09T12:00:00Z");
const DAY = 24 * 3600 * 1000;

test("busca quem nunca foi consultado e refresca só depois de 7 dias", () => {
  assert.equal(shouldRefreshContactPhoto(null, NOW), true);
  assert.equal(shouldRefreshContactPhoto(new Date(NOW - 3 * DAY).toISOString(), NOW), false);
  assert.equal(shouldRefreshContactPhoto(new Date(NOW - 8 * DAY).toISOString(), NOW), true);
  assert.ok(CONTACT_PHOTO_BATCH <= 5, "poucas por vez");
});

test("usa só WhatsApp conectado, no número da própria conversa", () => {
  const rows = [{ slot: 1, status: "disconnected" }, { slot: 2, status: "connected" }];
  assert.equal(pickPhotoSession([{ userId: "u", rows, slot: 1 }]), null);
  assert.deepEqual(pickPhotoSession([{ userId: "u", rows, slot: 2 }]), { userId: "u", slot: 2 });
  assert.deepEqual(pickPhotoSession([{ userId: "u", rows, slot: null }]), { userId: "u", slot: 2 });
  assert.equal(pickPhotoSession([]), null);
});

test("foto guardada vira a rota autenticada; vazio continua vazio", () => {
  assert.equal(contactPhotoViewUrl("c1", "storage:contact-photos/c1.jpg#123"), "/api/admin/whatsapp-chat/conversations/c1/photo?v=123");
  assert.equal(contactPhotoViewUrl("c1", ""), "");
  assert.equal(contactPhotoViewUrl("c1", null), "");
});

test("rota da foto tem guard e respeita o escopo da conversa; serviço só lê a foto", () => {
  const route = readFileSync(new URL("../app/api/admin/whatsapp-chat/conversations/[id]/photo/route.js", import.meta.url), "utf8");
  assert.match(route, /const auth = await requireAdminApi\(request\);\n\s+if \(!auth\.ok\)/);
  const chat = readFileSync(new URL("../lib/whatsapp-chat.js", import.meta.url), "utf8");
  assert.match(chat, /export async function getChatContactPhotoUrl\(id, auth\) \{\n\s+const conversation = await loadConversation\(id, auth/);
  const service = readFileSync(new URL("../whatsapp-individual-service/src/sessions.js", import.meta.url), "utf8");
  const fn = service.slice(service.indexOf("export async function getProfilePictureUrl"));
  assert.doesNotMatch(fn, /sendMessage/);
});
