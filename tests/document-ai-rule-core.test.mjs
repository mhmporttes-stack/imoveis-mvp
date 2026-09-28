import test from "node:test";
import assert from "node:assert/strict";
import { residenceDecision } from "../lib/document-ai-rule-core.mjs";

const rule = {
  active: true,
  ruleKey: "residence_income_ownership",
  policy: {
    self_employed_unregistered: "titular_only",
    registered_employment: "third_party_allowed",
    income_tax_declarant: "third_party_allowed"
  }
};
const input = { rule, documentName: "Maria Oliveira", clientName: "João Silva" };

test("renda informal com comprovante de terceiro gera pendência rastreável", () => {
  const result = residenceDecision({ ...input, incomeType: "self_employed_unregistered" });
  assert.equal(result.status, "pendencia");
  assert.match(result.reason, /renda informal/i);
});
test("CLT aceita comprovante de terceiro", () => {
  assert.equal(residenceDecision({ ...input, incomeType: "registered_employment" }).status, "conforme");
});
test("declarante de IR aceita comprovante de terceiro", () => {
  assert.equal(residenceDecision({ ...input, incomeType: "income_tax_declarant" }).status, "conforme");
});
test("regra desativada não é aplicada", () => {
  assert.equal(residenceDecision({ ...input, rule: { ...rule, active: false }, incomeType: "self_employed_unregistered" }), null);
});
test("edição da política passa a valer na próxima avaliação", () => {
  const edited = { ...rule, policy: { ...rule.policy, self_employed_unregistered: "third_party_allowed" } };
  assert.equal(residenceDecision({ ...input, rule: edited, incomeType: "self_employed_unregistered" }).status, "conforme");
});
test("dados insuficientes exigem validação", () => {
  assert.equal(residenceDecision({ ...input, incomeType: "" }).status, "precisa_confirmacao");
});
