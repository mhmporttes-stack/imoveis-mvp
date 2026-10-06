import test from "node:test";
import assert from "node:assert/strict";
import { isSponsoredReentry, markAdReentry, AD_REENTRY_COOLDOWN_MS } from "../lib/ad-reentry-core.mjs";

const NOW = Date.parse("2026-10-06T15:00:00.000Z");
const existingAt = (minutesAgo, extra = {}) => ({ id: "c1", responsibleUserId: "u1", createdAt: new Date(NOW - minutesAgo * 60000).toISOString(), ...extra });

test("anuncio (campanha ativa) + cliente antigo = reentrada", () => {
  assert.equal(isSponsoredReentry(existingAt(60 * 24), { isActiveCampaign: true }, NOW), true);
});

test("sem campanha ativa continua atualizando o cadastro existente", () => {
  assert.equal(isSponsoredReentry(existingAt(60 * 24), { isActiveCampaign: false }, NOW), false);
  assert.equal(isSponsoredReentry(null, { isActiveCampaign: true }, NOW), false);
});

test("reenvio em poucos minutos (duplo clique/retry) nao duplica", () => {
  assert.equal(isSponsoredReentry(existingAt(2), { isActiveCampaign: true }, NOW), false);
  const justAfter = AD_REENTRY_COOLDOWN_MS / 60000 + 0.5;
  assert.equal(isSponsoredReentry(existingAt(justAfter), { isActiveCampaign: true }, NOW), true);
});

test("markAdReentry registra o cadastro e o corretor anteriores sem mudar o resto da origem", () => {
  const origin = { kind: "campaign", label: "ECO VILAGE", metadata: { utm_source: "ig" } };
  const marked = markAdReentry(origin, { id: "c1", responsibleUserId: "u1" });
  assert.equal(marked.kind, "campaign");
  assert.equal(marked.metadata.utm_source, "ig");
  assert.equal(marked.metadata.ad_reentry, true);
  assert.equal(marked.metadata.ad_reentry_of, "c1");
  assert.equal(marked.metadata.ad_reentry_previous_responsible, "u1");
  assert.equal(markAdReentry(origin, null), origin);
});
