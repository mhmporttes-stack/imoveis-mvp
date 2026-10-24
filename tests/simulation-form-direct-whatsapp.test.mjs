// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] Ficha direto no WhatsApp: cadastro salvo → abre sozinho o WhatsApp (mesmo
// link do botão "Receber minha simulação"), tela final sem os valores, botão de reserva continua.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUTO_OPEN_WHATSAPP_DELAY_MS,
  RECEIVE_CONTACT_STATE,
  buildReceiveSimulationWhatsappUrl,
  shouldAutoOpenWhatsapp
} from "../lib/receive-simulation-contact.mjs";
import { FORM_COMPLETION_MESSAGE, isFormCompletionMessage } from "../lib/whatsapp-form-completion.mjs";
import { extractContactCode } from "../lib/whatsapp-contact-code-core.mjs";
import { OFFICIAL_WHATSAPP_DIGITS } from "../lib/official-whatsapp.mjs";
import { AUTO_SEND_DELAY_MS } from "../lib/simulation-auto-send-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const ID = "1a2b3c4d-0000-4000-8000-000000000000";

test("link: número oficial + mensagem pronta do pós-formulário + código do atendimento", () => {
  const url = buildReceiveSimulationWhatsappUrl(OFFICIAL_WHATSAPP_DIGITS, ID);
  assert.ok(url.startsWith(`https://wa.me/${OFFICIAL_WHATSAPP_DIGITS}?text=`));
  const text = decodeURIComponent(url.split("?text=")[1]);
  assert.ok(text.startsWith(FORM_COMPLETION_MESSAGE));
  assert.ok(isFormCompletionMessage(text), "o webhook reconhece a mensagem do pós-formulário");
  assert.equal(extractContactCode(text), "1a2b3c4d", "o webhook liga a conversa ao cadastro pelo código");
  assert.equal(buildReceiveSimulationWhatsappUrl("", ID), "");
});

test("abre sozinho só com link pronto, uma vez, e só quando o formulário pediu", () => {
  const ready = { autoOpen: true, state: RECEIVE_CONTACT_STATE.READY, phone: OFFICIAL_WHATSAPP_DIGITS };
  assert.equal(shouldAutoOpenWhatsapp(ready), true);
  assert.equal(shouldAutoOpenWhatsapp({ ...ready, alreadyOpened: true }), false);
  assert.equal(shouldAutoOpenWhatsapp({ ...ready, autoOpen: false }), false, "vitrine/outras telas nunca abrem sozinhas");
  assert.equal(shouldAutoOpenWhatsapp({ ...ready, state: RECEIVE_CONTACT_STATE.WAITING, phone: "" }), false, "reserva da WA-10: espera");
  assert.equal(shouldAutoOpenWhatsapp({ ...ready, state: RECEIVE_CONTACT_STATE.UNAVAILABLE, phone: "" }), false, "reserva da WA-10: indisponível");
  assert.equal(shouldAutoOpenWhatsapp({ ...ready, state: "loading" }), false);
  assert.equal(shouldAutoOpenWhatsapp({ ...ready, phone: "123" }), false);
});

test("a abertura acontece bem antes de o envio automático decidir o canal (sem mandar pelo número do dono antes da hora)", () => {
  assert.ok(AUTO_OPEN_WHATSAPP_DELAY_MS <= 3000);
  assert.ok(AUTO_SEND_DELAY_MS >= 60 * 1000);
});

test("formulário: cadastro salvo vai direto à tela final com abertura automática; tela sem valores; botão continua", () => {
  const form = read("components/simulation-form/SimulationForm.jsx");
  assert.match(form, /setCompletionView\("success"\);/);
  assert.ok(!form.includes('? "invite" : "success"'), "não passa mais pelo convite de preferências antes do WhatsApp");
  assert.match(form, /<SimulationSuccess [^>]*autoOpenWhatsapp/);
  const success = read("components/simulation-form/SimulationSuccess.jsx");
  assert.ok(!/EstimateResult|estimate/.test(success.replace(/\/\/.*$/gm, "")), "tela final sem os valores da estimativa");
  assert.match(success, /Recebemos/);
  assert.match(success, /<ReceiveSimulationWhatsappButton /);
  const button = read("components/simulation-form/ReceiveSimulationWhatsappButton.jsx");
  assert.match(button, /window\.location\.href = whatsappUrl/, "location.href (funciona no iPhone, sem window.open)");
  assert.ok(!button.includes("window.open"));
  assert.match(button, /href=\{whatsappUrl\}/, "botão de reserva usa o MESMO link");
});
