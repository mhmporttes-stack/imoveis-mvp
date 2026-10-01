import test from "node:test";
import assert from "node:assert/strict";
import { deriveStatus, deriveVisualStatus, visualActivityReference, PRESENCE_STATUS } from "../lib/admin-presence-core.mjs";

const NOW = Date.parse("2026-10-01T15:00:00.000Z");
const ago = (minutes) => new Date(NOW - minutes * 60000).toISOString();

test("roleta (deriveStatus): on-line só até 5 min da atividade real", () => {
  assert.equal(deriveStatus(ago(4.9), NOW), PRESENCE_STATUS.ONLINE);
  assert.equal(deriveStatus(ago(5.1), NOW), PRESENCE_STATUS.AWAY);
  assert.equal(deriveStatus(ago(31), NOW), PRESENCE_STATUS.OFFLINE);
  assert.equal(deriveStatus(null, NOW), PRESENCE_STATUS.OFFLINE);
});

test("visual: marca de tolerância recente mantém on-line por +5 min (aparência de antes)", () => {
  // atividade real há 8 min, ação de WhatsApp (grace) no mesmo minuto
  assert.equal(deriveStatus(ago(8), NOW), PRESENCE_STATUS.AWAY);
  assert.equal(deriveVisualStatus(ago(8), ago(8), NOW), PRESENCE_STATUS.ONLINE);
  // depois de 10 min da ação, sai do on-line também no visual
  assert.equal(deriveVisualStatus(ago(11), ago(11), NOW), PRESENCE_STATUS.AWAY);
});

test("visual sem marca de tolerância é igual ao status da roleta", () => {
  for (const minutes of [1, 4, 6, 20, 40]) {
    assert.equal(deriveVisualStatus(ago(minutes), null, NOW), deriveStatus(ago(minutes), NOW));
  }
});

test("referência visual nunca fica antes da atividade real", () => {
  assert.equal(visualActivityReference(ago(1), ago(30)), ago(1));
  assert.equal(visualActivityReference(null, null), null);
});
