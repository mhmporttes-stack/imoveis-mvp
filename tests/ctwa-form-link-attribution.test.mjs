// Fluxo completo da atribuição do Fluxo "Anúncio WhatsApp — formulário direto" (2026-10-01):
// clique no anúncio (referral) -> {{anuncio_id}} -> link do botão -> UTMs do formulário ->
// origem gravada (buildLeadOrigin) -> evidência de mídia paga -> Guia de Atendimento de lead.
import test from "node:test";
import assert from "node:assert/strict";
import { buildOutgoing, directSimulationLink } from "../lib/whatsapp-flow-core.mjs";
import { adIdFromReferral } from "../lib/whatsapp-referral.mjs";
import { buildLeadOrigin, hasPaidMediaEvidence } from "../lib/lead-origin.js";
import { classifyGuideKind } from "../lib/attendance-guide-core.mjs";

// Nó real do Fluxo (linkUrl já com o acréscimo de utm_content={{anuncio_id}}).
const formNode = {
  id: "form",
  type: "message",
  data: {
    mode: "link",
    text: "É rápido, leva cerca de 2 minutos.",
    linkLabel: "Preencher formulário",
    linkUrl: "{{link_simulacao}}&utm_source=whatsapp&utm_medium=anuncio&utm_campaign=ctwa_formulario&utm_content={{anuncio_id}}"
  }
};
const brokerLink = directSimulationLink("https://www.matheusmachadoimoveis.com.br/simulacao?ref=corretor-teste");

function formSubmission(url) {
  const params = new URL(url).searchParams;
  const attribution = Object.fromEntries(["utm_source", "utm_medium", "utm_campaign", "utm_content", "utm_term"].map((key) => [key, params.get(key) || ""]));
  return { ref: params.get("ref"), attribution };
}

test("com anúncio identificado: o link leva o ID do anúncio e o cadastro fica atribuído e com guia de lead", () => {
  const vars = { link_simulacao: brokerLink, anuncio_id: adIdFromReferral({ source_type: "ad", source_id: "52547581247353", ctwa_clid: "abc" }) };
  const url = buildOutgoing(formNode, vars).display.link.url;
  assert.match(url, /utm_campaign=ctwa_formulario&utm_content=52547581247353$/);
  assert.match(url, /[?&]jornada=simulacao/);
  assert.match(url, /[?&]ref=corretor-teste/);

  const { ref, attribution } = formSubmission(url);
  const origin = buildLeadOrigin({ direct: true, ref, attribution });
  assert.equal(origin.kind, "broker_link"); // prioridade preservada
  assert.equal(origin.metadata.utm_content, "52547581247353"); // ID do anúncio na origem (Q2 usa utm_content quando pago)
  assert.equal(origin.metadata.paid_media, true);
  assert.equal(origin.metadata.paid_channel, "whatsapp_ad");
  assert.equal(hasPaidMediaEvidence(origin.kind, origin.metadata), true);
  assert.equal(classifyGuideKind({ acquisitionKind: origin.kind, paidMediaEvidence: hasPaidMediaEvidence(origin.kind, origin.metadata) }), "lead");
});

test("sem ID do anúncio: o Fluxo continua funcionando, UTMs atuais preservadas, sem utm_content", () => {
  for (const referral of [undefined, null, { source_type: "post", source_id: "123456789" }, { source_type: "ad" }]) {
    const vars = { link_simulacao: brokerLink, anuncio_id: adIdFromReferral(referral) };
    const out = buildOutgoing(formNode, vars);
    const url = out.display.link.url;
    assert.equal(out.message.type, "interactive");
    assert.ok(url.startsWith("https://"), url);
    assert.match(url, /utm_source=whatsapp&utm_medium=anuncio&utm_campaign=ctwa_formulario/);
    const { ref, attribution } = formSubmission(url);
    const origin = buildLeadOrigin({ direct: true, ref, attribution });
    assert.equal("utm_content" in origin.metadata, false); // UTM vazia descartada
    assert.equal(origin.metadata.paid_channel, "whatsapp_ad");
    assert.equal(classifyGuideKind({ acquisitionKind: origin.kind, paidMediaEvidence: hasPaidMediaEvidence(origin.kind, origin.metadata) }), "lead");
  }
});

test("link pessoal sem nenhuma evidência paga continua com guia orgânico", () => {
  const origin = buildLeadOrigin({ direct: true, ref: "corretor-teste", attribution: {} });
  assert.equal(classifyGuideKind({ acquisitionKind: origin.kind, paidMediaEvidence: hasPaidMediaEvidence(origin.kind, origin.metadata) }), "organic");
});
