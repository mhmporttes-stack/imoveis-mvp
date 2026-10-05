import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRESENTATION_SENT_EVENT,
  buildPresentationSendMessage,
  canSendPresentationTo
} from "../lib/simulation-presentation-send.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("mensagem da apresentacao: so o primeiro nome e o link", () => {
  const message = buildPresentationSendMessage({ fullName: "Maria da Silva Souza", link: "https://x.com.br/s/abc" });
  assert.equal(message, "Olá, Maria! Preparei a sua simulação de financiamento de um jeito interativo: https://x.com.br/s/abc");
  assert.ok(!message.includes("Silva"));
});

test("mensagem sem nome nao quebra", () => {
  assert.equal(buildPresentationSendMessage({ fullName: "  ", link: "L" }), "Olá! Preparei a sua simulação de financiamento de um jeito interativo: L");
});

test("arquivado e nao contactar nao recebem; sem cadastro e demais status recebem", () => {
  assert.equal(canSendPresentationTo(null), true);
  assert.equal(canSendPresentationTo({ status: "in_service" }), true);
  assert.equal(canSendPresentationTo({ status: "archived" }), false);
  assert.equal(canSendPresentationTo({ status: "do_not_contact" }), false);
});

test("gerador: terceira opcao Apresentacao no seletor; PDF e imagem seguem pelo mesmo fluxo", () => {
  const src = read("components/SimulationGenerator.jsx");
  assert.match(src, /value: "presentation", label: "Apresentação"/);
  assert.match(src, /sendFormat === "presentation"/);
  assert.match(src, /enviar-preparar/);
  assert.match(src, /enviar-registrar/);
  // o fluxo de PDF/imagem continua intacto
  assert.match(src, /const format = sendFormat === "image" \? "image" : "pdf";/);
  assert.match(src, /createSimulationPdfUrl\(form, simulationAssets, propertyImageDataUris\)/);
});

test("rota: enviar passa pelo guard e escopo da simulacao, bloqueia arquivado/DNC e nunca envia", () => {
  const src = read("app/api/admin/simulacoes/[id]/apresentacao/route.js");
  assert.match(src, /requireAdminApi/);
  assert.match(src, /getSimulation\(\(await params\)\.id, auth\)/);
  assert.match(src, /canSendPresentationTo\(simulation\.registration\)/);
  assert.match(src, /status: 409/);
  assert.match(src, /ensurePresentation/);
});

test("jornada: evento presentation_sent tem rotulo e categoria", () => {
  const src = read("components/ClientJourneyActions.jsx");
  assert.match(src, new RegExp(`${PRESENTATION_SENT_EVENT}: "atividades"`));
  assert.match(src, /case "presentation_sent"/);
});
