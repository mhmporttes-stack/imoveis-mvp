import test from "node:test";
import assert from "node:assert/strict";
import { residenceDecision } from "../lib/document-ai-rule-core.mjs";
import { residenceSourceDecision, calculateBankIncomeForClient, pendingClientMessage, partitionChatSelection, extractSelectedContactFacts } from "../lib/document-policy.mjs";
import { evaluateDocumentRequirements } from "../lib/document-requirements-engine.js";
import { zipFiles } from "../lib/document-zip.mjs";

const ownership = { ruleKey: "residence_income_ownership", active: true, policy: { self_employed_unregistered: "titular_only", registered_employment: "third_party_allowed", income_tax_declarant: "third_party_allowed" } };
const names = { rule: ownership, clientName: "João Silva" };
test("residência: informal próprio válido, terceiro pendente, CLT e IR aceitos", () => {
  assert.equal(residenceDecision({ ...names, incomeType: "self_employed_unregistered", documentName: "João Silva" }).status, "conforme");
  assert.equal(residenceDecision({ ...names, incomeType: "self_employed_unregistered", documentName: "Maria Costa" }).status, "pendencia");
  assert.equal(residenceDecision({ ...names, incomeType: "registered_employment", documentName: "Maria Costa" }).status, "conforme");
  assert.equal(residenceDecision({ ...names, incomeType: "income_tax_declarant", documentName: "Maria Costa" }).status, "conforme");
});
test("fonte de residência: boleto e extrato recusados; fatura só na exceção", () => {
  assert.equal(residenceSourceDecision("generic_bill"), "rejected");
  assert.equal(residenceSourceDecision("boleto de condomínio"), "rejected");
  assert.equal(residenceSourceDecision("bank_statement"), "rejected");
  assert.equal(residenceSourceDecision("credit_card", { cardAsIncome: true, hasRegularProof: false }), "accepted");
  assert.equal(residenceSourceDecision("credit_card", { cardAsIncome: true, hasRegularProof: true }), "rejected");
  assert.equal(residenceSourceDecision("water"), "accepted");
});
test("certidão sem averbação pede documentos do cônjuge sem repetir certidão/residência", () => {
  const rows = evaluateDocumentRequirements({ fullName: "João Silva", primaryMaritalStatus: "divorced", primaryIncomeType: "registered_employment" }, [{ personRole: "titular", documentType: "certidao_casamento", extractedData: { divorceAnnotation: false } }], [{ ruleKey: "marriage_spouse" }]);
  assert.ok(rows.some((row) => row.personRole === "conjuge" && row.documentType === "rg"));
  assert.ok(!rows.some((row) => row.personRole === "conjuge" && ["certidao_casamento", "comprovante_residencia"].includes(row.documentType)));
});
test("CTPS classificada em imagem ou PDF satisfaz o mesmo requisito", () => {
  for (const mime of ["image/jpeg", "application/pdf"]) {
    const rows = evaluateDocumentRequirements({ primaryIncomeType: "registered_employment" }, [{ personRole: "titular", documentType: "ctps", extractedData: { mime } }]);
    assert.ok(!rows.some((row) => row.documentType === "ctps"));
  }
});
test("FGTS desatualizado gera pendência específica", () => {
  const rows = evaluateDocumentRequirements({ primaryIncomeType: "self_employed_unregistered" }, [{ personRole: "titular", documentType: "fgts", extractedData: { expired: true } }], [{ ruleKey: "fgts_updated" }]);
  assert.ok(rows.some((row) => row.documentType === "fgts" && row.status === "pendencia"));
});
const incomeMonths = [
  { month: "2026-06", credits: [{ amount: 1000, payerName: "João Silva", relation: "self", evidence: "mesma titularidade" }, { amount: 2000, payerName: "Cliente Externo", relation: "unknown" }] },
  { month: "2026-07", credits: [{ amount: 3000, payerName: "Maria Costa", relation: "spouse", evidence: "certidão" }, { amount: 100, payerName: "Desconhecido", relation: "spouse", evidence: "suspeita" }] },
  { month: "2026-08", credits: [{ amount: 500, payerName: "Ana Silva", relation: "first_degree_relative", evidence: "certidão" }, { amount: 900, payerName: "Origem Incerta", relation: "unknown" }] }
];
test("três meses: médias bruta e líquida, exclusões verificadas e PIX incerto contado", () => {
  const result = calculateBankIncomeForClient(incomeMonths, { clientName: "João Silva", spouseNames: ["Maria Costa"], relativeNames: ["Ana Silva"] });
  assert.equal(result.grossTotal, 7500);
  assert.equal(result.netTotal, 3000);
  assert.equal(result.grossMonthlyAverage, 2500);
  assert.equal(result.netMonthlyAverage, 1000);
  assert.equal(result.months[1].net, 100); // remetente sem identidade verificada permanece como renda
});
test("PIX suspeito sem parentesco confirmado permanece na renda", () => {
  const result = calculateBankIncomeForClient(incomeMonths, { clientName: "João Silva" });
  assert.equal(result.netTotal, 6500);
});
test("menos de três meses não gera média conclusiva", () => {
  assert.equal(calculateBankIncomeForClient(incomeMonths.slice(0, 2)).needsValidation, true);
});
test("somente mensagens explicitamente selecionadas geram fatos", () => {
  const rows = [{ id: "1", direction: "inbound", message_type: "text", body: "PIS 123.45678.90-1 e-mail joao@exemplo.com" }, { id: "2", direction: "inbound", message_type: "text", body: "segredo@exemplo.com" }, { id: "3", direction: "inbound", message_type: "document", metadata: {} }, { id: "4", direction: "internal", message_type: "text", body: "interno" }];
  const selection = partitionChatSelection(rows, ["1", "3", "4"]);
  assert.deepEqual(selection.media.map((row) => row.id), ["3"]);
  assert.deepEqual(selection.texts.map((row) => row.id), ["1"]);
  assert.deepEqual(extractSelectedContactFacts(selection.texts), { email: "joao@exemplo.com", pis: "12345678901" });
});
test("sem pendências não há mensagem; com pendência não vaza regra interna", () => {
  assert.equal(pendingClientMessage([{ status: "conforme", documentType: "rg" }]), "");
  const message = pendingClientMessage([{ status: "pendencia", documentType: "fgts", documentTypeLabel: "Extrato FGTS", observations: "Regra interna 123: vencido" }]);
  assert.match(message, /Extrato FGTS/);
  assert.doesNotMatch(message, /Regra interna/);
});
test("ZIP preserva caminhos e bytes do pacote", () => {
  const zip = zipFiles([{ name: "Cliente/00_Ficha.pdf", data: Buffer.from("PDF") }, { name: "Cliente/01_CTPS.jpg", data: Buffer.from("FOTO") }]);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  assert.ok(zip.includes(Buffer.from("Cliente/00_Ficha.pdf")));
  assert.ok(zip.includes(Buffer.from("Cliente/01_CTPS.jpg")));
});
test("regra desativada e edição na próxima avaliação", () => {
  assert.equal(residenceDecision({ ...names, rule: { ...ownership, active: false }, incomeType: "self_employed_unregistered", documentName: "Maria Costa" }), null);
  const edited = { ...ownership, policy: { ...ownership.policy, self_employed_unregistered: "third_party_allowed" } };
  assert.equal(residenceDecision({ ...names, rule: edited, incomeType: "self_employed_unregistered", documentName: "Maria Costa" }).status, "conforme");
});
