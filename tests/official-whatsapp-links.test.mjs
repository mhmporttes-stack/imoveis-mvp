import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { OFFICIAL_WHATSAPP_DIGITS, officialWhatsappUrl } from "../lib/official-whatsapp.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

// Todo link voltado ao cliente leva ao número OFICIAL (dono, 2026-10-09).
test("número oficial e URL", () => {
  assert.equal(OFFICIAL_WHATSAPP_DIGITS, "5514991056706");
  assert.equal(officialWhatsappUrl(), "https://wa.me/5514991056706");
  assert.equal(officialWhatsappUrl("Oi tudo bem"), "https://wa.me/5514991056706?text=Oi%20tudo%20bem");
});

test("botão Receber minha simulação, Minha Jornada e o 'te chamar' do Chat usam o número oficial", () => {
  const route = read("app/api/whatsapp-contact/route.js");
  assert.match(route, /phone: OFFICIAL_WHATSAPP_DIGITS/);
  assert.doesNotMatch(route, /profile\.phone|toWhatsAppDigits/);
  assert.match(read("lib/client-journey.js"), /publicJourneyDTO\(client, state, config, OFFICIAL_WHATSAPP_DIGITS, settings\.copy\)/);
  const chat = read("components/WhatsappChat.jsx");
  assert.match(chat, /const callLink = `https:\/\/wa\.me\/\$\{OFFICIAL_WHATSAPP_DIGITS\}/);
  assert.match(chat, /replace\(\/\D\/g, ""\)/, "telefone do cliente: só dígitos");
});

// Dono, 2026-10-11: o botão tinha sumido da tela final (04/10) e nenhum cliente iniciava conversa — volta e fica.
test("tela final do formulário mostra o botão Receber minha simulação", () => {
  const success = readFileSync(new URL("../components/simulation-form/SimulationSuccess.jsx", import.meta.url), "utf8");
  assert.match(success, /<ReceiveSimulationWhatsappButton accessToken=\{accessToken\} brokerRef=\{brokerRef\} registrationId=\{registrationId\} \/>/);
  const form = readFileSync(new URL("../components/simulation-form/SimulationForm.jsx", import.meta.url), "utf8");
  assert.match(form, /<SimulationSuccess accessToken=\{registrationContext\.preferencesAccessToken\}/);
});
