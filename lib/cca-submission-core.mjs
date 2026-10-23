// Regras puras do envio da documentação à CCA (sem banco) — usadas por
// lib/client-documents.js (prévia e envio) e pelos testes.
//
// [REGRA OFICIAL DE NEGÓCIO — dono, 2026-10-23] (DOC-8)
// (1) O texto do envio diz logo no início PARA ONDE é a documentação (nome
//     do destino cadastrado, ex.: "MENIN") — quem recebe (ex.: a Carol)
//     repassa sem precisar perguntar. Vale para o envio com e sem análise.
// (2) Envio direto, sem análise da IA: mesmo envio, marcado "sem análise".

export const CCA_SENT_EVENT = "document_sent_to_cca";

// Nome do destino em maiúsculas (é o "name" do cadastro da CCA; sem ele,
// o nome da empresa). Nunca inventa destino.
export function ccaDestinationName(cca) {
  return String(cca?.name || cca?.companyName || "").trim().toLocaleUpperCase("pt-BR");
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}

// Ponto ÚNICO de montagem do texto do envio à CCA (prévia e envio).
export function buildCcaSubmissionMessage(detail, cca) {
  const destination = ccaDestinationName(cca);
  const parts = [];
  if (destination) parts.push(`📂 Documentação para enviar à ${destination} — cliente ${detail.clientName}`);
  parts.push(`Olá! Segue a documentação de ${detail.clientName} para análise.`);
  const clientParts = [];
  if (detail.cpf) clientParts.push(`CPF ${detail.cpf}`);
  if (detail.pis) clientParts.push(`PIS ${detail.pis}`);
  if (detail.maritalStatus) clientParts.push(detail.maritalStatus);
  if (detail.clientPhone) clientParts.push(`Tel. ${detail.clientPhone}`);
  if (clientParts.length) parts.push(clientParts.join(" • "));
  const operationParts = [];
  if (detail.propertyType) operationParts.push(detail.propertyType === "novo" ? "Imóvel novo" : "Imóvel usado");
  if (detail.propertyValue) operationParts.push(formatCurrency(detail.propertyValue));
  if (detail.propertyName) operationParts.push(detail.propertyName);
  if (operationParts.length) parts.push(operationParts.join(" • "));
  if (detail.brokerName) parts.push(`Corretor: ${detail.brokerName}`);
  return parts.join("\n");
}

// Lote salvo pelo "Enviar direto para análise (CCA)": arquivos guardados sem
// passar pela IA. Se depois alguém pedir "Analisar com IA", o lote vira
// "analyzed" e deixa de ser "sem análise".
export function isAnalysisSkippedBatch(batch) {
  return Boolean(batch && batch.summary?.analysisSkipped === true && batch.status !== "analyzed");
}

// Detalhes do evento da linha do tempo — o mesmo evento do envio de sempre,
// com a marca "withoutAnalysis" quando foi sem análise.
export function buildCcaSentEventDetails({ submissionId, cca, documentCount, batchId, format, pendingCount, pdfSkipped, withoutAnalysis }) {
  return { submissionId, ccaId: cca.id, ccaName: cca.name, documentCount, batchId: batchId || null, format, pendingCount, pdfSkipped, withoutAnalysis: Boolean(withoutAnalysis) };
}
