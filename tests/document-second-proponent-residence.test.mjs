// Regra do dono (2026-10-02): comprovante de residência é exigido SÓ do
// proponente principal (titular). Segundo proponente/cônjuge/dependente nunca
// gera pendência de comprovante de residência, seja renda CLT ou informal.
// Casos 100% sintéticos (nenhum dado real de cliente).
import test from "node:test";
import assert from "node:assert/strict";
import { residenceDecision } from "../lib/document-ai-rule-core.mjs";
import { isResidenceRequiredForRole, normalizeNonPrincipalResidenceItem } from "../lib/document-policy.mjs";
import { evaluateDocumentRequirements } from "../lib/document-requirements-engine.js";

const ownership = { ruleKey: "residence_income_ownership", active: true, policy: { self_employed_unregistered: "titular_only", registered_employment: "third_party_allowed", income_tax_declarant: "third_party_allowed" } };
const base = { rule: ownership, clientName: "Ana Teste Sintética", documentName: "Pedro Terceiro Sintético" };

test("1. principal renda informal: comprovante em nome de terceiro continua pendência", () => {
  assert.equal(residenceDecision({ ...base, incomeType: "self_employed_unregistered", personRole: "titular" }).status, "pendencia");
  assert.equal(residenceDecision({ ...base, incomeType: "self_employed_unregistered" }).status, "pendencia");
});

test("2. segundo proponente renda informal: NÃO gera pendência de comprovante", () => {
  for (const personRole of ["outro", "conjuge", "dependente"]) {
    assert.equal(residenceDecision({ ...base, incomeType: "self_employed_unregistered", personRole }).status, "conforme");
  }
  const item = { personRole: "outro", documentType: "comprovante_residencia", status: "pendencia", observations: "Renda informal exige comprovante em nome do próprio cliente.", ruleTrace: { ruleId: "x" }, extractedData: {} };
  const result = normalizeNonPrincipalResidenceItem(item);
  assert.equal(result.status, "conforme");
  assert.equal(result.ruleTrace, null);
  assert.ok(!/exige comprovante em nome/.test(result.observations));
});

test("3. segundo proponente CLT: NÃO pede comprovante (nem como ausente, nem como pendência)", () => {
  assert.equal(residenceDecision({ ...base, incomeType: "registered_employment", personRole: "conjuge" }).status, "conforme");
  for (const status of ["pendencia", "precisa_confirmacao", "ilegivel", "divergencia"]) {
    assert.equal(normalizeNonPrincipalResidenceItem({ personRole: "conjuge", documentType: "comprovante_residencia", status, extractedData: {} }).status, "conforme");
  }
  const cadastro = { fullName: "Ana Teste Sintética", primaryMaritalStatus: "single", primaryIncomeType: "registered_employment", simulationType: "joint", secondaryMaritalStatus: "single", secondaryIncomeType: "registered_employment", pis: "SINTETICO" };
  const rows = evaluateDocumentRequirements(cadastro, [{ personRole: "titular", documentType: "comprovante_residencia", status: "conforme", extractedData: {} }], [{ ruleKey: "residence_source", active: true }]);
  assert.ok(!rows.some((row) => row.personRole !== "titular" && row.documentType === "comprovante_residencia"), JSON.stringify(rows));
});

test("principal sem comprovante continua sendo exigido; do segundo proponente nunca", () => {
  const cadastro = { fullName: "Ana Teste Sintética", primaryMaritalStatus: "single", primaryIncomeType: "self_employed_unregistered", simulationType: "joint", secondaryMaritalStatus: "single", secondaryIncomeType: "self_employed_unregistered", pis: "SINTETICO" };
  const rows = evaluateDocumentRequirements(cadastro, [], [{ ruleKey: "residence_source", active: true }]);
  assert.ok(rows.some((row) => row.personRole === "titular" && row.documentType === "comprovante_residencia" && row.status === "ausente"));
  assert.ok(!rows.some((row) => row.personRole === "outro" && row.documentType === "comprovante_residencia"));
});

test("4. reanálise: normalizar de novo é idempotente e não recria a pendência", () => {
  const original = { personRole: "outro", documentType: "comprovante_residencia", status: "pendencia", observations: "Renda informal exige comprovante em nome do próprio cliente.", extractedData: {} };
  const once = normalizeNonPrincipalResidenceItem(original);
  const twice = normalizeNonPrincipalResidenceItem(once);
  assert.deepEqual(twice, once);
  assert.equal(twice.extractedData.residenceNotRequiredFrom, "pendencia");
});

test("não toca no principal nem em outros tipos de documento", () => {
  const principal = { personRole: "titular", documentType: "comprovante_residencia", status: "pendencia", extractedData: {} };
  assert.equal(normalizeNonPrincipalResidenceItem(principal), principal);
  const holerite = { personRole: "outro", documentType: "holerite", status: "pendencia", extractedData: {} };
  assert.equal(normalizeNonPrincipalResidenceItem(holerite), holerite);
  assert.equal(isResidenceRequiredForRole("titular"), true);
  assert.equal(isResidenceRequiredForRole("outro"), false);
});

test("comprovante neutralizado do segundo proponente (era precisa_confirmacao) não vale como prova do principal", () => {
  const cadastro = { fullName: "Ana Teste Sintética", primaryMaritalStatus: "single", primaryIncomeType: "registered_employment", pis: "SINTETICO" };
  const neutralized = normalizeNonPrincipalResidenceItem({ personRole: "outro", documentType: "comprovante_residencia", status: "precisa_confirmacao", extractedData: {} });
  const rows = evaluateDocumentRequirements(cadastro, [neutralized], [{ ruleKey: "residence_source", active: true }]);
  assert.ok(rows.some((row) => row.personRole === "titular" && row.documentType === "comprovante_residencia"));
});
