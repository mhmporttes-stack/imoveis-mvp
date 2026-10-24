// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-24] Ficha direto no WhatsApp: cadastro salvo → abre o WhatsApp direto do botão
// "Enviar informações" (mesmo link do botão "Receber minha simulação"), sem a tela intermediária ("sem essa outra aba");
// tela final só como reserva, sem os valores; botão de reserva continua.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  AUTO_OPEN_WHATSAPP_DELAY_MS,
  FORM_WHATSAPP_FALLBACK_MS,
  RECEIVE_CONTACT_STATE,
  buildReceiveContactQuery,
  buildReceiveSimulationWhatsappUrl,
  resolveFormWhatsappRedirect,
  shouldAutoOpenWhatsapp,
  shouldShowWhatsappFallback
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
  assert.ok(FORM_WHATSAPP_FALLBACK_MS <= 5000);
  assert.ok(AUTO_SEND_DELAY_MS >= 60 * 1000);
});

test("formulário: link direto só com 'ready' e número válido; o resto vai para a reserva", () => {
  const url = resolveFormWhatsappRedirect({ state: RECEIVE_CONTACT_STATE.READY, phone: OFFICIAL_WHATSAPP_DIGITS, registrationId: ID });
  assert.equal(url, buildReceiveSimulationWhatsappUrl(OFFICIAL_WHATSAPP_DIGITS, ID), "MESMO link do botão de reserva");
  assert.equal(resolveFormWhatsappRedirect({ state: RECEIVE_CONTACT_STATE.WAITING, registrationId: ID }), "");
  assert.equal(resolveFormWhatsappRedirect({ state: RECEIVE_CONTACT_STATE.UNAVAILABLE, registrationId: ID }), "");
  assert.equal(resolveFormWhatsappRedirect({}), "", "erro na rota → reserva");
  assert.equal(shouldShowWhatsappFallback("visible"), true, "página ainda visível = WhatsApp não abriu");
  assert.equal(shouldShowWhatsappFallback("hidden"), false);
  assert.equal(buildReceiveContactQuery({ registrationId: "a b", accessToken: "t" }), "?registrationId=a%20b&token=t");
  assert.equal(buildReceiveContactQuery({ brokerRef: "bruna" }), "?ref=bruna");
  assert.equal(buildReceiveContactQuery({}), "");
});

test("formulário: abre direto do botão 'Enviar informações', sem trocar de tela; reserva só se não abrir", () => {
  const form = read("components/simulation-form/SimulationForm.jsx");
  assert.ok(!form.includes('? "invite" : "success"'), "não passa mais pelo convite de preferências antes do WhatsApp");
  assert.match(form, /window\.location\.href = url;/, "location.href (funciona no iPhone, sem window.open)");
  assert.ok(!form.includes("window.open"));
  assert.match(form, /"Abrindo o WhatsApp…"/, "o próprio botão mostra que está abrindo");
  const submit = form.slice(form.indexOf("async function submitForm"), form.indexOf("async function openWhatsappOrFallback"));
  assert.ok(!submit.includes('setCompletionView("success")'), "sucesso do POST não troca para a tela 'Recebemos'");
  assert.ok(submit.indexOf("trackMetaLead") < submit.indexOf("openWhatsappOrFallback"), "Lead do pixel antes de trocar de app");
  assert.match(form, /resolveFormWhatsappRedirect\(/);
  assert.match(form, /FORM_WHATSAPP_FALLBACK_MS/);
  assert.match(form, /<SimulationSuccess [^>]*autoOpenWhatsapp[^>]*whatsappAlreadyOpened=\{whatsappAlreadyOpened\}/);
  const success = read("components/simulation-form/SimulationSuccess.jsx");
  assert.ok(!/EstimateResult|estimate/.test(success.replace(/\/\/.*$/gm, "")), "tela final sem os valores da estimativa");
  assert.match(success, /Recebemos/);
  assert.match(success, /<ReceiveSimulationWhatsappButton [^>]*alreadyOpened=\{whatsappAlreadyOpened\}/);
  const button = read("components/simulation-form/ReceiveSimulationWhatsappButton.jsx");
  assert.match(button, /useRef\(Boolean\(alreadyOpened\)\)/, "reserva depois da tentativa não abre de novo sozinha");
  assert.match(button, /window\.location\.href = whatsappUrl/);
  assert.ok(!button.includes("window.open"));
  assert.match(button, /href=\{whatsappUrl\}/, "botão de reserva usa o MESMO link");
});
