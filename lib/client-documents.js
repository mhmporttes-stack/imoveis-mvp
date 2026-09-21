import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { getSimulationRegistration, updateSimulationRegistration } from "./simulation-registrations";
import { assertGeneralAdminOrManager, isAdminPermissionError } from "./admin-access";
import { createClientDocumentUploadTarget, getClientDocumentSignedUrl, deleteClientDocumentPaths } from "./media-storage";
import { analyzeClientDocumentBatch } from "./document-analysis";
import { DOCUMENT_TYPE_OPTIONS } from "./document-type-options";
import { logClientJourneyEvent, resolveActorSnapshot } from "./client-journey";
import { getCca } from "./cca";
import { toWhatsAppDigits } from "./phone-utils";

export { DOCUMENT_TYPE_OPTIONS };

export function canManageClientDocuments() {
  return hasSupabaseAdminConfig;
}

function db() {
  return getSupabaseAdminClient();
}

// Reaproveita 100% a checagem de acesso já existente (corretor responsável /
// gestor da equipe dele / admin geral) — getSimulationRegistration já lança
// AdminPermissionError internamente via assertCanAccessResponsibleUser. Não
// foi necessário criar uma função nova de "assertCanAccessClient".
async function requireClientAccess(clientId, auth) {
  const registration = await getSimulationRegistration(clientId, auth);
  if (!registration) throw new Error("Cliente não encontrado.");
  return registration;
}

/* -------------------------------- Upload ---------------------------------- */

// Cria o lote e devolve, para CADA arquivo, uma URL assinada de upload direto
// pro Storage (o corpo nunca passa pela função serverless da Vercel — mesmo
// motivo/padrão de createPropertyDocumentUploadTarget). O corretor manda
// tudo de uma vez (item 1/2 do pedido de lote); nenhuma classificação é
// pedida aqui.
export async function createDocumentBatch(clientId, files, auth) {
  const registration = await requireClientAccess(clientId, auth);
  if (!Array.isArray(files) || !files.length) throw new Error("Selecione ao menos um arquivo.");
  if (files.length > 40) throw new Error("Envie no máximo 40 arquivos por lote.");

  const { data: batch, error } = await db().from("client_document_batches").insert({
    client_id: registration.id,
    uploaded_by: auth?.profile?.id || null,
    status: "uploading",
    total_files: files.length
  }).select("*").single();
  if (error) throw error;

  const targets = [];
  for (const file of files) {
    const target = await createClientDocumentUploadTarget(registration.id, file.name, file.size, file.type);
    targets.push({ ...target, size: file.size, mimeType: file.type });
  }

  return { batchId: batch.id, uploads: targets };
}

// Chamada pelo navegador depois que TODOS os arquivos já subiram direto pro
// Storage via as URLs assinadas — registra as linhas de client_documents e
// já dispara a análise (não é uma etapa manual separada: "corretor solta os
// arquivos e recebe o resultado", sem clique de "analisar agora").
export async function confirmDocumentBatchUpload(batchId, uploadedFiles, auth) {
  const { data: batch, error: batchError } = await db().from("client_document_batches").select("*").eq("id", batchId).maybeSingle();
  if (batchError) throw batchError;
  if (!batch) throw new Error("Lote não encontrado.");
  const registration = await requireClientAccess(batch.client_id, auth);

  if (!Array.isArray(uploadedFiles) || !uploadedFiles.length) throw new Error("Nenhum arquivo confirmado.");

  const rows = uploadedFiles.map((file) => ({
    client_id: registration.id,
    batch_id: batchId,
    uploaded_by: auth?.profile?.id || null,
    filename: String(file.name || "documento").slice(0, 200),
    storage_path: file.path,
    mime_type: file.mimeType || "application/octet-stream",
    file_size: Number(file.size) || 0
  }));
  const { data: inserted, error } = await db().from("client_documents").insert(rows).select("id");
  if (error) throw error;

  const actor = resolveActorSnapshot(auth);
  await logClientJourneyEvent({
    clientId: registration.id,
    eventType: "document_batch_uploaded",
    actor,
    details: { batchId, fileCount: inserted?.length || rows.length }
  });

  await analyzeBatchNow(batchId, registration, actor);
  return getBatchDetail(batchId, auth);
}

/* ------------------------------- Análise IA -------------------------------- */

async function analyzeBatchNow(batchId, registration, actor) {
  await db().from("client_document_batches").update({ status: "processing" }).eq("id", batchId);

  const { data: documents, error: docsError } = await db().from("client_documents").select("id, filename, storage_path, mime_type").eq("batch_id", batchId).is("deleted_at", null);
  if (docsError) throw docsError;

  try {
    const { items, divergences } = await analyzeClientDocumentBatch({
      documents: (documents || []).map((doc) => ({ id: doc.id, filename: doc.filename, storagePath: doc.storage_path, mimeType: doc.mime_type }))
    });

    // Reanálise (item 12 anterior / item 15 deste pedido): nunca sobrescreve
    // um item que um humano já corrigiu manualmente — só substitui os itens
    // que ainda eram "opinião da IA". Evita perder trabalho de correção ao
    // enviar um complemento.
    await db().from("client_document_checklist_items").delete().eq("batch_id", batchId).is("corrected_by", null);

    if (items.length) {
      const rows = items.map((item) => ({
        batch_id: batchId,
        client_id: registration.id,
        document_id: item.documentId,
        person_label: item.personLabel,
        document_type: item.documentType,
        status: item.status,
        page_range: item.pageRange || null,
        observations: item.observations || null,
        confidence: item.confidence,
        extracted_data: item.extractedData || {}
      }));
      const { error: insertError } = await db().from("client_document_checklist_items").insert(rows);
      if (insertError) throw insertError;
    }

    const summary = computeSummary(items);
    await db().from("client_document_batches").update({
      status: "analyzed",
      summary,
      divergences,
      analyzed_at: new Date().toISOString(),
      error_message: null
    }).eq("id", batchId);

    await logClientJourneyEvent({
      clientId: registration.id,
      eventType: "document_batch_analyzed",
      actor,
      details: { batchId, ...summary, divergenceCount: divergences.length }
    });

    await notifyDocumentStakeholders(registration, {
      title: summary.pending || summary.absent ? "Documentação com pendências" : "Documentação analisada",
      description: `${registration.fullName}: ${summary.conform} conforme, ${summary.pending} pendência(s), ${summary.absent} ausente(s).`
    });
  } catch (analysisError) {
    await db().from("client_document_batches").update({
      status: "failed",
      error_message: String(analysisError?.message || "Falha na análise.").slice(0, 500)
    }).eq("id", batchId);
    await logClientJourneyEvent({ clientId: registration.id, eventType: "document_batch_analysis_failed", actor, details: { batchId, error: String(analysisError?.message || "") } });
    // Não relança — os arquivos continuam salvos (item 23: "se a IA falhar,
    // manter arquivos salvos, permitir reanalisar, não exigir novo upload").
  }
}

export async function reanalyzeBatch(batchId, auth) {
  const { data: batch, error } = await db().from("client_document_batches").select("*").eq("id", batchId).maybeSingle();
  if (error) throw error;
  if (!batch) throw new Error("Lote não encontrado.");
  const registration = await requireClientAccess(batch.client_id, auth);
  const actor = resolveActorSnapshot(auth);
  await analyzeBatchNow(batchId, registration, actor);
  return getBatchDetail(batchId, auth);
}

function computeSummary(items) {
  const summary = { total: items.length, conform: 0, pending: 0, illegible: 0, absent: 0, divergence: 0, needsConfirmation: 0 };
  for (const item of items) {
    if (item.status === "conforme") summary.conform += 1;
    else if (item.status === "pendencia") summary.pending += 1;
    else if (item.status === "ilegivel") summary.illegible += 1;
    else if (item.status === "ausente") summary.absent += 1;
    else if (item.status === "divergencia") summary.divergence += 1;
    else if (item.status === "precisa_confirmacao") summary.needsConfirmation += 1;
  }
  return summary;
}

/* ------------------------------- Leitura ----------------------------------- */

export async function listDocumentBatches(clientId, auth) {
  const registration = await requireClientAccess(clientId, auth);
  const { data, error } = await db().from("client_document_batches").select("*").eq("client_id", registration.id).order("created_at", { ascending: false });
  if (error) throw error;
  return (data || []).map(rowToBatch);
}

export async function getBatchDetail(batchId, auth) {
  const { data: batch, error } = await db().from("client_document_batches").select("*").eq("id", batchId).maybeSingle();
  if (error) throw error;
  if (!batch) return null;
  await requireClientAccess(batch.client_id, auth);

  const [{ data: documents, error: docsError }, { data: items, error: itemsError }] = await Promise.all([
    db().from("client_documents").select("*").eq("batch_id", batchId).is("deleted_at", null).order("created_at", { ascending: true }),
    db().from("client_document_checklist_items").select("*").eq("batch_id", batchId).order("person_label", { ascending: true })
  ]);
  if (docsError) throw docsError;
  if (itemsError) throw itemsError;

  return {
    ...rowToBatch(batch),
    documents: (documents || []).map(rowToDocument),
    checklist: (items || []).map(rowToChecklistItem)
  };
}

export async function getDocumentUrl(documentId, auth) {
  const { data: document, error } = await db().from("client_documents").select("id, client_id, storage_path").eq("id", documentId).maybeSingle();
  if (error) throw error;
  if (!document) throw new Error("Documento não encontrado.");
  await requireClientAccess(document.client_id, auth);
  return getClientDocumentSignedUrl(document.storage_path, 600);
}

export async function deleteClientDocument(documentId, auth) {
  const { data: document, error } = await db().from("client_documents").select("id, client_id, batch_id, storage_path").eq("id", documentId).maybeSingle();
  if (error) throw error;
  if (!document) throw new Error("Documento não encontrado.");
  const registration = await requireClientAccess(document.client_id, auth);

  await db().from("client_documents").update({ deleted_at: new Date().toISOString() }).eq("id", documentId);
  await deleteClientDocumentPaths([document.storage_path]);
  await db().from("client_document_checklist_items").update({ document_id: null, status: "ausente" }).eq("document_id", documentId);

  await logClientJourneyEvent({
    clientId: registration.id,
    eventType: "document_deleted",
    actor: resolveActorSnapshot(auth),
    details: { batchId: document.batch_id, documentId }
  });
  return { deleted: true };
}

// Correção manual (item 9: só como exceção) — só marca corrected_by/at
// quando o status ou tipo realmente for alterado por um humano; esse campo é
// o que protege o item de ser sobrescrito numa reanálise futura.
export async function correctChecklistItem(itemId, payload, auth) {
  const { data: current, error: readError } = await db().from("client_document_checklist_items").select("*").eq("id", itemId).maybeSingle();
  if (readError) throw readError;
  if (!current) throw new Error("Item do checklist não encontrado.");
  const registration = await requireClientAccess(current.client_id, auth);

  const updates = { corrected_by: auth?.profile?.id || null, corrected_at: new Date().toISOString(), updated_at: new Date().toISOString() };
  if (payload.documentType !== undefined) updates.document_type = String(payload.documentType || "nao_identificado");
  if (payload.personLabel !== undefined) updates.person_label = String(payload.personLabel || "Titular").slice(0, 120);
  if (payload.status !== undefined) updates.status = String(payload.status);
  if (payload.observations !== undefined) updates.observations = String(payload.observations || "").slice(0, 500) || null;

  const { data, error } = await db().from("client_document_checklist_items").update(updates).eq("id", itemId).select("*").single();
  if (error) throw error;

  await logClientJourneyEvent({
    clientId: registration.id,
    eventType: "document_checklist_corrected",
    actor: resolveActorSnapshot(auth),
    details: { batchId: current.batch_id, itemId, documentType: updates.document_type, status: updates.status }
  });

  return rowToChecklistItem(data);
}

/* ----------------------------- Envio para CCA ------------------------------- */

// Só monta a prévia (nunca envia nada sozinho — item 11 do pedido original:
// "não enviar automaticamente sem ação humana"). O corretor comum nunca
// chega aqui: a rota que chama isso já exige assertGeneralAdminOrManager.
export async function prepareCcaSubmission(clientId, batchId, payload, auth) {
  assertGeneralAdminOrManager(auth);
  const registration = await requireClientAccess(clientId, auth);
  const cca = await getCca(payload.ccaId);
  if (!cca || !cca.active) throw new Error("Selecione uma CCA ativa.");

  const missing = [];
  if (!registration.cpf) missing.push("CPF");
  if (!registration.pis) missing.push("PIS");
  const propertyType = payload.propertyType === "novo" || payload.propertyType === "usado" ? payload.propertyType : "";
  const propertyValue = payload.propertyValue ? Number(payload.propertyValue) : null;

  const detail = {
    clientName: registration.fullName,
    clientPhone: registration.phone,
    clientCode: registration.clientCode || "",
    cpf: registration.cpf || payload.cpf || "",
    pis: registration.pis || payload.pis || "",
    propertyType,
    propertyValue,
    propertyName: cleanOptional(payload.propertyName),
    brokerName: await getBrokerName(registration.responsibleUserId)
  };
  if (!detail.cpf) missing.push("CPF");
  if (!detail.pis) missing.push("PIS");

  const documentCount = batchId ? await countBatchDocuments(batchId) : await countClientDocuments(clientId);
  const message = buildWhatsappMessage(detail);

  return { cca: { id: cca.id, name: cca.name, companyName: cca.companyName, whatsapp: cca.whatsapp }, detail, missing: Array.from(new Set(missing)), documentCount, message };
}

export async function submitToCca(clientId, batchId, payload, auth) {
  assertGeneralAdminOrManager(auth);
  const registration = await requireClientAccess(clientId, auth);
  const cca = await getCca(payload.ccaId);
  if (!cca || !cca.active) throw new Error("Selecione uma CCA ativa.");

  // Preenche CPF/PIS no cadastro do cliente quando informados agora, pra
  // nunca mais precisar perguntar de novo (item 12 original).
  const clientUpdates = {};
  if (payload.cpf && payload.cpf !== registration.cpf) clientUpdates.cpf = String(payload.cpf).replace(/\D/g, "").slice(0, 14);
  if (payload.pis && payload.pis !== registration.pis) clientUpdates.pis = String(payload.pis).replace(/\D/g, "").slice(0, 20);
  if (Object.keys(clientUpdates).length) {
    // updateSimulationRegistration NUNCA transfere responsável a menos que
    // explicitamente pedido — aqui não passamos responsibleUserId, então o
    // responsável atual do cliente continua intocado (item 16 do 1º pedido).
    await updateSimulationRegistration(clientId, clientUpdates, auth);
  }

  const detail = {
    clientName: registration.fullName,
    propertyType: payload.propertyType === "novo" || payload.propertyType === "usado" ? payload.propertyType : "",
    propertyValue: payload.propertyValue ? Number(payload.propertyValue) : null,
    propertyName: cleanOptional(payload.propertyName),
    brokerName: await getBrokerName(registration.responsibleUserId)
  };
  const message = buildWhatsappMessage(detail);
  const documentCount = batchId ? await countBatchDocuments(batchId) : await countClientDocuments(clientId);

  const { data: submission, error } = await db().from("client_document_submissions").insert({
    client_id: registration.id,
    batch_id: batchId || null,
    cca_id: cca.id,
    created_by: auth?.profile?.id || null,
    message,
    document_count: documentCount,
    details: detail
  }).select("*").single();
  if (error) throw error;

  await logClientJourneyEvent({
    clientId: registration.id,
    eventType: "document_sent_to_cca",
    actor: resolveActorSnapshot(auth),
    details: { submissionId: submission.id, ccaId: cca.id, ccaName: cca.name, documentCount, batchId: batchId || null }
  });

  const whatsappUrl = `https://wa.me/${toWhatsAppDigits(cca.whatsapp)}?text=${encodeURIComponent(message)}`;
  return { submissionId: submission.id, whatsappUrl, message, documentCount };
}

function buildWhatsappMessage(detail) {
  const parts = [`Olá! Segue a documentação de ${detail.clientName} para análise.`];
  const operationParts = [];
  if (detail.propertyType) operationParts.push(detail.propertyType === "novo" ? "Imóvel novo" : "Imóvel usado");
  if (detail.propertyValue) operationParts.push(formatCurrency(detail.propertyValue));
  if (detail.propertyName) operationParts.push(detail.propertyName);
  if (operationParts.length) parts.push(operationParts.join(" • "));
  if (detail.brokerName) parts.push(`Corretor: ${detail.brokerName}`);
  return parts.join("\n");
}

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}

async function countBatchDocuments(batchId) {
  const { count, error } = await db().from("client_documents").select("id", { count: "exact", head: true }).eq("batch_id", batchId).is("deleted_at", null);
  if (error) throw error;
  return count || 0;
}

async function countClientDocuments(clientId) {
  const { count, error } = await db().from("client_documents").select("id", { count: "exact", head: true }).eq("client_id", clientId).is("deleted_at", null);
  if (error) throw error;
  return count || 0;
}

/* ------------------------------ Notificações -------------------------------- */

// Nunca hardcoda uma pessoa específica ("Caroline") — notifica genericamente
// quem já é responsável por esse cliente na hierarquia real (o corretor
// responsável + o(s) gestor(es) dele, via manager_id/managedUserIds, que já
// é exatamente como o resto do sistema define "quem gerencia quem") mais os
// administradores gerais. Evita duplicidade: cada destinatário recebe no
// máximo 1 notificação por chamada desta função.
async function notifyDocumentStakeholders(registration, { title, description }) {
  try {
    const recipients = new Set();
    if (registration.responsibleUserId) recipients.add(registration.responsibleUserId);

    const { data: managers } = await db().from("admin_users").select("id").eq("role", "admin");
    for (const row of managers || []) recipients.add(row.id);

    if (registration.responsibleUserId) {
      const { data: brokerRow } = await db().from("admin_users").select("manager_id").eq("id", registration.responsibleUserId).maybeSingle();
      if (brokerRow?.manager_id) recipients.add(brokerRow.manager_id);
    }

    const now = new Date().toISOString();
    const rows = Array.from(recipients).map((recipientId) => ({
      recipient_user_id: recipientId,
      client_id: registration.id,
      title: title.slice(0, 160),
      description: description.slice(0, 500),
      notification_type: "document_analysis",
      scheduled_at: now
    }));
    if (rows.length) await db().from("crm_notifications").insert(rows);
  } catch (notifyError) {
    console.warn("Falha ao notificar sobre análise documental:", notifyError?.message || notifyError);
  }
}

async function getBrokerName(brokerId) {
  if (!brokerId) return "";
  const { data } = await db().from("admin_users").select("name").eq("id", brokerId).maybeSingle();
  return data?.name || "";
}

function cleanOptional(value) {
  const text = String(value ?? "").trim();
  return text || null;
}

function rowToBatch(row) {
  return {
    id: row.id,
    clientId: row.client_id,
    status: row.status,
    totalFiles: row.total_files,
    summary: row.summary || {},
    divergences: row.divergences || [],
    errorMessage: row.error_message || "",
    createdAt: row.created_at,
    analyzedAt: row.analyzed_at
  };
}

function rowToDocument(row) {
  return {
    id: row.id,
    filename: row.filename,
    mimeType: row.mime_type,
    fileSize: row.file_size,
    createdAt: row.created_at
  };
}

function rowToChecklistItem(row) {
  const typeOption = DOCUMENT_TYPE_OPTIONS.find((option) => option.key === row.document_type);
  return {
    id: row.id,
    documentId: row.document_id,
    personLabel: row.person_label,
    documentType: row.document_type,
    documentTypeLabel: typeOption?.label || row.document_type,
    status: row.status,
    pageRange: row.page_range || "",
    observations: row.observations || "",
    confidence: row.confidence,
    extractedData: row.extracted_data || {},
    corrected: Boolean(row.corrected_by),
    correctedAt: row.corrected_at
  };
}

export function formatClientDocumentsError(error) {
  if (isAdminPermissionError(error)) return "Você não tem acesso à documentação deste cliente.";
  const message = error?.message || String(error || "");
  if (message.toLowerCase().includes("anthropic_api_key")) return "A análise por IA ainda não está configurada (falta a chave da API no servidor).";
  return message || "Não foi possível concluir a operação de documentação.";
}
