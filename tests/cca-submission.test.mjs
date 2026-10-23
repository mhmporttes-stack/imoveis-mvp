// Envio da documentação à CCA (REGRA OFICIAL do dono, 2026-10-23 — DOC-8):
// (1) o texto diz logo no início para onde é a documentação; (2) envio direto,
// sem análise da IA, pelo MESMO envio (guard, status, registro na linha do tempo).
// Sem banco e sem envio real: regras puras + leitura do código.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { buildCcaSentEventDetails, buildCcaSubmissionMessage, ccaDestinationName, isAnalysisSkippedBatch } from "../lib/cca-submission-core.mjs";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
const lib = read("lib/client-documents.js");
const detail = { clientName: "Cliente Teste", cpf: "000.000.000-00", pis: "", maritalStatus: "Solteiro(a)", clientPhone: "", propertyType: "novo", propertyValue: 200000, propertyName: "", brokerName: "Corretor Teste" };

test("1ª linha do texto = destino em maiúsculas + cliente; o resto do texto continua igual", () => {
  const message = buildCcaSubmissionMessage(detail, { name: "Menin", companyName: "" });
  const lines = message.split("\n");
  assert.equal(lines[0], "📂 Documentação para enviar à MENIN — cliente Cliente Teste");
  assert.equal(lines[1], "Olá! Segue a documentação de Cliente Teste para análise.");
  assert.ok(lines.includes("CPF 000.000.000-00 • Solteiro(a)"));
  assert.ok(lines.some((line) => line.startsWith("Imóvel novo • R$")));
  assert.equal(lines.at(-1), "Corretor: Corretor Teste");
  assert.ok(buildCcaSubmissionMessage(detail, { name: "Pacaembu" }).startsWith("📂 Documentação para enviar à PACAEMBU — cliente"));
});

test("destino vem do cadastro (nome; sem nome, a empresa); sem destino não inventa", () => {
  assert.equal(ccaDestinationName({ name: " Menin ", companyName: "X" }), "MENIN");
  assert.equal(ccaDestinationName({ name: "", companyName: "Pacaembu" }), "PACAEMBU");
  assert.equal(ccaDestinationName(null), "");
  assert.ok(buildCcaSubmissionMessage(detail, null).startsWith("Olá! Segue"));
});

test("prévia e envio usam o MESMO montador de texto (ponto único)", () => {
  assert.equal((lib.match(/buildCcaSubmissionMessage\(detail, cca\)/g) || []).length, 2);
  assert.ok(!lib.includes("function buildWhatsappMessage"), "sem cópia antiga do texto");
});

test("lote 'sem análise' só enquanto não foi analisado", () => {
  assert.equal(isAnalysisSkippedBatch({ status: "uploading", summary: { analysisSkipped: true } }), true);
  assert.equal(isAnalysisSkippedBatch({ status: "analyzed", summary: { analysisSkipped: true } }), false);
  assert.equal(isAnalysisSkippedBatch({ status: "uploading", summary: {} }), false);
  assert.equal(isAnalysisSkippedBatch(null), false);
});

test("evento da linha do tempo é o mesmo document_sent_to_cca, com a marca withoutAnalysis", () => {
  const details = buildCcaSentEventDetails({ submissionId: "s", cca: { id: "c", name: "Menin" }, documentCount: 3, batchId: "", format: "pdf", pendingCount: 0, pdfSkipped: [], withoutAnalysis: true });
  assert.deepEqual(details, { submissionId: "s", ccaId: "c", ccaName: "Menin", documentCount: 3, batchId: null, format: "pdf", pendingCount: 0, pdfSkipped: [], withoutAnalysis: true });
  assert.equal(buildCcaSentEventDetails({ cca: { id: "c" } }).withoutAnalysis, false);
  const start = lib.indexOf("export async function submitToCca");
  const block = lib.slice(start, lib.indexOf("async function buildCcaPackageDetail"));
  assert.ok(block.includes('eventType: "document_sent_to_cca"') && block.includes("buildCcaSentEventDetails({"));
});

test("envio direto passa pelas MESMAS travas e muda o status igual ao envio de sempre", () => {
  const start = lib.indexOf("export async function submitToCca");
  const block = lib.slice(start, lib.indexOf("async function buildCcaPackageDetail"));
  assert.ok(block.indexOf("requireClientAccess(clientId, auth)") < block.indexOf("withoutAnalysis = isAnalysisSkippedBatch"), "acesso ao cliente antes de tudo");
  assert.ok(block.includes('.eq("id", batchId).eq("client_id", registration.id)'), "marca só de lote do próprio cliente, lida no servidor");
  assert.ok(!block.includes("payload.withoutAnalysis"), "a tela não decide o 'sem análise'");
  assert.ok(block.includes("payload.confirmPending !== true"), "confirmação de pendências mantida");
  assert.ok(block.includes("updateSimulationRegistration(clientId, { status: CLIENT_STATUS.APPROVAL_PENDING }, auth)"));
  assert.ok(block.includes("openInitialCcaStatusOnSend"));
  assert.ok(!/sendChatMessage|sendWhatsapp/.test(block), "nada enviado sozinho: só devolve o link wa.me");
});

test("importar sem IA: Chat e tela de documentos não chamam a análise quando skipAnalysis", () => {
  const chat = lib.slice(lib.indexOf("export async function analyzeSelectedChatMessages"), lib.indexOf("export async function queueChatDocumentRetry"));
  assert.ok(chat.includes("queued: !skipAnalysis") && chat.includes("analysisSkipped: true"));
  assert.ok(chat.includes("const textMessages = skipAnalysis ? [] : selectedTexts"), "textos não vão no envio direto");
  const confirm = lib.slice(lib.indexOf("export async function confirmDocumentBatchUpload"), lib.indexOf("export async function analyzeSelectedChatMessages"));
  assert.ok(confirm.indexOf("options.skipAnalysis === true") < confirm.indexOf("await analyzeBatchNow"));
  const fromChat = read("app/api/admin/client-documents/from-chat/route.js");
  assert.ok(fromChat.indexOf("requireAdminApi(request)") < fromChat.indexOf("skipAnalysis: body.skipAnalysis === true"));
  assert.ok(fromChat.includes("if (batch.queued) after("), "a análise em segundo plano só roda quando pedida");
  const confirmRoute = read("app/api/admin/client-documents/batches/[id]/confirm/route.js");
  assert.ok(confirmRoute.indexOf("requireAdminApi(request)") < confirmRoute.indexOf("skipAnalysis: body.skipAnalysis === true"));
  const submitRoute = read("app/api/admin/client-documents/cca-submission/route.js");
  assert.ok(submitRoute.indexOf("requireAdminApi(request)") < submitRoute.indexOf("submitToCca("), "mesmo guard do envio de sempre");
});

test("telas oferecem as duas ações: Analisar com IA e Enviar direto para análise (CCA)", () => {
  const chatUi = read("components/WhatsappChat.jsx");
  assert.ok(chatUi.includes("Analisar com IA (") && chatUi.includes("Enviar direto para análise (CCA)") && chatUi.includes("skipAnalysis: true"));
  const modal = read("components/ClientDocumentsModal.jsx");
  assert.ok(modal.includes("Analisar com IA") && modal.includes("Enviar direto para análise (CCA)") && modal.includes("skipAnalysis: direct"));
});
