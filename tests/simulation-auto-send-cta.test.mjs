// SIM-AUTO-ENVIO — mensagem rica no Oficial (REGRA OFICIAL DE NEGÓCIO — dono, 2026-11-02): imagem de prévia + corpo curto +
// botão "Visualizar simulação" (interactive.cta_url da Cloud API). Sem envio real: payload, limites, fallback (mocks) e código-fonte.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  CTA_BODY_MAX,
  CTA_LABEL_MAX,
  autoSendJourneyText,
  buildAutoSendCtaMessage,
  sendOfficialSimulation
} from "../lib/simulation-auto-send-core.mjs";

const source = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const TOKEN = "uRFzoNt7qUsrcaANuUMg2Z1H";
const LINK = `https://www.matheusmachadoimoveis.com.br/s/${TOKEN}?p=h28mk5`;

test("payload cta_url: header de imagem /og, corpo com saudação, botão 'Visualizar simulação' para o link público", () => {
  const cta = buildAutoSendCtaMessage({ link: LINK, fullName: "MATHEUS machado", greeting: "Boa tarde" });
  assert.deepEqual(cta.message, {
    type: "interactive",
    interactive: {
      type: "cta_url",
      header: { type: "image", image: { link: `https://www.matheusmachadoimoveis.com.br/s/${TOKEN}/og` } },
      body: { text: "Boa tarde, Matheus, sua simulação de financiamento está pronta." },
      action: { name: "cta_url", parameters: { display_text: "Visualizar simulação", url: LINK } }
    }
  });
  assert.ok(!JSON.stringify(cta.message).includes("/admin"), "nunca link interno");
});

test("sem nome utilizável: saudação com ponto de exclamação; nunca nome de teste/lixo", () => {
  assert.equal(buildAutoSendCtaMessage({ link: LINK, fullName: "", greeting: "Bom dia" }).bodyText, "Bom dia! Sua simulação de financiamento está pronta.");
  assert.equal(buildAutoSendCtaMessage({ link: LINK, fullName: "Cliente 123", greeting: "Boa noite" }).bodyText, "Boa noite! Sua simulação de financiamento está pronta.");
});

test("limites da Meta: botão até 20 caracteres, corpo até 1024; o corpo nunca passa disso", () => {
  const cta = buildAutoSendCtaMessage({ link: LINK, fullName: "Elaine dos Santos", greeting: "Bom dia" });
  assert.equal(CTA_LABEL_MAX, 20);
  assert.equal(CTA_BODY_MAX, 1024);
  assert.ok([...cta.label].length <= CTA_LABEL_MAX);
  assert.ok([...cta.bodyText].length <= CTA_BODY_MAX);
  assert.equal(cta.label, "Visualizar simulação");
  // Saudação absurda acima do limite: não monta (cai no texto), em vez de a Meta recusar.
  assert.equal(buildAutoSendCtaMessage({ link: LINK, fullName: "Elaine", greeting: "x".repeat(1100) }), null);
});

test("link que não é /s/<token> do próprio site não vira botão (fica em texto)", () => {
  assert.equal(buildAutoSendCtaMessage({ link: "https://exemplo.com/s/" + TOKEN, fullName: "Elaine", greeting: "Bom dia" }), null);
  assert.equal(buildAutoSendCtaMessage({ link: "https://www.matheusmachadoimoveis.com.br/admin/clientes", fullName: "Elaine", greeting: "Bom dia" }), null);
  assert.equal(buildAutoSendCtaMessage({ link: "", fullName: "Elaine", greeting: "Bom dia" }), null);
});

test("envio: botão aceito = formato cta com metadata.link; texto do link só como reserva", async () => {
  const cta = buildAutoSendCtaMessage({ link: LINK, fullName: "Elaine", greeting: "Bom dia" });
  const calls = [];
  const result = await sendOfficialSimulation({
    cta, text: LINK,
    sendCta: async (message) => { calls.push(["cta", message.interactive.type]); return { messageId: "wamid.1" }; },
    sendText: async () => { calls.push(["text"]); return { messageId: "wamid.2" }; }
  });
  assert.deepEqual(calls, [["cta", "cta_url"]]);
  assert.equal(result.format, "cta");
  assert.equal(result.messageId, "wamid.1");
  assert.equal(result.body, "Bom dia, Elaine, sua simulação de financiamento está pronta.");
  assert.deepEqual(result.extraMetadata.link, { label: "Visualizar simulação", url: LINK });
});

test("Meta recusou o botão (erro com metaRejected): cai no link em texto, uma vez, e registra o motivo", async () => {
  const cta = buildAutoSendCtaMessage({ link: LINK, fullName: "Elaine", greeting: "Bom dia" });
  const calls = [];
  const result = await sendOfficialSimulation({
    cta, text: LINK,
    sendCta: async () => { calls.push("cta"); throw Object.assign(new Error("(#131009) Parameter value is not valid"), { metaRejected: true }); },
    sendText: async (text) => { calls.push(`text:${text}`); return { messageId: "wamid.2" }; }
  });
  assert.deepEqual(calls, ["cta", `text:${LINK}`]);
  assert.equal(result.format, "text_fallback");
  assert.equal(result.messageId, "wamid.2");
  assert.equal(result.body, undefined, "o corpo registrado continua sendo o link");
  assert.match(result.extraMetadata.cta_rejected, /131009/);
});

test("falha de rede/tempo esgotado NÃO cai em texto (poderia duplicar a mensagem): o erro sobe e a reserva marca a falha", async () => {
  const cta = buildAutoSendCtaMessage({ link: LINK, fullName: "Elaine", greeting: "Bom dia" });
  let textCalls = 0;
  await assert.rejects(
    sendOfficialSimulation({
      cta, text: LINK,
      sendCta: async () => { throw new Error("The operation was aborted due to timeout"); },
      sendText: async () => { textCalls += 1; return { messageId: "x" }; }
    }),
    /timeout/
  );
  assert.equal(textCalls, 0);
});

test("sem botão possível: só o link em texto", async () => {
  const result = await sendOfficialSimulation({ cta: null, text: LINK, sendCta: async () => assert.fail("sem cta"), sendText: async () => ({ messageId: "wamid.3" }) });
  assert.equal(result.format, "text");
  assert.deepEqual(result.extraMetadata, {});
});

test("linha do tempo registra o formato que saiu", () => {
  assert.match(autoSendJourneyText("sent", { channel: "official", format: "cta" }), /pelo WhatsApp oficial \(imagem de prévia \+ botão "Visualizar simulação"\)/);
  assert.match(autoSendJourneyText("sent", { channel: "official", format: "text_fallback" }), /link em texto/);
  assert.equal(autoSendJourneyText("sent", { channel: "broker" }), "Simulação enviada automaticamente pelo WhatsApp do corretor");
});

test("ligação no código: Oficial usa o botão na MESMA reserva por cadastro; só o Oficial; travas intactas", () => {
  const server = source("lib/simulation-auto-send.js");
  const official = server.split("async function sendOfficial(")[1].split("async function sendIndividual(")[0];
  assert.match(official, /buildAutoSendCtaMessage\(\{ link, fullName: registration\.full_name, greeting: getTimeGreeting\(\) \}\)/);
  assert.match(official, /sendOfficialSimulation\(/);
  assert.match(official, /claimKey: autoSendClaimKey\(registration\.id\)/);
  assert.equal((official.match(/sendReservedAutomationMessage\(/g) || []).length, 1, "uma única reserva (nunca dois envios)");
  // Individual (Baileys) continua só com o link (a prévia sai do link-preview do serviço); janela fechada não manda interativo.
  const individual = server.split("async function sendIndividual(")[1].split("async function handleCase(")[0];
  assert.doesNotMatch(individual, /cta_url|sendWhatsappMessagePayload|buildAutoSendCtaMessage/);
  // O erro 'metaRejected' é marcado só em respostas de erro da Meta (não em rede/tempo esgotado).
  assert.match(source("lib/whatsapp-master.js"), /metaRejected: true/);
  assert.match(source("lib/whatsapp-form-reminder.js"), /\.\.\.sent\.extraMetadata/);
});
