import test from "node:test";
import assert from "node:assert/strict";
import { personalizeJourney, isJourneyCelebrating, publicJourneyDTO, journeyNoticeLabel } from "../lib/journey-presentation.js";
import { buildLeadOrigin } from "../lib/lead-origin.js";

test("celebration lasts exactly 24h and is not consumed by opening", () => {
  const changed = "2026-09-13T08:00:00Z";
  const at = Date.parse(changed);
  for (let i = 0; i < 3; i++) assert.equal(isJourneyCelebrating(changed, at + 86399999), true);
  assert.equal(isJourneyCelebrating(changed, at + 86400000), false);
  assert.equal(isJourneyCelebrating(changed, at - 1), false);
  assert.equal(isJourneyCelebrating(null, at), false);
  assert.equal(isJourneyCelebrating(new Date(at + 5000).toISOString(), at + 6000), true);
});
test("templates substitute only supported variables", () => {
  assert.equal(personalizeJourney("Olá {primeiro_nome} {codigo_cliente} {secret}", { primeiro_nome: "João", codigo_cliente: "#C1234", secret: "private" }), "Olá João #C1234 {secret}");
});
test("public DTO is an allowlist, with current responsible phone and no private fields", () => {
  const client = { full_name: "João Henrique Silva", client_code: "#C1001", id: "private-id", phone: "private-phone", income: 9000, cpf: "private-cpf", internal_note: "private-note" };
  const state = { progress: 85, previous_progress: 65, changed_at: "2026-09-13T08:00:00Z", token: "secret", client_id: "private-id" };
  const config = { title: "Parabéns, {primeiro_nome}!", body: "Avançamos", cta: "whatsapp", cta_label: "Falar" };
  const copy = { contact: "Atendimento {codigo_cliente}", brand: "Minha Jornada" };
  const dto = publicJourneyDTO(client, state, config, "11999999999", copy);
  assert.equal(dto.firstName, "João");
  assert.match(dto.ctaUrl, /wa.me\/5511999999999/);
  assert.equal(dto.ctaLabel, "Falar com meu corretor");
  assert.match(publicJourneyDTO(client, state, { ...config, cta: "none" }, "11999999999", copy).ctaUrl, /wa.me\/5511999999999/);
  for (const value of ["private-id", "private-phone", "private-cpf", "private-note", "secret", "Henrique", "9000"]) assert.ok(!JSON.stringify(dto).includes(value));
  assert.equal(publicJourneyDTO(client, state, config, "bad", copy).ctaUrl, null);
  assert.match(publicJourneyDTO(client, state, config, "18988888888", copy).ctaUrl, /5518988888888/);
});
test("notice state follows status version, not delivery", () => {
  assert.equal(journeyNoticeLabel({ version: 1 }), "Avisar progresso");
  assert.equal(journeyNoticeLabel({ version: 1, notified_at: "now", notified_version: 1 }), "Progresso avisado");
  assert.equal(journeyNoticeLabel({ version: 2, notified_at: "now", notified_version: 1 }), "Avisar novo progresso");
});
test("source preserves campaign independently of distribution destination", () => {
  const campaign = { id: "campaign-id", name: "Cadastro Patrocinado — Terras" };
  for (const roulette of [true, false]) {
    const origin = buildLeadOrigin({ campaign, roulette });
    assert.equal(origin.campaign_id, campaign.id);
    assert.equal(origin.label, campaign.name);
    assert.equal(origin.destination, roulette ? "roulette" : "broker");
  }
  assert.equal(buildLeadOrigin({}).label, "Link Geral do Site");
  assert.equal(buildLeadOrigin({ team: true, roulette: true }).kind, "roulette_link");
  assert.equal(buildLeadOrigin({ direct: true, ref: "luana" }).label, "Link pessoal — luana");
  assert.equal(buildLeadOrigin({ attribution: { utm_medium: "cpc", utm_campaign: "Terras" } }).kind, "paid_link");
  assert.equal(buildLeadOrigin({ attribution: null }).kind, "site");
});
