import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  UNDECRYPTED_OWN_MESSAGE_TEXT,
  UNDECRYPTED_WEBHOOK_TYPE,
  shouldUpgradeUndecryptedRow,
  undecryptedOwnMessageEvent
} from "../lib/whatsapp-undecrypted-core.mjs";
import { isHumanContactMessage } from "../lib/human-contact-core.mjs";

// [REGRA OFICIAL — dono, 2026-10-19] Saída do corretor (celular/WhatsApp Web) que o CRM não decifrou é prova de envio:
// conta como contato humano (prazo da fila de reativação e da roleta) pelo caminho único registerHumanContact.
const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("só saída do corretor, com id e telefone, vira evento", () => {
  const base = { fromMe: true, waMessageId: "ABC", from: "5514999990000", remoteJid: "5514999990000@s.whatsapp.net", at: "2026-10-19T15:00:00Z" };
  const { event } = undecryptedOwnMessageEvent(base);
  assert.equal(event.fromMe, true);
  assert.equal(event.undecrypted, true);
  assert.equal(event.text, UNDECRYPTED_OWN_MESSAGE_TEXT);
  assert.equal(undecryptedOwnMessageEvent({ ...base, fromMe: false }).skip, "nao_e_saida");
  assert.equal(undecryptedOwnMessageEvent({ ...base, waMessageId: "" }).skip, "sem_id");
  assert.equal(undecryptedOwnMessageEvent({ ...base, from: "" }).skip, "sem_telefone");
  assert.equal(undecryptedOwnMessageEvent({ ...base, remoteJid: "123@g.us" }).skip, "grupo");
});

test("a linha gravada conta como contato humano (mesma régua do CRM)", () => {
  assert.equal(isHumanContactMessage({ direction: "outbound", senderType: "user", status: "sent", messageType: "text", metadata: { undecrypted: true, wa_message_id: "ABC" } }), true);
});

test("conteúdo real que chega depois completa o marcador", () => {
  assert.equal(shouldUpgradeUndecryptedRow({ undecrypted: true }, false), true);
  assert.equal(shouldUpgradeUndecryptedRow({ undecrypted: true }, true), false);
  assert.equal(shouldUpgradeUndecryptedRow({}, false), false);
});

test("webhook e projeção usam o caminho único (recordBrokerAppMessage -> registerHumanContact)", () => {
  const route = read("app/api/webhooks/whatsapp-individual/route.js");
  assert.match(route, /payload\.type === UNDECRYPTED_WEBHOOK_TYPE/);
  assert.match(route, /projectIndividualInboundMessage\(\{ \.\.\.decision\.event, userId, sessionSlot \}\)/);
  assert.equal(UNDECRYPTED_WEBHOOK_TYPE, "undecrypted_message");
  const inbound = read("lib/whatsapp-individual-inbound.js");
  assert.match(inbound, /if \(undecrypted && !fromMe\) return \{ skipped: "nao_decifrada_do_contato" \}/);
  assert.match(inbound, /if \(undecrypted\) metadata\.undecrypted = true;/);
});

test("roleta: restrição aberta também tira da distribuição (JS e SQL no ponto central)", () => {
  const lib = read("lib/lead-distribution.js");
  assert.match(lib, /from\("whatsapp_restrictions"\)\.select\("user_id"\)\.in\("user_id", activeNumberIds\)\.is\("ended_at", null\)/);
  const sql = read("supabase/migrations/20261019235900_roleta_exige_whatsapp_sem_restricao.sql");
  assert.match(sql, /create or replace function public\.roulette_user_extra_eligible/);
  assert.match(sql, /whatsapp_user_has_active_number\(p_user_id\)/);
  assert.match(sql, /r\.ended_at is null/);
  assert.match(sql, /office_presence_ok\(p_user_id\)/);
});
