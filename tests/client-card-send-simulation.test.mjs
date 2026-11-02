import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  SEND_SIM_CHANNEL_CRM_CHAT, SEND_SIM_CHANNEL_EXTERNAL, SEND_SIM_CHANNEL_OFFICIAL, SEND_SIM_HINT_NO_SIMULATION,
  clientHasSendableSimulation, decideSendSimulationChannel, sendSimulationButtonState
} from "../lib/client-card-send-simulation-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const done = { status: "completed", completed: true, summary: { purchasePower: 200000 }, simulation: { id: "s1" }, registration: { id: "r1", phone: "(14) 99765-4321", responsibleUserId: "u1" } };

test("estado do botao: pronto, sem simulacao, bloqueado, sem telefone, WhatsApp bloqueado", () => {
  assert.deepEqual(sendSimulationButtonState({ client: done }), { visible: true, disabled: false, reason: "ready", hint: "" });
  const none = sendSimulationButtonState({ client: { ...done, completed: false, summary: null } });
  assert.equal(none.reason, "no_simulation");
  assert.equal(none.needsSimulation, true);
  assert.equal(none.hint, SEND_SIM_HINT_NO_SIMULATION);
  assert.equal(sendSimulationButtonState({ client: { ...done, status: "archived" } }).disabled, true);
  assert.equal(sendSimulationButtonState({ client: { ...done, status: "do_not_contact" } }).reason, "blocked");
  assert.equal(sendSimulationButtonState({ client: { ...done, registration: { ...done.registration, phone: "" } } }).reason, "no_phone");
  assert.equal(sendSimulationButtonState({ client: done, whatsappBlocked: true }).visible, false);
});

test("simulacao automatica do site conta como simulacao feita; sem id de simulacao nao", () => {
  assert.equal(clientHasSendableSimulation({ ...done, completed: false, summary: { automatic: { purchasePower: 1 } } }), true);
  assert.equal(clientHasSendableSimulation({ ...done, simulation: null }), false);
});

test("canal: Oficial com janela aberta > Chat do CRM (conectado) > WhatsApp/app (fora do ar, sem conexao, estado desconhecido)", () => {
  const wa = { userId: "u1", sessionStatus: "connected" };
  const base = { client: done, phone: done.registration.phone, device: "mobile" };
  assert.equal(decideSendSimulationChannel({ ...base, waState: wa, officialConversationId: "c1" }), SEND_SIM_CHANNEL_OFFICIAL);
  assert.equal(decideSendSimulationChannel({ ...base, waState: wa }), SEND_SIM_CHANNEL_CRM_CHAT);
  for (const sessionStatus of ["disconnected", "failed", "qr_required", null]) {
    assert.equal(decideSendSimulationChannel({ ...base, waState: { ...wa, sessionStatus } }), SEND_SIM_CHANNEL_EXTERNAL, String(sessionStatus));
  }
  assert.equal(decideSendSimulationChannel({ ...base, waState: null }), SEND_SIM_CHANNEL_EXTERNAL);
  assert.equal(decideSendSimulationChannel({ ...base, waState: { ...wa, userId: "outro" } }), SEND_SIM_CHANNEL_EXTERNAL);
  assert.equal(decideSendSimulationChannel({ ...base, waState: { ...wa, chatDisabled: true } }), SEND_SIM_CHANNEL_EXTERNAL);
  assert.equal(decideSendSimulationChannel({ ...base, waState: { ...wa, sessionStatus: "disconnected", printedListMode: true } }), SEND_SIM_CHANNEL_EXTERNAL);
});

test("o botao usa a mesma rota/acoes do envio atual e nao cria caminho novo; card com Enviar simulacao ao lado do WhatsApp", () => {
  const button = read("components/clients/ClientCardSendSimulationButton.jsx");
  assert.match(button, /\/apresentacao/);
  assert.match(button, /"enviar-preparar"/);
  assert.match(button, /"enviar-registrar"/);
  assert.match(button, /confirmAction/);
  assert.match(button, /Enviar simulação/);
  const card = read("components/clients/ClientCard.jsx");
  assert.ok(card.indexOf("list.openWhatsApp(client)") < card.indexOf("<ClientCardSendSimulationButton"));
  assert.ok(card.indexOf("<ClientCardSendSimulationButton") < card.indexOf("list.openValues(client)"));
  assert.match(card, /className=\{COMPACT_BUTTON\} \/>/);
});
