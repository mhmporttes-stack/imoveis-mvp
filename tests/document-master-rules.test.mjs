import test from "node:test";
import assert from "node:assert/strict";
import { residenceDecision } from "../lib/document-ai-rule-core.mjs";
import { residenceSourceDecision, calculateBankIncomeForClient, pendingClientMessage, partitionChatSelection, extractSelectedContactFacts, visibleDocumentDivergences } from "../lib/document-policy.mjs";
import { evaluateDocumentRequirements } from "../lib/document-requirements-engine.js";
import { uniqueDocumentBytes } from "../lib/document-identity.mjs";
import { birthDate, coverFacts } from "../lib/document-cover-facts.mjs";
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
test("divórcio averbado dispensa ex-cônjuge, mas composição exige segundo proponente", () => {
  const certificate = [{ personRole: "titular", documentType: "certidao_casamento", extractedData: { divorceAnnotation: true } }];
  const base = { fullName: "João Silva", primaryMaritalStatus: "married", primaryIncomeType: "registered_employment" };
  const rules = [{ ruleKey: "marriage_spouse" }];
  assert.ok(!evaluateDocumentRequirements(base, certificate, rules).some((row) => row.personRole === "conjuge"));
  const joint = evaluateDocumentRequirements({ ...base, simulationType: "joint", secondaryIncomeType: "registered_employment" }, certificate, rules);
  assert.ok(joint.some((row) => row.personRole === "outro" && row.documentType === "rg"));
  assert.ok(!joint.some((row) => row.personRole === "conjuge"));
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
test("devolutiva só pede ações, com título e motivos curtos", () => {
  const message = pendingClientMessage([
    { status: "ausente", documentType: "fgts", documentTypeLabel: "Extrato FGTS" },
    { status: "pendencia", documentType: "comprovante_residencia", documentTypeLabel: "Comprovante de residência", observations: "desatualizado" },
    { status: "divergencia", documentType: "ctps", observations: "self_employed_unregistered" }
  ]);
  assert.ok(message.startsWith("*DEVOLUTIVA CAIXA DOCUMENTAÇÃO*"));
  assert.match(message, /• Extrato FGTS\n_Documento pendente\._/);
  assert.match(message, /• Comprovante de residência\n_Documento desatualizado\._/);
  assert.doesNotMatch(message, /CTPS|self_employed/);
});
test("divergências equivalentes aparecem uma vez e sem nomes internos", () => {
  const rows = visibleDocumentDivergences([
    { description: "Extratos #6 e #7 são aparentemente duplicados" },
    { description: "Extratos #6 e #7 parecem ser o mesmo documento" },
    { description: "CTPS e cadastro divergem: 'self_employed_unregistered'" }
  ]);
  assert.equal(rows.length, 2);
  assert.doesNotMatch(rows[1].description, /self_employed/);
});
test("somente bytes idênticos são deduplicados; meses distintos permanecem", async () => {
  const documents = [{ id: "1", data: "julho" }, { id: "2", data: "julho" }, { id: "3", data: "agosto" }];
  const { unique, duplicates } = await uniqueDocumentBytes(documents, (doc) => Buffer.from(doc.data));
  assert.deepEqual(unique.map((doc) => doc.id), ["1", "3"]);
  assert.deepEqual(duplicates, ["2"]);
});
test("capa usa nome oficial, maior idade, endereço válido e data brasileira sem placeholder", () => {
  const rows = [
    { person_role: "titular", person_label: "Agnaldo Silva Santos", document_type: "rg", status: "conforme", extracted_data: { cpf: "123", dataNascimento: "1980-08-15" } },
    { person_role: "outro", person_label: "Maria Souza", document_type: "cnh", status: "conforme", extracted_data: { cpf: "456", birthDate: "1978-01-02" } },
    { person_role: "titular", document_type: "comprovante_residencia", status: "conforme", extracted_data: { residenceSource: "water", rua: "Rua Exemplo", numero: "123", bairro: "Centro", cidade: "Marília", uf: "SP", cep: "17500-000" } }
  ];
  const result = coverFacts({ fullName: "Agnaldo", oldestBirthDate: "1900-01-01", simulationType: "joint" }, rows);
  assert.equal(result.primary.name, "Maria Souza");
  assert.equal(result.primary.birth, "02/01/1978");
  assert.equal(result.secondary.name, "Agnaldo Silva Santos");
  assert.equal(result.address.street, "Rua Exemplo");
  assert.equal(result.address.zip, "17500-000");
  assert.equal(birthDate("1900-01-01"), "");
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
