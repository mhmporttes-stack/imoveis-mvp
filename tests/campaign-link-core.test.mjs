import test from "node:test";
import assert from "node:assert/strict";
import { resolveCampaignIdForForm } from "../lib/campaign-link-core.mjs";

test("ref pessoal + campanha guardada -> sem campanha e limpa o guardado", () => {
  const r = resolveCampaignIdForForm({ storedCampaign: "camp-antiga", brokerRef: "fulano-abc123" });
  assert.deepEqual(r, { campaignId: "", clearStored: true });
});
test("sem ref + guardada -> usa a guardada", () => {
  assert.deepEqual(resolveCampaignIdForForm({ storedCampaign: "camp-antiga" }), { campaignId: "camp-antiga", clearStored: false });
});
test("?c= na URL vale mesmo com ref pessoal", () => {
  const r = resolveCampaignIdForForm({ urlCampaign: "camp-url", storedCampaign: "outra", brokerRef: "fulano-abc123" });
  assert.deepEqual(r, { campaignId: "camp-url", clearStored: false });
});
test("ref=equipe + guardada -> usa a guardada (maiúsculas/espaços tolerados)", () => {
  assert.equal(resolveCampaignIdForForm({ storedCampaign: "camp-antiga", brokerRef: " Equipe " }).campaignId, "camp-antiga");
});
test("guardada expirada (leitor devolve vazio) -> sem campanha", () => {
  assert.deepEqual(resolveCampaignIdForForm({ storedCampaign: "", brokerRef: "" }), { campaignId: "", clearStored: false });
});
test("ref pessoal sem guardada -> nada a limpar", () => {
  assert.deepEqual(resolveCampaignIdForForm({ brokerRef: "fulano-abc123" }), { campaignId: "", clearStored: false });
});
