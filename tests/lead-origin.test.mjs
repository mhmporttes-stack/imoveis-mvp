import test from "node:test";
import assert from "node:assert/strict";
import { buildLeadOrigin, classifyPaidMedia } from "../lib/lead-origin.js";

const META_STANDARD = { utm_source: "fb", utm_medium: "paid", utm_campaign: "120210000000001", utm_term: "120210000000002", utm_content: "120210000000003" };
const CTWA_LEGACY = { utm_source: "whatsapp", utm_medium: "anuncio", utm_campaign: "ctwa_formulario" };

test("classifyPaidMedia: valores pagos atuais continuam reconhecidos", () => {
  for (const medium of ["cpc", "ppc", "paid", "paid_social", "paid_search", "PAID", "Cpc"]) {
    assert.equal(classifyPaidMedia({ utm_medium: medium }).paid, true, medium);
  }
});

test("classifyPaidMedia: anuncio/anúncio reconhecido (case-insensitive, com e sem acento)", () => {
  for (const medium of ["anuncio", "anúncio", "ANUNCIO", "Anúncio", "ANÚNCIO"]) {
    assert.equal(classifyPaidMedia({ utm_medium: medium }).paid, true, medium);
  }
});

test("classifyPaidMedia: valores sem evidência continuam orgânicos", () => {
  for (const medium of ["social", "organic", "whatsapp", "", undefined, "anuncios", " paid", "email"]) {
    assert.deepEqual(classifyPaidMedia({ utm_medium: medium }), { paid: false, channel: null }, String(medium));
  }
  assert.deepEqual(classifyPaidMedia(), { paid: false, channel: null });
  // ctwa_formulario sem medium pago não ganha canal
  assert.deepEqual(classifyPaidMedia({ utm_medium: "social", utm_campaign: "ctwa_formulario" }), { paid: false, channel: null });
});

test("classifyPaidMedia: canal pago só com evidência", () => {
  assert.equal(classifyPaidMedia(CTWA_LEGACY).channel, "whatsapp_ad");
  assert.equal(classifyPaidMedia({ utm_source: "fb", utm_medium: "paid" }).channel, "meta_site");
  assert.equal(classifyPaidMedia({ utm_source: "IG", utm_medium: "paid" }).channel, "meta_site");
  assert.equal(classifyPaidMedia({ utm_source: "google", utm_medium: "cpc" }).channel, null);
  assert.equal(classifyPaidMedia({ utm_medium: "anuncio", utm_campaign: "outra" }).channel, null);
});

test("padrão atual (fb/ig + paid): kind/label/metadata originais intactos + chaves novas", () => {
  for (const source of ["fb", "ig"]) {
    const origin = buildLeadOrigin({ attribution: { ...META_STANDARD, utm_source: source } });
    assert.equal(origin.kind, "paid_link");
    assert.equal(origin.label, "Cadastro patrocinado — 120210000000001");
    assert.equal(origin.campaign_id, null);
    assert.equal(origin.campaign_name, "");
    assert.equal(origin.destination, "broker");
    assert.deepEqual(origin.metadata, { ...META_STANDARD, utm_source: source, paid_media: true, paid_channel: "meta_site" });
  }
});

test("padrão atual com link pessoal: continua broker_link, só metadata enriquecido", () => {
  const origin = buildLeadOrigin({ direct: true, ref: "luana", attribution: META_STANDARD });
  assert.equal(origin.kind, "broker_link");
  assert.equal(origin.label, "Link pessoal — luana");
  assert.deepEqual(origin.metadata, { ...META_STANDARD, broker_ref: "luana", paid_media: true, paid_channel: "meta_site" });
});

test("formato antigo ctwa_formulario com link pessoal: broker_link + paid_channel whatsapp_ad", () => {
  const origin = buildLeadOrigin({ direct: true, ref: "luana", attribution: CTWA_LEGACY });
  assert.equal(origin.kind, "broker_link");
  assert.equal(origin.label, "Link pessoal — luana");
  assert.deepEqual(origin.metadata, { ...CTWA_LEGACY, broker_ref: "luana", paid_media: true, paid_channel: "whatsapp_ad" });
});

test("utm_medium=anuncio sem link pessoal/campanha/roleta cai em paid_link", () => {
  const origin = buildLeadOrigin({ attribution: CTWA_LEGACY });
  assert.equal(origin.kind, "paid_link");
  assert.equal(origin.label, "Cadastro patrocinado — ctwa_formulario");
  assert.equal(origin.metadata.paid_media, true);
  assert.equal(origin.metadata.paid_channel, "whatsapp_ad");

  const accented = buildLeadOrigin({ attribution: { utm_source: "whatsapp", utm_medium: "Anúncio" } });
  assert.equal(accented.kind, "paid_link");
  assert.equal(accented.label, "Cadastro patrocinado — whatsapp");
  assert.equal(accented.metadata.paid_media, true);
  assert.equal("paid_channel" in accented.metadata, false);
});

test("social / sem UTM ficam inalterados (sem chaves novas)", () => {
  const social = buildLeadOrigin({ attribution: { utm_source: "instagram", utm_medium: "social", utm_campaign: "bio" } });
  assert.equal(social.kind, "tracked_link");
  assert.equal(social.label, "Link — bio");
  assert.deepEqual(social.metadata, { utm_source: "instagram", utm_medium: "social", utm_campaign: "bio" });

  const none = buildLeadOrigin({});
  assert.equal(none.kind, "site");
  assert.equal(none.label, "Link Geral do Site");
  assert.deepEqual(none.metadata, {});

  assert.deepEqual(buildLeadOrigin({ attribution: null }).metadata, {});
  assert.deepEqual(buildLeadOrigin({ direct: true, ref: "luana" }).metadata, { broker_ref: "luana" });
});

test("prioridade broker_link > campaign > roulette_link > paid_link mantida", () => {
  const campaign = { id: "campaign-id", name: "Cadastro Patrocinado — Terras" };
  for (const attribution of [META_STANDARD, CTWA_LEGACY]) {
    assert.equal(buildLeadOrigin({ direct: true, ref: "x", campaign, team: true, attribution }).kind, "broker_link");
    const byCampaign = buildLeadOrigin({ campaign, team: true, roulette: true, attribution });
    assert.equal(byCampaign.kind, "campaign");
    assert.equal(byCampaign.label, campaign.name);
    assert.equal(byCampaign.campaign_id, campaign.id);
    assert.equal(buildLeadOrigin({ team: true, roulette: true, attribution }).kind, "roulette_link");
    assert.equal(buildLeadOrigin({ attribution }).kind, "paid_link");
  }
});

test("sanitização de UTM preservada (remove <> e limita a 200)", () => {
  const origin = buildLeadOrigin({ attribution: { utm_source: "fb", utm_medium: "<paid>", utm_campaign: "x".repeat(300) } });
  assert.equal(origin.metadata.utm_medium, "paid");
  assert.equal(origin.metadata.utm_campaign.length, 200);
  assert.equal(origin.kind, "paid_link");
});
