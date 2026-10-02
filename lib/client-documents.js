import "server-only";
import { getSupabaseAdminClient, hasSupabaseAdminConfig } from "./supabase";
import { getSimulationRegistration, updateSimulationRegistration } from "./simulation-registrations";
import { assertGeneralAdminOrManager, isAdminPermissionError } from "./admin-access";
import { createClientDocumentUploadTarget, getClientDocumentSignedUrl, deleteClientDocumentPaths, downloadClientDocumentBuffer, CLIENT_DOCS_BUCKET, CHAT_MEDIA_BUCKET } from "./media-storage";
import { getConversationForGuide, openChatForClient, sendChatMessage } from "./whatsapp-chat";
import { ensureInboundMediaStored } from "./whatsapp-media";
import { calculateBankIncomeForClient, pendingClientMessage, partitionChatSelection, extractSelectedContactFacts, visibleDocumentDivergences } from "./document-policy.mjs";
import { uniqueDocumentBytes } from "./document-identity.mjs";
import { analyzeClientDocumentBatch } from "./document-analysis";
import { listDocumentAiRules } from "./document-ai-rules";
import { evaluateDocumentRequirements } from "./document-requirements-engine";
import { recordAiUsage } from "./ai-usage";
import { DOCUMENT_TYPE_OPTIONS } from "./document-type-options";
import { logClientJourneyEvent, resolveActorSnapshot } from "./client-journey";
import { getCca } from "./cca";
import { openInitialCcaStatusOnSend } from "./client-cca-status";
import { toWhatsAppDigits } from "./phone-utils";
import { buildClientDocumentPdf, buildClientDocumentFolder } from "./client-document-pdf";
import { CLIENT_STATUS } from "./client-status";
import { assertProspectingStatusChangeAllowed } from "./prospecting-status-lock";
import { MARITAL_LABELS } from "./document-status-labels";

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

  await analyzeBatchNow(batchId, registration, actor, auth);
  return getBatchDetail(batchId, auth);
}

// Importa SOMENTE as mensagens escolhidas na conversa, usando a mesma análise
// e o mesmo checklist de um lote enviado pelo card. A cópia privada preserva
// o arquivo caso a mídia temporária do WhatsApp deixe de existir.
export async function analyzeSelectedChatMessages(conversationId, messageIds, auth, requestKey = "") {
  const conversation = await getConversationForGuide(conversationId, auth);
  if (!conversation.client_id) throw new Error("Vincule a conversa a um cliente antes de analisar documentação.");
  const registration = await requireClientAccess(conversation.client_id, auth);
  const key = /^[0-9a-f-]{36}$/i.test(requestKey) ? requestKey : "";
  if (key) {
    const { data: existing, error: lookupError } = await db().from("client_document_batches").select("id")
      .eq("client_id", registration.id).eq("summary->>sourceRequestKey", key).maybeSingle();
    if (lookupError) throw lookupError;
    if (existing) return getBatchDetail(existing.id, auth);
  }
  const ids = [...new Set((messageIds || []).filter((id) => /^[0-9a-f-]{36}$/i.test(id)))].slice(0, 40);
  if (!ids.length) throw new Error("Selecione ao menos um arquivo ou mensagem.");
  const { data: messages, error } = await db().from("whatsapp_messages").select("*").eq("conversation_id", conversationId).in("id", ids);
  if (error) throw error;
  if (messages?.length !== ids.length) throw new Error("Uma das mensagens selecionadas não pertence a esta conversa.");
  const { texts: textMessages, media: mediaMessages } = partitionChatSelection(messages, ids);
  if (!textMessages.length && !mediaMessages.length) throw new Error("Selecione textos, imagens ou PDFs para análise.");
  const { data: batch, error: batchError } = await db().from("client_document_batches").insert({ client_id: registration.id, uploaded_by: auth.profile?.id || null, status: "uploading", total_files: mediaMessages.length, summary: { sourceConversationId: conversationId, sourceRequestKey: key, selectedMessages: textMessages, selectedFiles: mediaMessages.map((row) => row.id) } }).select("*").single();
  if (batchError) throw batchError;
  const uploadedPaths = [];
  const unavailableFiles = [];
  try {
    for (const row of mediaMessages) {
      let buffer;
      let mime;
      let media;
      try {
      media = row.metadata?.media;
      if (row.direction === "inbound") media = await ensureInboundMediaStored(row);
      if (row.direction === "outbound" && !media?.path && media?.url) {
        // Mensagens anteriores guardavam apenas a URL pública do bucket conhecido.
        // Aceitar somente a URL gerada pelo nosso Storage, nunca um endereço arbitrário.
        const publicBase = db().storage.from(CHAT_MEDIA_BUCKET).getPublicUrl("legacy-placeholder").data.publicUrl.replace(/legacy-placeholder$/, "");
        if (media.url.startsWith(publicBase)) {
          const legacyPath = decodeURIComponent(media.url.slice(publicBase.length));
          if (/^sent\/[A-Za-z0-9._/-]+$/.test(legacyPath) && !legacyPath.includes("..")) media = { ...media, path: legacyPath, bucket: CHAT_MEDIA_BUCKET };
        }
      }
      if (!media?.path) throw new Error(`Mídia indisponível: ${row.id}.`);
      const bucket = media.bucket || (row.direction === "inbound" ? "whatsapp-inbound-media" : CHAT_MEDIA_BUCKET);
      const { data: source, error: sourceError } = await db().storage.from(bucket).download(media.path);
      if (sourceError || !source) throw new Error("Não foi possível ler uma mídia selecionada.");
      buffer = Buffer.from(await source.arrayBuffer());
      mime = String(media.mime || "").split(";")[0].toLowerCase();
      if (!["application/pdf", "image/jpeg", "image/png", "image/webp"].includes(mime) || buffer.length > 20_000_000) throw new Error("Selecione apenas PDF/JPG/PNG/WEBP de até 20 MB.");
      } catch (mediaError) {
        unavailableFiles.push({ id: row.id, name: media?.name || `Arquivo ${row.id.slice(0, 8)}`, reason: "Não foi possível carregar este arquivo." });
        continue;
      }
      const target = await createClientDocumentUploadTarget(registration.id, media.name || `chat-${row.id}`, buffer.length, mime);
      const { error: uploadError } = await db().storage.from(CLIENT_DOCS_BUCKET).upload(target.path, buffer, { contentType: mime });
      if (uploadError) throw uploadError;
      uploadedPaths.push(target.path);
      const { error: insertError } = await db().from("client_documents").insert({ client_id: registration.id, batch_id: batch.id, uploaded_by: auth.profile?.id || null, filename: media.name || `chat-${row.id}`, storage_path: target.path, mime_type: mime, file_size: buffer.length });
      if (insertError) throw insertError;
    }
    if (!uploadedPaths.length && !textMessages.length) throw new Error("Nenhum arquivo selecionado está disponível para análise.");
    if (unavailableFiles.length) {
      const { error: summaryError } = await db().from("client_document_batches").update({ summary: { ...batch.summary, unavailableFiles } }).eq("id", batch.id);
      if (summaryError) throw summaryError;
    }
    if (!registration.phone && conversation.contact_phone) await updateSimulationRegistration(registration.id, { phone: conversation.contact_phone }, auth);
    return { ...(await getBatchDetail(batch.id, auth)), queued: true };
  } catch (failure) {
    if (uploadedPaths.length) await deleteClientDocumentPaths(uploadedPaths);
    await db().from("client_document_batches").delete().eq("id", batch.id);
    throw failure;
  }
}

export async function queueChatDocumentRetry(batchId, conversationId, auth) {
  const batch = await getBatchDetail(batchId, auth);
  if (batch?.summary?.sourceConversationId !== conversationId) throw new Error("Este lote não pertence à conversa.");
  if (batch.status !== "failed") return batch;
  const { error } = await db().from("client_document_batches").update({ status: "uploading", error_message: null }).eq("id", batchId).eq("status", "failed");
  if (error) throw error;
  return { ...batch, status: "uploading", queued: true };
}

export async function markChatBatchStartFailure(batchId, failure) {
  await db().from("client_document_batches").update({ status: "failed", error_message: String(failure?.message || "Falha ao iniciar análise.").slice(0, 500) }).eq("id", batchId);
}

export async function sendDocumentPendingMessage(batchId, conversationId, message, auth) {
  const { data: batch, error } = await db().from("client_document_batches").select("id, client_id, summary").eq("id", batchId).single();
  if (error) throw error;
  await requireClientAccess(batch.client_id, auth);
  let target = conversationId;
  if (!target) target = (await openChatForClient(batch.client_id, auth)).conversationId;
  const conversation = await getConversationForGuide(target, auth);
  if (conversation.client_id !== batch.client_id) throw new Error("A conversa não pertence a este cliente.");
  const text = String(message || "").trim().slice(0, 3000);
  if (!text) throw new Error("A mensagem está vazia.");
  const sent = await sendChatMessage(target, text, auth);
  const { error: updateError } = await db().from("client_document_batches").update({ summary: { ...batch.summary, sentMessage: text, sentAt: new Date().toISOString() } }).eq("id", batchId);
  if (updateError) throw updateError;
  return sent;
}

/* ------------------------------- Análise IA -------------------------------- */

function buildClientContext(registration) {
  return {
    fullName: registration.fullName,
    primaryMaritalStatus: registration.primaryMaritalStatus,
    primaryIncomeType: registration.primaryIncomeType,
    simulationType: registration.simulationType,
    secondaryMaritalStatus: registration.secondaryMaritalStatus,
    secondaryIncomeType: registration.secondaryIncomeType,
    cpf: registration.cpf,
    pis: registration.pis,
    hasChildrenUnder18: Boolean(registration.hasChildrenUnder18),
    phone: registration.phone, email: registration.email, oldestBirthDate: registration.oldestBirthDate,
    primaryProfession: registration.primaryProfession, secondaryProfession: registration.secondaryProfession,
    primaryMonthlyIncome: registration.primaryMonthlyIncome, secondaryMonthlyIncome: registration.secondaryMonthlyIncome
  };
}

function rowToEngineItem(row) {
  return {
    documentId: row.document_id,
    personRole: row.person_role || "outro",
    documentType: row.document_type,
    status: row.status,
    extractedData: row.extracted_data || {},
    confidence: row.confidence
  };
}

// Chamada só com os documentos NOVOS de um lote (item 26/49 do pedido: a IA
// classifica, o motor determinístico decide o que falta cruzando com TODO o
// histórico do cliente — não só este lote). Documentos já classificados em
// lotes anteriores nunca são reenviados à IA.
async function analyzeBatchNow(batchId, registration, actor, auth) {
  await db().from("client_document_batches").update({ status: "processing" }).eq("id", batchId);

  const { data: documents, error: docsError } = await db().from("client_documents").select("id, filename, storage_path, mime_type").eq("batch_id", batchId).is("deleted_at", null);
  if (docsError) throw docsError;
  const triggeredBy = auth?.profile?.id || null;
  const clientContext = buildClientContext(registration);

  try {
    const activeRules = await listDocumentAiRules({ activeOnly: true });
    const { data: sourceBatch } = await db().from("client_document_batches").select("summary").eq("id", batchId).single();
    const [{ data: priorItems, error: priorError }, { data: allDocuments, error: allDocsError }] = await Promise.all([
      db().from("client_document_checklist_items").select("document_id, document_type, person_role, status, extracted_data").eq("client_id", registration.id).not("document_id", "is", null).neq("batch_id", batchId).limit(100),
      db().from("client_documents").select("id, storage_path").eq("client_id", registration.id).is("deleted_at", null).order("created_at", { ascending: true })
    ]);
    if (priorError) throw priorError;
    if (allDocsError) throw allDocsError;
    const { unique, duplicates } = await uniqueDocumentBytes(allDocuments || documents || [], (doc) => downloadClientDocumentBuffer(doc.storage_path));
    const uniqueIds = new Set(unique.map((doc) => doc.id));
    const previousEvidence = (priorItems || []).filter((row) => uniqueIds.has(row.document_id)).map((row) => ({ documentType: row.document_type, personRole: row.person_role, status: row.status, extractedData: row.extracted_data }));
    const { items, divergences, usage, messageFacts } = await analyzeClientDocumentBatch({
      documents: (documents || []).filter((doc) => uniqueIds.has(doc.id)).map((doc) => ({ id: doc.id, filename: doc.filename, storagePath: doc.storage_path, mimeType: doc.mime_type })),
      clientContext,
      rules: activeRules,
      selectedMessages: sourceBatch?.summary?.selectedMessages || [],
      previousEvidence
    });
    if (activeRules.some((rule) => rule.ruleKey === "marriage_spouse") && ["single", "divorced"].includes(registration.primaryMaritalStatus) && [...items.map((item) => ({ documentType: item.documentType, personRole: item.personRole, extractedData: item.extractedData })), ...previousEvidence].some((item) => item.personRole === "titular" && item.documentType === "certidao_casamento" && item.extractedData?.divorceAnnotation === false)) {
      divergences.push({ description: "Certidão de casamento sem averbação de divórcio diverge do estado civil cadastrado; confira o vínculo antes de concluir.", documentTypes: ["certidao_casamento"] });
    }

    await recordAiUsage({
      batchId,
      clientId: registration.id,
      triggeredBy,
      model: usage?.model,
      inputTokens: usage?.inputTokens,
      outputTokens: usage?.outputTokens,
      cacheCreationTokens: usage?.cacheCreationTokens,
      cacheReadTokens: usage?.cacheReadTokens,
      costUsd: usage?.costUsd,
      success: true
    });

    // Só troca as linhas de CLASSIFICAÇÃO (document_id preenchido) DESTE
    // lote — nunca as de outros lotes, e nunca uma que um humano já corrigiu.
    // As linhas de "requisito faltando" (document_id nulo) são recalculadas
    // à parte, abaixo, para o cliente inteiro.
    await db().from("client_document_checklist_items").delete().eq("batch_id", batchId).is("corrected_by", null).not("document_id", "is", null);

    if (items.length) {
      const rows = items.map((item) => ({
        batch_id: batchId,
        client_id: registration.id,
        document_id: item.documentId,
        person_label: item.personLabel,
        person_role: item.personRole,
        document_type: item.documentType,
        status: item.status,
        page_range: item.pageRange || null,
        observations: item.observations || null,
        confidence: item.confidence,
        // "expired" não tem coluna própria — vai dentro do extracted_data
        // (jsonb), usado pela categoria "Documentos vencidos" do aviso ao
        // corretor (lib/broker-alert.js).
        extracted_data: { ...(item.extractedData || {}), expired: Boolean(item.expired), ...(item.ruleTrace ? { analysisTrace: { document: item.documentType, ...item.ruleTrace } } : {}) }
      }));
      const { error: insertError } = await db().from("client_document_checklist_items").insert(rows);
      if (insertError) throw insertError;
    }

    const selectedFacts = extractSelectedContactFacts(sourceBatch?.summary?.selectedMessages || []);
    const facts = {};
    if (!registration.email) facts.email = selectedFacts.email;
    if (!registration.pis) facts.pis = selectedFacts.pis;
    if (facts.email || facts.pis) await updateSimulationRegistration(registration.id, Object.fromEntries(Object.entries(facts).filter(([, value]) => value)), auth);
    const requirementCounts = await recomputeRequirements({ ...registration, ...facts }, { ...clientContext, ...facts }, batchId, auth, activeRules);
    const { data: consolidated } = await db().from("client_document_checklist_items").select("person_role, document_type, status, observations, extracted_data").eq("client_id", registration.id);
    const checklist = (consolidated || []).map((row) => ({ personRole: row.person_role, documentType: row.document_type, documentTypeLabel: DOCUMENT_TYPE_OPTIONS.find((option) => option.key === row.document_type)?.label || row.document_type, status: row.status, observations: row.observations }));
    const evidence = [...previousEvidence, ...items.map((item) => ({ extractedData: item.extractedData }))];
    const income = activeRules.some((rule) => rule.ruleKey === "bank_income") ? calculateBankIncomeForClient(evidence.flatMap((item) => item.extractedData?.bankMonths || []), { clientName: registration.fullName, spouseNames: evidence.map((item) => item.extractedData?.spouseName).filter(Boolean), relativeNames: evidence.flatMap((item) => [...(item.extractedData?.parentNames || []), ...(item.extractedData?.childNames || [])]) }) : null;

    await db().from("client_document_batches").update({
      status: "analyzed",
      summary: { ...sourceBatch?.summary, ...computeSummary(items), duplicateDocumentIds: duplicates, ruleRevision: ruleRevision(activeRules), usedRules: activeRules.map((rule) => ({ id: rule.id, title: rule.title, updatedAt: rule.updatedAt })), messageFacts, income, generatedMessage: pendingClientMessage(checklist) },
      divergences,
      analyzed_at: new Date().toISOString(),
      error_message: null
    }).eq("id", batchId);

    await logClientJourneyEvent({
      clientId: registration.id,
      eventType: "document_batch_analyzed",
      actor,
      details: { batchId, newFiles: items.length, divergenceCount: divergences.length, ...requirementCounts }
    });

    await notifyDocumentStakeholders(registration, {
      title: requirementCounts.pending || requirementCounts.absent ? "Documentação com pendências" : "Documentação analisada",
      description: `${registration.fullName}: ${requirementCounts.absent} documento(s) faltando, ${requirementCounts.pending} pendência(s) de quantidade.`
    });
  } catch (analysisError) {
    await db().from("client_document_batches").update({
      status: "failed",
      error_message: String(analysisError?.message || "Falha na análise.").slice(0, 500)
    }).eq("id", batchId);
    await recordAiUsage({
      batchId,
      clientId: registration.id,
      triggeredBy,
      model: process.env.ANTHROPIC_DOCUMENT_MODEL || "claude-sonnet-5",
      success: false,
      errorMessage: analysisError?.message
    });
    await logClientJourneyEvent({ clientId: registration.id, eventType: "document_batch_analysis_failed", actor, details: { batchId, error: String(analysisError?.message || "") } });
    // Não relança — os arquivos continuam salvos (item 23: "se a IA falhar,
    // manter arquivos salvos, permitir reanalisar, não exigir novo upload").
  }
}

// Recalcula, por CÓDIGO (zero tokens de IA), quais requisitos ainda estão em
// aberto — usando TODA a classificação já existente do cliente (de qualquer
// lote) contra o cadastro atual dele. Preserva qualquer linha que um
// gestor/admin já corrigiu manualmente (nunca some por causa de um
// recálculo). Retorna as contagens pra notificação/telemetria.
//
// A identidade de cada linha de requisito é (client_id, person_role,
// document_type) — NUNCA person_label (texto livre, pode variar entre
// recálculos por acento/capitalização e já causou duplicata real em
// produção). O índice único parcial client_document_checklist_items_
// requirement_key garante isso no banco. O índice é parcial e exige
// update/insert com tratamento de colisão, pois o onConflict simples do
// PostgREST não consegue inferi-lo.
async function recomputeRequirements(registration, clientContext, batchId, auth, activeRules = []) {
  const { data: classifiedRows, error: classifiedError } = await db()
    .from("client_document_checklist_items")
    .select("document_id, person_role, document_type, status, extracted_data, confidence")
    .eq("client_id", registration.id)
    .not("document_id", "is", null);
  if (classifiedError) throw classifiedError;

  const { data: existingRequirementRows, error: existingError } = await db()
    .from("client_document_checklist_items")
    .select("id, person_role, document_type, corrected_by")
    .eq("client_id", registration.id)
    .is("document_id", null);
  if (existingError) throw existingError;
  const preservedKeys = new Set((existingRequirementRows || []).filter((row) => row.corrected_by).map((row) => `${row.person_role}::${row.document_type}`));

  const classifiedItems = (classifiedRows || []).map(rowToEngineItem);
  const computedRows = evaluateDocumentRequirements(clientContext, classifiedItems, activeRules);
  const freshKeys = new Set(computedRows.map((row) => `${row.personRole}::${row.documentType}`));

  // Requisitos que já foram satisfeitos (ou deixaram de se aplicar) não
  // aparecem mais no cálculo — some a linha antiga correspondente, exceto
  // as corrigidas manualmente.
  const staleIds = (existingRequirementRows || [])
    .filter((row) => !row.corrected_by && !freshKeys.has(`${row.person_role}::${row.document_type}`))
    .map((row) => row.id);
  if (staleIds.length) {
    const { error: deleteError } = await db().from("client_document_checklist_items").delete().in("id", staleIds);
    if (deleteError) throw deleteError;
  }

  const toUpsert = computedRows.filter((row) => !preservedKeys.has(`${row.personRole}::${row.documentType}`));
  if (toUpsert.length) {
    for (const row of toUpsert) {
      const record = {
      batch_id: batchId,
      client_id: registration.id,
      document_id: null,
      person_label: row.personLabel,
      person_role: row.personRole,
      document_type: row.documentType,
      status: row.status,
      observations: row.observations,
      extracted_data: { analysisTrace: { document: row.documentType, problem: row.observations, ruleId: "system_requirement", justification: row.observations } }
      };
      const current = existingRequirementRows.find((item) => item.person_role === row.personRole && item.document_type === row.documentType);
      if (current) {
        const { error } = await db().from("client_document_checklist_items").update(record).eq("id", current.id);
        if (error) throw error;
      } else {
        const { error } = await db().from("client_document_checklist_items").insert(record);
        if (error?.code === "23505") {
          // O índice único é parcial (document_id IS NULL). PostgREST não
          // consegue referenciá-lo em onConflict; colisão concorrente atualiza.
          const { error: retryError } = await db().from("client_document_checklist_items").update(record)
            .eq("client_id", registration.id).eq("person_role", row.personRole)
            .eq("document_type", row.documentType).is("document_id", null).is("corrected_by", null);
          if (retryError) throw retryError;
        } else if (error) throw error;
      }
    }
  }

  await maybeAutoFillCpfPis(registration, classifiedItems, auth);

  return {
    absent: computedRows.filter((row) => row.status === "ausente").length,
    pending: computedRows.filter((row) => row.status === "pendencia").length
  };
}

// Item 19 do pedido: uma vez que CPF/PIS foram extraídos com confiança
// razoável de algum documento do titular, gravam no cadastro do cliente —
// nunca sobrescreve um valor que já existia (só preenche o que estava
// vazio), então nunca some com uma correção humana anterior.
async function maybeAutoFillCpfPis(registration, classifiedItems, auth) {
  const updates = {};
  if (!registration.cpf) {
    const found = classifiedItems.find((item) => item.personRole === "titular" && item.extractedData?.cpf && (item.confidence == null || item.confidence >= 0.7));
    if (found) updates.cpf = String(found.extractedData.cpf).replace(/\D/g, "").slice(0, 14);
  }
  if (!registration.pis) {
    const found = classifiedItems.find((item) => item.personRole === "titular" && item.extractedData?.pis && (item.confidence == null || item.confidence >= 0.7));
    if (found) updates.pis = String(found.extractedData.pis).replace(/\D/g, "").slice(0, 20);
  }
  if (Object.keys(updates).length) {
    await updateSimulationRegistration(registration.id, updates, auth);
  }
}

export async function reanalyzeBatch(batchId, auth) {
  const { data: batch, error } = await db().from("client_document_batches").select("*").eq("id", batchId).maybeSingle();
  if (error) throw error;
  if (!batch) throw new Error("Lote não encontrado.");
  const registration = await requireClientAccess(batch.client_id, auth);
  const actor = resolveActorSnapshot(auth);

  const { data: docs, error: docsError } = await db().from("client_documents").select("id").eq("batch_id", batchId).is("deleted_at", null);
  if (docsError) throw docsError;
  const docIds = (docs || []).map((doc) => doc.id);

  let allAlreadyClassified = false;
  if (docIds.length) {
    const { data: classified, error: classifiedError } = await db().from("client_document_checklist_items").select("document_id").eq("batch_id", batchId).not("document_id", "is", null);
    if (classifiedError) throw classifiedError;
    const classifiedIds = new Set((classified || []).map((row) => row.document_id));
    allAlreadyClassified = docIds.every((id) => classifiedIds.has(id));
  }

  const activeRules = await listDocumentAiRules({ activeOnly: true });
  if (allAlreadyClassified && batch.summary?.ruleRevision === ruleRevision(activeRules)) {
    // Nada de novo pra IA ler — provavelmente o cadastro do cliente (estado
    // civil/renda) mudou. Só recalcula o motor por código, sem gastar tokens
    // (item 32/50 do pedido: "não reler PDFs, só recalcular").
    const clientContext = buildClientContext(registration);
    await recomputeRequirements(registration, clientContext, batchId, auth, activeRules);
    await db().from("client_document_batches").update({ status: "analyzed", error_message: null }).eq("id", batchId);
    await logClientJourneyEvent({ clientId: registration.id, eventType: "document_checklist_recomputed", actor, details: { batchId } });
  } else {
    await analyzeBatchNow(batchId, registration, actor, auth);
  }
  return getBatchDetail(batchId, auth);
}

function ruleRevision(rules) {
  return JSON.stringify(rules.map(({ id, updatedAt }) => [id, updatedAt]).sort(([a], [b]) => a.localeCompare(b)));
}

// Resumo dos arquivos DESTE lote (a IA nunca retorna "ausente" — esse
// conceito agora só existe nas linhas de requisito calculadas pelo motor,
// visíveis no checklist do cliente, não aqui).
function computeSummary(items) {
  const summary = { total: items.length, conform: 0, pending: 0, illegible: 0, divergence: 0, needsConfirmation: 0 };
  for (const item of items) {
    if (item.status === "conforme") summary.conform += 1;
    else if (item.status === "pendencia") summary.pending += 1;
    else if (item.status === "ilegivel") summary.illegible += 1;
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

// O checklist é uma visão do CLIENTE inteiro (não só deste lote) — um
// documento enviado num lote anterior continua contando pro que já está
// satisfeito hoje. "documents" continua restrito a este lote (é o que
// aparece pra ver/excluir arquivo daquele envio específico); "divergences"
// agrega os lotes analisados do cliente, sem repetir a mesma descrição.
export async function getBatchDetail(batchId, auth) {
  const { data: batch, error } = await db().from("client_document_batches").select("*").eq("id", batchId).maybeSingle();
  if (error) throw error;
  if (!batch) return null;
  await requireClientAccess(batch.client_id, auth);

  const [{ data: documents, error: docsError }, { data: items, error: itemsError }, { data: clientBatches, error: batchesError }] = await Promise.all([
    db().from("client_documents").select("*").eq("batch_id", batchId).is("deleted_at", null).order("created_at", { ascending: true }),
    db().from("client_document_checklist_items").select("*").eq("client_id", batch.client_id).order("person_label", { ascending: true }),
    db().from("client_document_batches").select("divergences").eq("client_id", batch.client_id).eq("status", "analyzed")
  ]);
  if (docsError) throw docsError;
  if (itemsError) throw itemsError;
  if (batchesError) throw batchesError;

  const divergences = visibleDocumentDivergences((clientBatches || []).flatMap((row) => row.divergences || []));

  return {
    ...rowToBatch(batch),
    divergences,
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
  // A linha de classificação desse arquivo deixou de fazer sentido (não é
  // mais "ausente" — o motor que decide isso, abaixo). Corrigida
  // manualmente ou não, some junto com o arquivo.
  await db().from("client_document_checklist_items").delete().eq("document_id", documentId);

  const clientContext = buildClientContext(registration);
  await recomputeRequirements(registration, clientContext, document.batch_id, auth, await listDocumentAiRules({ activeOnly: true }));

  await logClientJourneyEvent({
    clientId: registration.id,
    eventType: "document_deleted",
    actor: resolveActorSnapshot(auth),
    details: { batchId: document.batch_id, documentId }
  });
  return { deleted: true };
}

// "Excluir tudo e recomeçar" — apaga TODO o histórico de documentação do
// cliente (arquivos no Storage, classificações, requisitos calculados,
// lotes e envios pra CCA já feitos) pra permitir reenviar do zero e testar.
// Só gestor/admin — é destrutivo e não tem como desfazer. Não mexe em mais
// nada do cadastro do cliente (nome, status, CPF/PIS/e-mail continuam).
export async function deleteAllClientDocuments(clientId, auth) {
  assertGeneralAdminOrManager(auth);
  const registration = await requireClientAccess(clientId, auth);

  const [{ data: documents }, { data: submissions }] = await Promise.all([
    db().from("client_documents").select("storage_path").eq("client_id", clientId),
    db().from("client_document_submissions").select("merged_pdf_path, details").eq("client_id", clientId)
  ]);

  const paths = [
    ...(documents || []).map((row) => row.storage_path),
    ...(submissions || []).map((row) => row.merged_pdf_path).filter(Boolean)
  ];
  if (paths.length) await deleteClientDocumentPaths(paths);
  const folderPaths = (submissions || []).filter((row) => row.details?.format === "folder" && row.details?.packagePath).map((row) => row.details.packagePath);
  if (folderPaths.length) await db().storage.from("client-document-packages").remove(folderPaths);

  await db().from("client_document_checklist_items").delete().eq("client_id", clientId);
  await db().from("client_documents").delete().eq("client_id", clientId);
  await db().from("client_document_submissions").delete().eq("client_id", clientId);
  await db().from("client_document_batches").delete().eq("client_id", clientId);

  await logClientJourneyEvent({
    clientId,
    eventType: "document_all_deleted",
    actor: resolveActorSnapshot(auth),
    details: {}
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

  // Resolver precisa_confirmacao/ausente é o fluxo normal do corretor
  // terminando o próprio checklist. Mudar um status que a IA já deu como
  // conforme/pendência/ilegível/divergência é um override de julgamento da
  // IA — só gestor/admin (mesma regra do envio pra CCA), nunca o corretor.
  if (current.status !== "precisa_confirmacao" && current.status !== "ausente") {
    assertGeneralAdminOrManager(auth);
  }

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
//
// Itens 33-43 do 2º pedido: CPF/PIS NUNCA são campos do modal — o corretor
// não digita de novo. São sempre resolvidos automaticamente a partir do
// cadastro (que já pode ter sido preenchido sozinho por maybeAutoFillCpfPis
// durante a análise). Se ainda não existirem, o pacote vai sem eles e o
// "missing" só avisa — nunca bloqueia o envio.
export async function prepareCcaSubmission(clientId, batchId, payload, auth) {
  const registration = await requireClientAccess(clientId, auth);
  // O envio termina em "Aguardando aprovação": cliente de disparo sem
  // resposta real é barrado ANTES de enviar qualquer coisa à CCA.
  await assertProspectingStatusChangeAllowed({ clientId, currentStatus: registration.status, nextStatus: CLIENT_STATUS.APPROVAL_PENDING, auth });
  const cca = await getCca(payload.ccaId);
  if (!cca || !cca.active) throw new Error("Selecione uma CCA ativa.");

  const detail = await buildCcaPackageDetail(registration, payload);
  const missing = [];
  if (!detail.cpf) missing.push("CPF");
  if (!detail.pis) missing.push("PIS");
  if (!detail.email) missing.push("E-mail");
  if (!detail.phone) missing.push("Telefone");

  const documentCount = await countClientDocuments(clientId);
  const pendingCount = await countDocumentPending(clientId);
  const message = buildWhatsappMessage(detail);

  return { cca: { id: cca.id, name: cca.name, companyName: cca.companyName, whatsapp: cca.whatsapp }, detail, missing, documentCount, pendingCount, message };
}

async function countDocumentPending(clientId) {
  const { count, error } = await db().from("client_document_checklist_items").select("id", { count: "exact", head: true }).eq("client_id", clientId).in("status", ["ausente", "pendencia", "ilegivel", "divergencia", "precisa_confirmacao"]);
  if (error) throw error;
  return count || 0;
}

function assertClientReadyForPdf(registration) {
  const missingFields = [];
  if (!registration.fullName) missingFields.push("fullName");
  if (missingFields.length) {
    const err = new Error("Informe o nome do cliente antes de gerar o pacote.");
    err.code = "MISSING_CLIENT_FIELDS";
    err.missingFields = missingFields;
    throw err;
  }
}

// Gera e salva o PDF consolidado avulso (sem enviar pra CCA nem mudar
// status) — pro gestor/admin conferir ou baixar antes de decidir pra onde
// mandar. Mesma trava de nome/e-mail/PIS do envio pra CCA.
export async function generateClientDocumentPdf(clientId, auth) {
  assertGeneralAdminOrManager(auth);
  const registration = await requireClientAccess(clientId, auth);
  assertClientReadyForPdf(registration);
  return buildClientDocumentPdf(clientId, registration);
}

// Item 2/4 do 3º pedido: nome/e-mail/PIS são OBRIGATÓRIOS pra gerar o PDF
// consolidado (vão na capa, escritos, não tirados de OCR de documento) — sem
// eles, nem tenta montar o PDF, lança um erro com .code reconhecível pra
// tela pedir os campos que faltam em vez de travar sem explicação. Depois
// do envio, o status muda sozinho pra "Aguardando aprovação" (item 4).
export async function submitToCca(clientId, batchId, payload, auth) {
  const registration = await requireClientAccess(clientId, auth);
  const cca = await getCca(payload.ccaId);
  if (!cca || !cca.active) throw new Error("Selecione uma CCA ativa.");
  assertClientReadyForPdf(registration);
  const pendingCount = await countDocumentPending(clientId);
  if (pendingCount && payload.confirmPending !== true) {
    const error = new Error(`Existem ${pendingCount} pendências na documentação. Confirme antes de continuar.`);
    error.code = "PENDING_CONFIRMATION";
    error.pendingCount = pendingCount;
    throw error;
  }

  const detail = await buildCcaPackageDetail(registration, payload);
  const documentCount = await countClientDocuments(clientId);
  const format = payload.format === "folder" ? "folder" : "pdf";
  const packageResult = format === "folder" ? await buildClientDocumentFolder(clientId, registration) : await buildClientDocumentPdf(clientId, registration);
  const shareUrl = format === "folder" ? packageResult.url : await getClientDocumentSignedUrl(packageResult.path, 604800);
  const message = `${buildWhatsappMessage(detail)}\n\n${format === "folder" ? "Pasta de documentos" : "PDF consolidado"}: ${shareUrl}`;

  const { data: submission, error } = await db().from("client_document_submissions").insert({
    client_id: registration.id,
    batch_id: batchId || null,
    cca_id: cca.id,
    created_by: auth?.profile?.id || null,
    message,
    document_count: documentCount,
    details: { ...detail, format, packagePath: packageResult.path, pendingCount },
    merged_pdf_path: format === "pdf" ? packageResult.path : null
  }).select("*").single();
  if (error) throw error;

  // Item 4 do 3º pedido: muda o status sozinho, sem ação manual extra —
  // updateSimulationRegistration nunca transfere responsável nem mexe em
  // mais nada além do status pedido aqui.
  await updateSimulationRegistration(clientId, { status: CLIENT_STATUS.APPROVAL_PENDING }, auth);

  await logClientJourneyEvent({
    clientId: registration.id,
    eventType: "document_sent_to_cca",
    actor: resolveActorSnapshot(auth),
    details: { submissionId: submission.id, ccaId: cca.id, ccaName: cca.name, documentCount, batchId: batchId || null, format, pendingCount, pdfSkipped: packageResult.skipped }
  });

  // Acompanhamento de aprovação: abre a 1ª etapa ("Aguardando retorno da
  // CCA"). Fecha sozinho qualquer etapa aberta anterior (reenvio a outra CCA
  // é um caso real) — nunca mexe em simulation_registrations.status.
  await openInitialCcaStatusOnSend({ clientId: registration.id, ccaId: cca.id, auth });

  const whatsappUrl = `https://wa.me/${toWhatsAppDigits(cca.whatsapp)}?text=${encodeURIComponent(message)}`;
  return { submissionId: submission.id, whatsappUrl, message, documentCount, packageUrl: shareUrl, format, pdfSkipped: packageResult.skipped };
}

// Monta o "pacote do cliente" (itens 37-43): dados da operação (tipo de
// imóvel/empreendimento/valor, escolhidos no modal) + dados cadastrais que
// já existem no CRM (nome, telefone, CPF, PIS, estado civil) — nunca pedidos
// de novo ao corretor. Empreendimento vem do catálogo de imóveis existente
// quando informado por id (evita digitação duplicada); propertyName continua
// aceito como texto livre pra quando o empreendimento não está cadastrado.
async function buildCcaPackageDetail(registration, payload) {
  const propertyType = payload.propertyType === "novo" || payload.propertyType === "usado" ? payload.propertyType : "";
  const propertyValue = payload.propertyValue ? Number(payload.propertyValue) : null;
  let propertyName = cleanOptional(payload.propertyName);
  if (payload.propertyId) {
    const catalogName = await getPropertyName(payload.propertyId);
    if (catalogName) propertyName = catalogName;
  }

  return {
    clientName: registration.fullName,
    clientPhone: registration.phone || "",
    clientCode: registration.clientCode || "",
    cpf: registration.cpf || "",
    pis: registration.pis || "",
    email: registration.email || "",
    maritalStatus: MARITAL_LABELS[registration.primaryMaritalStatus] || "",
    propertyType,
    propertyValue,
    propertyName,
    brokerName: await getBrokerName(registration.responsibleUserId)
  };
}

function buildWhatsappMessage(detail) {
  const parts = [`Olá! Segue a documentação de ${detail.clientName} para análise.`];
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

async function getPropertyName(propertyId) {
  const { data } = await db().from("properties").select("name").eq("id", propertyId).maybeSingle();
  return data?.name || "";
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
    personRole: row.person_role || "",
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
