// Regressão da análise documental — camada DETERMINÍSTICA (sem IA).
// Casos 100% sintéticos (nenhum documento ou dado real de cliente).
// Mantido pelo agente `analista-documental` (skill /testar-regra-documental).
// Casos do motor de requisitos: tests/fixtures/documentos/casos-requisitos.json.
// Lacunas conhecidas entre a regra do dono e o código ficam como `todo`
// (aparecem no relatório do node --test sem quebrar a suíte).
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { evaluateDocumentRequirements } from "../lib/document-requirements-engine.js";
import { calculateBankIncomeForClient, pendingClientMessage, residenceSourceDecision } from "../lib/document-policy.mjs";
import { residenceDecision } from "../lib/document-ai-rule-core.mjs";
import { uniqueDocumentBytes } from "../lib/document-identity.mjs";

const fixture = JSON.parse(readFileSync(new URL("./fixtures/documentos/casos-requisitos.json", import.meta.url), "utf8"));
const defaultRules = fixture.regrasAtivasPadrao.map((ruleKey) => ({ ruleKey, active: true }));
const key = (row) => `${row.personRole}:${row.documentType}`;

for (const caso of fixture.casos) {
  test(`requisitos: ${caso.nome}`, () => {
    const rows = evaluateDocumentRequirements(caso.cadastro, caso.classificados.map((item) => ({ extractedData: {}, ...item })), caso.regras ? caso.regras.map((ruleKey) => ({ ruleKey, active: true })) : defaultRules);
    const got = rows.map((row) => `${key(row)}:${row.status}`);
    for (const expected of caso.esperado || []) assert.ok(got.includes(expected), `esperado ${expected}; obtido ${JSON.stringify(got)}`);
    for (const forbidden of caso.proibido || []) assert.ok(!rows.some((row) => key(row) === forbidden), `não deveria exigir ${forbidden}; obtido ${JSON.stringify(got)}`);
    if (caso.exatamente) assert.deepEqual(got.sort(), [...(caso.esperado || [])].sort());
  });
}

const ownership = { ruleKey: "residence_income_ownership", active: true, policy: { self_employed_unregistered: "titular_only", registered_employment: "third_party_allowed", income_tax_declarant: "third_party_allowed" } };

test("comprovante em nome de terceiro: permitido para CLT e IR, não permitido para renda informal", () => {
  const base = { rule: ownership, clientName: "Ana Teste Sintética", documentName: "Pedro Terceiro Sintético" };
  assert.equal(residenceDecision({ ...base, incomeType: "registered_employment" }).status, "conforme");
  assert.equal(residenceDecision({ ...base, incomeType: "income_tax_declarant" }).status, "conforme");
  assert.equal(residenceDecision({ ...base, incomeType: "self_employed_unregistered" }).status, "pendencia");
});

test("nome com diferença só de caixa/acento não vira divergência", () => {
  const base = { rule: ownership, incomeType: "self_employed_unregistered" };
  assert.equal(residenceDecision({ ...base, clientName: "Matheus Machado", documentName: "MATHEUS MACHADO" }).status, "conforme");
  assert.equal(residenceDecision({ ...base, clientName: "José Conceição", documentName: "JOSE CONCEICAO" }).status, "conforme");
});

test("regra de titularidade inativa não interfere (sem regra ativa, não decide)", () => {
  assert.equal(residenceDecision({ rule: { ...ownership, active: false }, incomeType: "self_employed_unregistered", clientName: "A B", documentName: "C D" }), null);
});

test("fontes de comprovante: água/luz/internet/telefone aceitas; boleto e extrato recusados; fatura só como renda sem conta de consumo", () => {
  for (const source of ["water", "electricity", "internet", "telephone"]) assert.equal(residenceSourceDecision(source), "accepted");
  assert.equal(residenceSourceDecision("boleto"), "rejected");
  assert.equal(residenceSourceDecision("bank_statement"), "rejected");
  assert.equal(residenceSourceDecision("credit_card", { cardAsIncome: true, hasRegularProof: false }), "accepted");
  assert.equal(residenceSourceDecision("credit_card", { cardAsIncome: true, hasRegularProof: true }), "rejected");
  assert.equal(residenceSourceDecision("credit_card", { cardAsIncome: false }), "rejected");
});

test("renda informal: média bruta = soma dos 3 meses / 3; PIX próprio comprovado sai da líquida", () => {
  const months = [
    { month: "2026-07", credits: [{ amount: 1000, payerName: "Cliente X" }, { amount: 500, payerName: "Bruno Teste Sintético", relation: "self", evidence: "PIX conta própria" }] },
    { month: "2026-08", credits: [{ amount: 1200, payerName: "Cliente Y" }] },
    { month: "2026-09", credits: [{ amount: 1300, payerName: "Cliente Z" }] }
  ];
  const result = calculateBankIncomeForClient(months, { clientName: "Bruno Teste Sintético" });
  assert.equal(result.needsValidation, false);
  assert.equal(result.grossTotal, 4000);
  assert.equal(result.grossMonthlyAverage, 1333.33);
  assert.equal(result.netTotal, 3500);
  assert.equal(result.netMonthlyAverage, 1166.67);
});

test("renda informal: parentesco não comprovado NÃO é descontado (não inventa parentesco)", () => {
  const months = ["2026-07", "2026-08", "2026-09"].map((month) => ({ month, credits: [{ amount: 1000, payerName: "Maria Sobrenome Qualquer", relation: "first_degree_relative", evidence: "suposta mãe" }] }));
  const result = calculateBankIncomeForClient(months, { clientName: "Bruno Teste Sintético", relativeNames: [] });
  assert.equal(result.netTotal, 3000);
});

test("renda informal: menos de 3 meses pede validação em vez de calcular", () => {
  const result = calculateBankIncomeForClient([{ month: "2026-09", credits: [{ amount: 1000, payerName: "X" }] }], { clientName: "Y" });
  assert.equal(result.needsValidation, true);
});

test("duplicidade: só bytes idênticos são duplicados; arquivos parecidos não", async () => {
  const docs = [
    { id: "a", data: "PDF-SINTETICO-1" },
    { id: "b", data: "PDF-SINTETICO-1" },
    { id: "c", data: "PDF-SINTETICO-1 " }
  ];
  const { unique, duplicates } = await uniqueDocumentBytes(docs, (doc) => Buffer.from(doc.data));
  assert.deepEqual(duplicates, ["b"]);
  assert.deepEqual(unique.map((doc) => doc.id), ["a", "c"]);
});

test("vários arquivos: falha ao baixar um não derruba os outros nem o marca como duplicado", async () => {
  const docs = [{ id: "a", data: "X" }, { id: "b", data: null }, { id: "c", data: "Y" }];
  const { unique, duplicates } = await uniqueDocumentBytes(docs, (doc) => { if (!doc.data) throw new Error("falha"); return Buffer.from(doc.data); });
  assert.deepEqual(duplicates, []);
  assert.deepEqual(unique.map((doc) => doc.id), ["a", "b", "c"]);
});

test("devolutiva: título fixo, 'Documento pendente.', sem repetição e sem 'Favor enviar este documento'", () => {
  const message = pendingClientMessage([
    { personRole: "titular", documentType: "holerite", documentTypeLabel: "Holerite", status: "ausente" },
    { personRole: "titular", documentType: "holerite", documentTypeLabel: "Holerite", status: "pendencia", observations: "Envie o outro holerite." },
    { personRole: "titular", documentType: "rg", documentTypeLabel: "RG", status: "ilegivel" },
    { personRole: "titular", documentType: "ctps", documentTypeLabel: "CTPS", status: "conforme" },
    { personRole: "titular", documentType: "certidao_casamento", documentTypeLabel: "Certidão", status: "divergencia", observations: "Estado civil diverge." }
  ]);
  assert.match(message, /^\*DEVOLUTIVA CAIXA DOCUMENTAÇÃO\*/);
  assert.equal(message.match(/Holerite/g).length, 1);
  assert.match(message, /Documento pendente\./);
  assert.match(message, /Documento ilegível\./);
  assert.doesNotMatch(message, /Favor enviar este documento/i);
  assert.doesNotMatch(message, /CTPS/);
  assert.doesNotMatch(message, /Certidão/);
});

test("devolutiva vazia quando não há pendência", () => {
  assert.equal(pendingClientMessage([{ personRole: "titular", documentType: "rg", status: "conforme" }]), "");
});

// ---- Lacunas conhecidas (regra do dono x código atual). Ver
// .claude/analista-documental/REGRAS-DOCUMENTAIS.md §Matriz de cobertura.
test("comprovante de residência do mês atual ou anterior (regra do dono)", { todo: "Não implementado em código: hoje a validade é só 'expired' julgado pela IA (lib/document-analysis.js)." }, () => {});
test("divergência objetiva de CPF entre cadastro e documento", { todo: "Não existe validação cruzada determinística de CPF; hoje depende da IA (divergences)." }, () => {});
test("comprovante de residência filtrado por papel e por validade no motor", { todo: "regularResidence (lib/document-requirements-engine.js) não filtra personRole nem expired." }, () => {});
test("duplicidade de documento reescaneado (bytes diferentes)", { todo: "Só SHA-256 de bytes idênticos; reescaneado depende da IA." }, () => {});
