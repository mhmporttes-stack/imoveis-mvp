import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  PRESENTATION_SENT_EVENT,
  buildPresentationSendMessage,
  canSendPresentationTo
} from "../lib/simulation-presentation-send.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

test("mensagem da apresentacao: somente o link (sem texto) para abrir a pre-visualizacao", () => {
  const message = buildPresentationSendMessage({ fullName: "Maria da Silva Souza", link: "https://x.com.br/s/abc" });
  assert.equal(message, "https://x.com.br/s/abc");
  assert.equal(buildPresentationSendMessage({ link: "  L  " }), "L");
});

test("arquivado e nao contactar nao recebem; sem cadastro e demais status recebem", () => {
  assert.equal(canSendPresentationTo(null), true);
  assert.equal(canSendPresentationTo({ status: "in_service" }), true);
  assert.equal(canSendPresentationTo({ status: "archived" }), false);
  assert.equal(canSendPresentationTo({ status: "do_not_contact" }), false);
});

test("gerador: envio só pelo link da apresentação (dono, 2026-10-09); PDF/imagem ficam só para baixar", () => {
  const src = read("components/SimulationGenerator.jsx");
  assert.match(src, /value: "presentation", label: "Link \(apresentação\)"/);
  assert.doesNotMatch(src, /\{ value: "pdf", label: "PDF" \}/);
  assert.match(src, /useState\("presentation"\)/);
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

test("prévia grande no WhatsApp: imagem /og cacheável no CDN e aquecida ao preparar o envio", () => {
  const proxy = read("proxy.js");
  assert.match(proxy, /cacheableShareImage: presentationMatch\[2\] === "og"/);
  assert.match(proxy, /cacheableShareImage \? "public, max-age=300, s-maxage=86400/);
  assert.match(read("lib/simulation-presentation-share.mjs"), /"Cache-Control": "public, max-age=300, s-maxage=86400/);
  assert.match(read("app/api/admin/simulacoes/[id]/apresentacao/route.js"), /fetch\(`\$\{link\}\/og`/);
});
