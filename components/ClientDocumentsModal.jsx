"use client";

import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  AlertTriangle,
  Bell,
  CheckCircle2,
  CircleHelp,
  Copy,
  Download,
  Eye,
  FileWarning,
  LoaderCircle,
  Send,
  Trash2,
  Upload,
  X
} from "lucide-react";
import { getSupabaseBrowserClient } from "@/lib/supabase-browser";
import { DOCUMENT_TYPE_OPTIONS, CHECKLIST_STATUS_OPTIONS } from "@/lib/document-type-options";
import { DOCUMENT_STATUS_LABELS, PERSON_ROLE_LABELS } from "@/lib/document-status-labels";

const CLIENT_DOCS_BUCKET = "client-documents";

const PROCESSING_LABELS = [
  "Enviando arquivos...",
  "Organizando documentos...",
  "Identificando documentos...",
  "Conferindo informações...",
  "Gerando checklist..."
];

const STATUS_STYLE = {
  conforme: { icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-50", label: DOCUMENT_STATUS_LABELS.conforme },
  pendencia: { icon: AlertTriangle, tone: "text-amber-700 bg-amber-50", label: DOCUMENT_STATUS_LABELS.pendencia },
  ilegivel: { icon: FileWarning, tone: "text-amber-700 bg-amber-50", label: DOCUMENT_STATUS_LABELS.ilegivel },
  ausente: { icon: X, tone: "text-red-700 bg-red-50", label: DOCUMENT_STATUS_LABELS.ausente },
  divergencia: { icon: AlertTriangle, tone: "text-amber-700 bg-amber-50", label: DOCUMENT_STATUS_LABELS.divergencia },
  precisa_confirmacao: { icon: CircleHelp, tone: "text-brand bg-blue-50", label: DOCUMENT_STATUS_LABELS.precisa_confirmacao },
  em_analise: { icon: LoaderCircle, tone: "text-muted bg-mist", label: DOCUMENT_STATUS_LABELS.em_analise }
};

export default function ClientDocumentsModal({ client, canSendToCca, canManage, onClose }) {
  const [batches, setBatches] = useState(null);
  const [activeBatch, setActiveBatch] = useState(null);
  const [error, setError] = useState("");
  const [uploadState, setUploadState] = useState(null); // { label } while a batch is being processed
  const [ccaFlow, setCcaFlow] = useState(null); // { batchId } opens the CCA submission drawer
  const [brokerAlertFlow, setBrokerAlertFlow] = useState(null); // null | "loading" | { message, whatsappUrl } | { empty: true }
  const [pdfFlow, setPdfFlow] = useState(null); // null | true (abre o PdfDownloadModal)
  const dropRef = useRef(null);
  const labelIndexRef = useRef(0);
  const labelTimerRef = useRef(null);

  useEffect(() => {
    document.body.style.overflow = "hidden";
    return () => { document.body.style.overflow = ""; };
  }, []);

  useEffect(() => {
    function handleKeyDown(event) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    loadBatches();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Ctrl+V / Cmd+V com arquivos/imagens da área de transferência (item 1 do
  // pedido de lote).
  useEffect(() => {
    function handlePaste(event) {
      const files = Array.from(event.clipboardData?.files || []);
      if (files.length) startUpload(files);
    }
    window.addEventListener("paste", handlePaste);
    return () => window.removeEventListener("paste", handlePaste);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [client.id]);

  async function loadBatches() {
    setError("");
    try {
      const response = await fetch(`/api/admin/client-documents/batches?clientId=${client.id}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      setBatches(data.batches || []);
      if (data.batches?.length) openBatch(data.batches[0].id);
    } catch (loadError) {
      setError(loadError.message || "Não foi possível carregar a documentação.");
      setBatches([]);
    }
  }

  async function openBatch(batchId) {
    try {
      const response = await fetch(`/api/admin/client-documents/batches/${batchId}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      setActiveBatch(data.batch);
    } catch (openError) {
      setError(openError.message || "Não foi possível abrir o lote.");
    }
  }

  function cycleLabels() {
    labelIndexRef.current = 1;
    setUploadState({ label: PROCESSING_LABELS[0] });
    labelTimerRef.current = setInterval(() => {
      if (labelIndexRef.current < PROCESSING_LABELS.length - 1) {
        setUploadState({ label: PROCESSING_LABELS[labelIndexRef.current] });
        labelIndexRef.current += 1;
      }
    }, 1800);
  }

  function stopCycle() {
    if (labelTimerRef.current) clearInterval(labelTimerRef.current);
    labelTimerRef.current = null;
    setUploadState(null);
  }

  // Fluxo completo do lote (item 1-2 do pedido): 1 requisição para criar o
  // lote + pegar as URLs assinadas, upload direto pro Storage (nunca passa
  // pela função serverless), e 1 requisição de confirmação que já dispara a
  // análise da IA — o corretor não clica em "analisar".
  async function startUpload(fileList) {
    const files = Array.from(fileList || []).filter(Boolean);
    if (!files.length) return;
    setError("");
    cycleLabels();
    try {
      const createResponse = await fetch("/api/admin/client-documents/batches", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id, files: files.map((file) => ({ name: file.name, size: file.size, type: file.type })) })
      });
      const createData = await createResponse.json().catch(() => ({}));
      if (!createResponse.ok) throw new Error(createData.error);

      const supabase = getSupabaseBrowserClient();
      if (!supabase) throw new Error("Supabase não configurado no navegador.");

      const uploaded = [];
      for (let index = 0; index < files.length; index += 1) {
        const file = files[index];
        const target = createData.uploads[index];
        const { error: uploadError } = await supabase.storage
          .from(CLIENT_DOCS_BUCKET)
          .uploadToSignedUrl(target.path, target.token, file, { contentType: file.type || "application/octet-stream" });
        if (uploadError) throw new Error(uploadError.message || `Não foi possível enviar ${file.name}.`);
        uploaded.push({ name: file.name, path: target.path, mimeType: file.type, size: file.size });
      }

      const confirmResponse = await fetch(`/api/admin/client-documents/batches/${createData.batchId}/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ files: uploaded })
      });
      const confirmData = await confirmResponse.json().catch(() => ({}));
      if (!confirmResponse.ok) throw new Error(confirmData.error);

      setActiveBatch(confirmData.batch);
      await loadBatches();
    } catch (uploadErr) {
      setError(uploadErr.message || "Não foi possível enviar os documentos.");
    } finally {
      stopCycle();
    }
  }

  async function reanalyze(batchId) {
    cycleLabels();
    try {
      const response = await fetch(`/api/admin/client-documents/batches/${batchId}/reanalyze`, { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      setActiveBatch(data.batch);
    } catch (reanalyzeError) {
      setError(reanalyzeError.message || "Não foi possível reanalisar.");
    } finally {
      stopCycle();
    }
  }

  async function handleResetAll() {
    if (!confirm(`Apagar TODA a documentação de ${client.fullName}? Isso remove todos os arquivos, o checklist e o histórico de envio pra CCA — não tem como desfazer.`)) return;
    if (!confirm("Tem certeza mesmo? Essa ação é definitiva.")) return;
    setUploadState({ label: "Apagando tudo..." });
    try {
      const response = await fetch("/api/admin/client-documents/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      setActiveBatch(null);
      await loadBatches();
    } catch (resetError) {
      setError(resetError.message || "Não foi possível apagar a documentação.");
    } finally {
      setUploadState(null);
    }
  }

  async function handleBrokerAlert() {
    setBrokerAlertFlow("loading");
    try {
      const response = await fetch("/api/admin/client-documents/broker-alert", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId: client.id })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      setBrokerAlertFlow(data.alert || { empty: true });
    } catch (alertError) {
      setBrokerAlertFlow(null);
      setError(alertError.message || "Não foi possível montar o aviso.");
    }
  }

  async function deleteDocument(documentId) {
    if (!confirm("Remover este documento do lote?")) return;
    try {
      const response = await fetch(`/api/admin/client-documents/documents/${documentId}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      await openBatch(activeBatch.id);
    } catch (deleteError) {
      setError(deleteError.message || "Não foi possível remover o documento.");
    }
  }

  async function viewDocument(documentId) {
    try {
      const response = await fetch(`/api/admin/client-documents/documents/${documentId}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      window.open(data.url, "_blank", "noopener,noreferrer");
    } catch (viewError) {
      setError(viewError.message || "Não foi possível abrir o documento.");
    }
  }

  async function correctItem(item, updates) {
    try {
      const response = await fetch(`/api/admin/client-documents/checklist-items/${item.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(updates)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      await openBatch(activeBatch.id);
    } catch (correctError) {
      setError(correctError.message || "Não foi possível corrigir o item.");
    }
  }

  return createPortal(
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-navy/60 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Documentação do cliente" onMouseDown={onClose}>
      <div
        ref={dropRef}
        className="flex max-h-[92svh] w-full max-w-4xl flex-col overflow-hidden rounded-[24px] bg-white shadow-2xl sm:max-h-[88svh] sm:rounded-[28px]"
        onMouseDown={(event) => event.stopPropagation()}
        onDragOver={(event) => event.preventDefault()}
        onDrop={(event) => { event.preventDefault(); startUpload(event.dataTransfer.files); }}
      >
        <div className="flex shrink-0 items-start justify-between gap-3 border-b border-line bg-white p-5 sm:p-6">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Documentação</p>
            <h2 className="mt-1 text-xl font-black text-navy sm:text-2xl">{client.fullName}</h2>
            {canManage ? (
              <button type="button" className="mt-1 text-xs font-bold text-muted hover:text-red-700" onClick={handleResetAll}>
                Excluir tudo e recomeçar
              </button>
            ) : null}
          </div>
          <button type="button" aria-label="Fechar documentação" className="icon-button shrink-0" onClick={onClose}>
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-5 sm:px-6">
          {error ? <p className="mb-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

          {uploadState ? (
            <div className="mb-4 flex items-center gap-3 rounded-2xl border border-brand/20 bg-blue-50 px-4 py-3">
              <LoaderCircle className="h-5 w-5 animate-spin text-brand" />
              <p className="text-sm font-black text-brand">{uploadState.label}</p>
            </div>
          ) : (
            <label className="mb-5 flex cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-brand/30 bg-mist/30 px-6 py-8 text-center transition hover:border-brand hover:bg-blue-50/50">
              <Upload className="h-8 w-8 text-brand" />
              <p className="font-black text-navy">Arraste, cole (Ctrl+V) ou selecione todos os documentos do cliente de uma vez.</p>
              <p className="text-xs font-bold text-muted">PDF, JPG, PNG, WEBP ou HEIC — a IA identifica e organiza automaticamente.</p>
              <input
                type="file"
                multiple
                accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif"
                className="hidden"
                onChange={(event) => startUpload(event.target.files)}
              />
            </label>
          )}

          {batches === null ? (
            <p className="text-center text-sm font-bold text-muted">Carregando…</p>
          ) : (
            <div className="space-y-3">
              {batches.map((batch) => (
                <BatchRow
                  key={batch.id}
                  batch={batch}
                  isActive={activeBatch?.id === batch.id}
                  onOpen={() => openBatch(batch.id)}
                />
              ))}
              {!batches.length ? <p className="rounded-2xl border border-line p-6 text-center text-sm font-bold text-muted">Nenhum documento enviado ainda.</p> : null}
            </div>
          )}

          {activeBatch ? (
            <BatchDetail
              batch={activeBatch}
              canSendToCca={canSendToCca}
              canManage={canManage}
              onReanalyze={() => reanalyze(activeBatch.id)}
              onDeleteDocument={deleteDocument}
              onViewDocument={viewDocument}
              onCorrectItem={correctItem}
              onSendToCca={() => setCcaFlow({ batchId: activeBatch.id })}
              onBrokerAlert={handleBrokerAlert}
              brokerAlertBusy={brokerAlertFlow === "loading"}
              onDownloadPdf={() => setPdfFlow(true)}
            />
          ) : null}
        </div>
      </div>

      {ccaFlow ? (
        <CcaSubmissionFlow
          clientId={client.id}
          batchId={ccaFlow.batchId}
          onClose={() => setCcaFlow(null)}
        />
      ) : null}

      {brokerAlertFlow && brokerAlertFlow !== "loading" ? (
        <BrokerAlertModal alert={brokerAlertFlow} onClose={() => setBrokerAlertFlow(null)} />
      ) : null}

      {pdfFlow ? (
        <PdfDownloadModal clientId={client.id} onClose={() => setPdfFlow(null)} />
      ) : null}
    </div>,
    document.body
  );
}

// Botão avulso "Baixar PDF" — gera o mesmo PDF consolidado do envio pra CCA
// (capa com dados do cadastro + tabela de conferência documental), sem
// precisar passar pelo fluxo de seleção de CCA. Mesma trava de nome/e-mail/
// PIS: se faltar, pede pra preencher antes de tentar gerar de novo.
function PdfDownloadModal({ clientId, onClose }) {
  const [state, setState] = useState("loading"); // "loading" | { url, skipped } | { missingFields }
  const [fieldValues, setFieldValues] = useState({ fullName: "", email: "", pis: "" });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    generate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function generate() {
    setState("loading");
    setError("");
    try {
      const response = await fetch("/api/admin/client-documents/pdf", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (data.missingFields?.length) {
          setFieldValues({ fullName: "", email: "", pis: "" });
          setState({ missingFields: data.missingFields });
          return;
        }
        throw new Error(data.error);
      }
      setState(data);
    } catch (generateError) {
      setError(generateError.message || "Não foi possível gerar o PDF.");
      setState(null);
    }
  }

  async function saveMissingFieldsAndRetry() {
    setBusy(true);
    setError("");
    try {
      const payload = {};
      for (const field of state.missingFields) payload[field] = fieldValues[field];
      const response = await fetch(`/api/simulation-registrations/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      await generate();
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar os dados do cliente.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-navy/70 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-[24px] bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        {state === "loading" ? (
          <div className="flex flex-col items-center gap-3 py-6 text-center">
            <LoaderCircle className="h-8 w-8 animate-spin text-brand" />
            <p className="font-black text-navy">Montando o PDF consolidado...</p>
          </div>
        ) : state?.missingFields ? (
          <div>
            <h3 className="text-lg font-black text-navy">Complete o cadastro antes de gerar o PDF</h3>
            <p className="mt-2 text-sm text-muted">Nome, e-mail e PIS vão escritos na capa do PDF.</p>
            {error ? <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p> : null}
            <div className="mt-3 space-y-2">
              {state.missingFields.includes("fullName") ? (
                <label className="block text-sm font-bold text-navy">Nome
                  <input className="mt-1 w-full rounded-lg border border-line p-2 text-sm font-normal" value={fieldValues.fullName} onChange={(event) => setFieldValues((value) => ({ ...value, fullName: event.target.value }))} />
                </label>
              ) : null}
              {state.missingFields.includes("email") ? (
                <label className="block text-sm font-bold text-navy">E-mail
                  <input type="email" className="mt-1 w-full rounded-lg border border-line p-2 text-sm font-normal" value={fieldValues.email} onChange={(event) => setFieldValues((value) => ({ ...value, email: event.target.value }))} />
                </label>
              ) : null}
              {state.missingFields.includes("pis") ? (
                <label className="block text-sm font-bold text-navy">PIS
                  <input className="mt-1 w-full rounded-lg border border-line p-2 text-sm font-normal" value={fieldValues.pis} onChange={(event) => setFieldValues((value) => ({ ...value, pis: event.target.value }))} />
                </label>
              ) : null}
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" className="premium-button-secondary" onClick={onClose}>Cancelar</button>
              <button
                type="button"
                disabled={busy || state.missingFields.some((field) => !String(fieldValues[field] || "").trim())}
                className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60"
                onClick={saveMissingFieldsAndRetry}
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} Salvar e gerar PDF
              </button>
            </div>
          </div>
        ) : state?.url ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <p className="mt-3 font-black text-navy">PDF consolidado pronto.</p>
            {state.skipped?.length ? (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-left text-xs font-bold text-amber-800">
                {state.skipped.length} arquivo(s) não entraram (formato não suportado): {state.skipped.join(", ")}.
              </p>
            ) : null}
            <div className="mt-4 flex justify-center gap-2">
              <button type="button" className="premium-button-secondary" onClick={onClose}>Fechar</button>
              <a className="premium-button-primary" href={state.url} target="_blank" rel="noreferrer">Baixar PDF</a>
            </div>
          </div>
        ) : (
          <div className="text-center">
            <p className="rounded-xl bg-red-50 px-3 py-2 text-sm font-bold text-red-700">{error || "Não foi possível gerar o PDF."}</p>
            <div className="mt-4 flex justify-center gap-2">
              <button type="button" className="premium-button-secondary" onClick={onClose}>Fechar</button>
              <button type="button" className="premium-button-primary" onClick={generate}>Tentar novamente</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BrokerAlertModal({ alert, onClose }) {
  const [copied, setCopied] = useState(false);

  async function copyMessage() {
    try {
      await navigator.clipboard.writeText(alert.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // clipboard indisponível (ex.: contexto não seguro) — corretor/gestor ainda pode selecionar o texto manualmente
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-navy/70 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-[24px] bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        {alert.empty ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <p className="mt-3 font-black text-navy">Nada pendente para avisar — checklist deste cliente está em dia.</p>
            <button type="button" className="premium-button-secondary mt-4" onClick={onClose}>Fechar</button>
          </div>
        ) : (
          <div>
            <h3 className="text-lg font-black text-navy">Avisar corretor{alert.brokerName ? ` — ${alert.brokerName}` : ""}</h3>
            <p className="mt-2 whitespace-pre-line rounded-xl bg-mist/60 p-3 text-sm text-navy">{alert.message}</p>
            <div className="mt-4 flex flex-wrap gap-2">
              <button type="button" className="premium-button-secondary" onClick={onClose}>Fechar</button>
              <button type="button" className="client-action-button" onClick={copyMessage}>
                <Copy className="h-4 w-4" /> {copied ? "Copiado!" : "Copiar mensagem"}
              </button>
              {alert.whatsappUrl ? (
                <a className="premium-button-primary" href={alert.whatsappUrl} target="_blank" rel="noreferrer">
                  <Send className="h-4 w-4" /> Abrir WhatsApp
                </a>
              ) : null}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function BatchRow({ batch, isActive, onOpen }) {
  const summary = batch.summary || {};
  const statusLabel = { uploading: "Enviando", processing: "Processando", analyzed: "Analisado", failed: "Falhou" }[batch.status] || batch.status;
  return (
    <button
      type="button"
      onClick={onOpen}
      className={`w-full rounded-2xl border p-4 text-left transition ${isActive ? "border-brand bg-blue-50/50" : "border-line hover:border-brand/40"}`}
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-black text-navy">Lote de {formatDate(batch.createdAt)} · {batch.totalFiles} arquivo(s)</p>
        <span className="rounded-full bg-mist px-3 py-1 text-xs font-black text-navy">{statusLabel}</span>
      </div>
      {batch.status === "analyzed" ? (
        <p className="mt-1 text-xs font-bold text-muted">
          {summary.conform || 0} arquivo(s) conforme · {summary.pending || 0} pendência(s) · {summary.needsConfirmation || 0} p/ confirmar neste envio
        </p>
      ) : null}
      {batch.status === "failed" ? <p className="mt-1 text-xs font-bold text-red-700">{batch.errorMessage}</p> : null}
    </button>
  );
}

function BatchDetail({ batch, canSendToCca, canManage, onReanalyze, onDeleteDocument, onViewDocument, onCorrectItem, onSendToCca, onBrokerAlert, brokerAlertBusy, onDownloadPdf }) {
  const [showDivergences, setShowDivergences] = useState(false);
  // Agrupa por person_role (identidade estável: titular/conjuge/dependente/
  // outro), nunca por person_label — é texto livre extraído pela IA a cada
  // lote e pode variar (acento, "João" vs "Joao"), o que já causou o mesmo
  // problema de duplicidade que o motor de requisitos corrigiu no banco.
  const byPerson = new Map();
  for (const item of batch.checklist || []) {
    const role = item.personRole || "outro";
    if (!byPerson.has(role)) byPerson.set(role, { label: PERSON_ROLE_LABELS[role] || role, items: [] });
    const group = byPerson.get(role);
    // Prefere um nome real extraído (personLabel) ao rótulo genérico do papel,
    // quando disponível — mantém a identificação amigável sem voltar a usar
    // o texto livre como chave de agrupamento.
    const genericLabel = PERSON_ROLE_LABELS[role] || role;
    if (item.personLabel && item.personLabel !== genericLabel && !group.namedLabel) group.namedLabel = item.personLabel;
    group.items.push(item);
  }

  return (
    <div className="mt-5 rounded-2xl border border-line p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-lg font-black text-navy">Checklist — lote de {formatDate(batch.createdAt)}</h3>
        <div className="flex flex-wrap gap-2">
          {batch.status === "analyzed" || batch.status === "failed" ? (
            <button type="button" className="premium-button-secondary px-4 py-2 text-sm" onClick={onReanalyze}>Reanalisar</button>
          ) : null}
          {canManage && batch.status === "analyzed" ? (
            <button type="button" disabled={brokerAlertBusy} className="premium-button-secondary px-4 py-2 text-sm disabled:cursor-not-allowed disabled:opacity-60" onClick={onBrokerAlert}>
              {brokerAlertBusy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Bell className="h-4 w-4" />} Avisar corretor
            </button>
          ) : null}
          {canManage && batch.status === "analyzed" ? (
            <button type="button" className="premium-button-secondary px-4 py-2 text-sm" onClick={onDownloadPdf}>
              <Download className="h-4 w-4" /> Baixar PDF
            </button>
          ) : null}
          {canSendToCca && batch.status === "analyzed" ? (
            <button type="button" className="premium-button-primary px-4 py-2 text-sm" onClick={onSendToCca}>
              <Send className="h-4 w-4" /> Enviar para análise
            </button>
          ) : null}
        </div>
      </div>

      {batch.divergences?.length ? (
        <div className="mt-3 rounded-lg border border-line">
          <button
            type="button"
            onClick={() => setShowDivergences((value) => !value)}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-xs font-black text-amber-800"
          >
            <span className="inline-flex items-center gap-1.5"><AlertTriangle className="h-3.5 w-3.5" /> {batch.divergences.length} divergência(s) para conferência</span>
            <span className="text-muted">{showDivergences ? "ocultar" : "ver"}</span>
          </button>
          {showDivergences ? (
            <ul className="space-y-1.5 border-t border-line px-3 py-2 text-xs font-bold text-muted">
              {batch.divergences.map((divergence, index) => <li key={index}>• {divergence.description}</li>)}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="mt-3 space-y-4">
        {Array.from(byPerson.entries()).map(([role, group]) => (
          <div key={role}>
            <p className="text-sm font-black uppercase tracking-wide text-muted">
              {group.namedLabel ? `${group.label} · ${group.namedLabel}` : group.label}
            </p>
            <div className="mt-2 grid gap-2 sm:grid-cols-2">
              {group.items.map((item) => (
                <ChecklistItemCard
                  key={item.id}
                  item={item}
                  documents={batch.documents}
                  canManage={canManage}
                  onView={onViewDocument}
                  onDelete={onDeleteDocument}
                  onCorrect={onCorrectItem}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function ChecklistItemCard({ item, documents, canManage, onView, onDelete, onCorrect }) {
  const [editing, setEditing] = useState(false);
  // precisa_confirmacao/ausente: qualquer um com acesso ao modal pode resolver
  // (é o fluxo normal do corretor terminando o próprio checklist). Corrigir um
  // status que a IA já deu como conforme/pendência/ilegível/divergência é uma
  // ação de override — só gestor/admin (canManage), nunca o corretor comum.
  const canCorrect = item.status === "precisa_confirmacao" || item.status === "ausente" || canManage;
  const style = STATUS_STYLE[item.status] || STATUS_STYLE.em_analise;
  const Icon = style.icon;
  const document = documents?.find((doc) => doc.id === item.documentId);

  return (
    <div className="rounded-xl border border-line p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <p className="font-black text-navy">{item.documentTypeLabel}</p>
          {item.pageRange ? <p className="text-[11px] font-bold text-muted">Páginas {item.pageRange}</p> : null}
        </div>
        <span className={`inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-[11px] font-black ${style.tone}`}>
          <Icon className="h-3.5 w-3.5" /> {style.label}
        </span>
      </div>
      {item.observations ? <p className="mt-1 text-xs text-muted">{item.observations}</p> : null}
      {document ? <p className="mt-1 truncate text-[11px] text-muted" title={document.filename}>{document.filename}</p> : null}
      <div className="mt-2 flex flex-wrap gap-2">
        {document ? (
          <>
            <button type="button" className="client-action-button" onClick={() => onView(document.id)}><Eye className="h-4 w-4" /> Ver</button>
            <button type="button" className="client-action-button text-red-700" onClick={() => onDelete(document.id)}><Trash2 className="h-4 w-4" /> Excluir</button>
          </>
        ) : null}
        {canCorrect ? (
          <button type="button" className="client-action-button" onClick={() => setEditing((value) => !value)}>Corrigir</button>
        ) : null}
      </div>
      {editing ? (
        <div className="mt-2 space-y-2 rounded-lg bg-mist/50 p-2">
          <select
            className="w-full rounded-lg border border-line p-2 text-sm"
            defaultValue={item.documentType}
            onChange={(event) => onCorrect(item, { documentType: event.target.value, status: "conforme" })}
          >
            {DOCUMENT_TYPE_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
          <select
            className="w-full rounded-lg border border-line p-2 text-sm"
            defaultValue={item.status}
            onChange={(event) => onCorrect(item, { status: event.target.value })}
          >
            {CHECKLIST_STATUS_OPTIONS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
          </select>
        </div>
      ) : null}
    </div>
  );
}

function CcaSubmissionFlow({ clientId, batchId, onClose }) {
  const [ccaOptions, setCcaOptions] = useState(null);
  const [propertyOptions, setPropertyOptions] = useState(null);
  const [ccaId, setCcaId] = useState("");
  const [propertyType, setPropertyType] = useState("");
  const [propertyValue, setPropertyValue] = useState("");
  const [propertyId, setPropertyId] = useState("");
  const [propertyName, setPropertyName] = useState("");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [done, setDone] = useState(null);
  const [missingFields, setMissingFields] = useState(null); // ["fullName","email","pis"] quando o envio exige preencher antes
  const [fieldValues, setFieldValues] = useState({ fullName: "", email: "", pis: "" });

  useEffect(() => {
    fetch("/api/admin/cca?onlyActive=1").then((response) => response.json()).then((data) => setCcaOptions(data.cca || []));
    fetch("/api/properties").then((response) => response.json()).then((data) => setPropertyOptions(Array.isArray(data) ? data : []));
  }, []);

  // CPF/PIS nunca são digitados aqui — são resolvidos automaticamente pelo
  // servidor a partir do cadastro do cliente (item 33/41 do pedido).
  function buildPayload(extra) {
    return { clientId, batchId, ccaId, propertyType, propertyValue, propertyId: propertyId || null, propertyName: propertyId ? "" : propertyName, ...extra };
  }

  async function handlePreview() {
    if (!ccaId) { setError("Selecione a CCA."); return; }
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/client-documents/cca-submission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload())
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      setPreview(data);
    } catch (previewError) {
      setError(previewError.message || "Não foi possível preparar o envio.");
    } finally {
      setBusy(false);
    }
  }

  async function handleConfirm() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/client-documents/cca-submission", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload({ action: "submit" }))
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Item 2/4 do 3º pedido: nome/e-mail/PIS são obrigatórios pra gerar
        // o PDF consolidado — pede só os que realmente faltam, pré-preenche
        // com o que já se sabe (da prévia), e nunca deixa prosseguir sem
        // eles.
        if (data.missingFields?.length) {
          setMissingFields(data.missingFields);
          setFieldValues({
            fullName: preview?.detail?.clientName || "",
            email: preview?.detail?.email || "",
            pis: preview?.detail?.pis || ""
          });
          return;
        }
        throw new Error(data.error);
      }
      setDone(data);
      window.open(data.whatsappUrl, "_blank", "noopener,noreferrer");
    } catch (submitError) {
      setError(submitError.message || "Não foi possível enviar.");
    } finally {
      setBusy(false);
    }
  }

  async function saveMissingFieldsAndRetry() {
    setBusy(true);
    setError("");
    try {
      const payload = {};
      for (const field of missingFields) payload[field] = fieldValues[field];
      const response = await fetch(`/api/simulation-registrations/${clientId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      setMissingFields(null);
      await handleConfirm();
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar os dados do cliente.");
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-[110] flex items-center justify-center bg-navy/70 p-4" onMouseDown={onClose}>
      <div className="w-full max-w-md rounded-[24px] bg-white p-6 shadow-2xl" onMouseDown={(event) => event.stopPropagation()}>
        {done ? (
          <div className="text-center">
            <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
            <p className="mt-3 font-black text-navy">Documentação preparada, PDF gerado e WhatsApp aberto.</p>
            <p className="mt-1 text-xs font-bold text-muted">Status do cliente atualizado para "Aguardando aprovação".</p>
            {done.pdfUrl ? (
              <a className="premium-button-secondary mt-4 inline-flex" href={done.pdfUrl} target="_blank" rel="noreferrer">Baixar PDF consolidado</a>
            ) : null}
            {done.pdfSkipped?.length ? (
              <p className="mt-2 rounded-xl bg-amber-50 px-3 py-2 text-left text-xs font-bold text-amber-800">
                {done.pdfSkipped.length} arquivo(s) não entraram no PDF (formato não suportado para mesclagem): {done.pdfSkipped.join(", ")}. Baixe-os manualmente pelo checklist se precisar anexar.
              </p>
            ) : null}
            <p className="mt-3 text-xs font-bold text-muted">O WhatsApp abriu só com a mensagem — anexe o PDF manualmente lá, o link não vai grudado automaticamente.</p>
            <button type="button" className="premium-button-secondary mt-4" onClick={onClose}>Fechar</button>
          </div>
        ) : missingFields ? (
          <div>
            <h3 className="text-lg font-black text-navy">Complete o cadastro antes de gerar o PDF</h3>
            <p className="mt-2 text-sm text-muted">Nome, e-mail e PIS vão escritos na capa do PDF consolidado — preencha o que estiver faltando.</p>
            {error ? <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p> : null}
            <div className="mt-3 space-y-2">
              {missingFields.includes("fullName") ? (
                <label className="block text-sm font-bold text-navy">Nome
                  <input className="mt-1 w-full rounded-lg border border-line p-2 text-sm font-normal" value={fieldValues.fullName} onChange={(event) => setFieldValues((value) => ({ ...value, fullName: event.target.value }))} />
                </label>
              ) : null}
              {missingFields.includes("email") ? (
                <label className="block text-sm font-bold text-navy">E-mail
                  <input type="email" className="mt-1 w-full rounded-lg border border-line p-2 text-sm font-normal" value={fieldValues.email} onChange={(event) => setFieldValues((value) => ({ ...value, email: event.target.value }))} />
                </label>
              ) : null}
              {missingFields.includes("pis") ? (
                <label className="block text-sm font-bold text-navy">PIS
                  <input className="mt-1 w-full rounded-lg border border-line p-2 text-sm font-normal" value={fieldValues.pis} onChange={(event) => setFieldValues((value) => ({ ...value, pis: event.target.value }))} />
                </label>
              ) : null}
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" className="premium-button-secondary" onClick={() => setMissingFields(null)}>Voltar</button>
              <button
                type="button"
                disabled={busy || missingFields.some((field) => !String(fieldValues[field] || "").trim())}
                className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60"
                onClick={saveMissingFieldsAndRetry}
              >
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} Salvar e continuar
              </button>
            </div>
          </div>
        ) : preview ? (
          <div>
            <h3 className="text-lg font-black text-navy">Documentação preparada para envio</h3>
            <dl className="mt-3 space-y-1 text-sm">
              <Row label="Cliente" value={preview.detail.clientName} />
              <Row label="CCA" value={`${preview.cca.name}${preview.cca.companyName ? ` — ${preview.cca.companyName}` : ""}`} />
              <Row label="Arquivos" value={preview.documentCount} />
            </dl>
            {preview.missing?.length ? (
              <p className="mt-3 rounded-xl bg-amber-50 px-3 py-2 text-xs font-bold text-amber-800">Faltando: {preview.missing.join(", ")} — preencha acima antes de continuar, se necessário.</p>
            ) : null}
            <p className="mt-3 whitespace-pre-line rounded-xl bg-mist/60 p-3 text-sm text-navy">{preview.message}</p>
            <div className="mt-4 flex gap-2">
              <button type="button" className="premium-button-secondary" onClick={() => setPreview(null)}>Voltar</button>
              <button type="button" disabled={busy} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60" onClick={handleConfirm}>
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Abrir WhatsApp
              </button>
            </div>
          </div>
        ) : (
          <div>
            <h3 className="text-lg font-black text-navy">Selecione a CCA</h3>
            {error ? <p className="mt-2 rounded-xl bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p> : null}
            <div className="mt-3 space-y-2">
              {(ccaOptions || []).map((cca) => (
                <label key={cca.id} className="flex items-center gap-2 rounded-xl border border-line p-3 text-sm font-bold text-navy">
                  <input type="radio" name="cca" checked={ccaId === cca.id} onChange={() => setCcaId(cca.id)} />
                  {cca.name}{cca.companyName ? ` — ${cca.companyName}` : ""}
                </label>
              ))}
              {ccaOptions && !ccaOptions.length ? <p className="text-sm font-bold text-muted">Nenhuma CCA ativa cadastrada.</p> : null}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-2">
              <select className="rounded-lg border border-line p-2 text-sm" value={propertyType} onChange={(event) => setPropertyType(event.target.value)}>
                <option value="">Imóvel (opcional)</option>
                <option value="novo">Novo</option>
                <option value="usado">Usado</option>
              </select>
              <input className="rounded-lg border border-line p-2 text-sm" placeholder="Valor (opcional)" value={propertyValue} onChange={(event) => setPropertyValue(event.target.value)} />
              {propertyType === "novo" ? (
                <div className="col-span-2 space-y-2">
                  <select className="w-full rounded-lg border border-line p-2 text-sm" value={propertyId} onChange={(event) => setPropertyId(event.target.value)}>
                    <option value="">Empreendimento (selecione ou digite abaixo)</option>
                    {(propertyOptions || []).map((property) => (
                      <option key={property.id} value={property.id}>{property.name}</option>
                    ))}
                  </select>
                  {!propertyId ? (
                    <input className="w-full rounded-lg border border-line p-2 text-sm" placeholder="Ou digite o nome do empreendimento" value={propertyName} onChange={(event) => setPropertyName(event.target.value)} />
                  ) : null}
                </div>
              ) : null}
            </div>
            <div className="mt-4 flex gap-2">
              <button type="button" className="premium-button-secondary" onClick={onClose}>Cancelar</button>
              <button type="button" disabled={busy || !ccaId} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60" onClick={handlePreview}>
                {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} Continuar
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="font-bold text-muted">{label}</dt>
      <dd className="font-black text-navy">{value}</dd>
    </div>
  );
}

function formatDate(value) {
  return value ? new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", dateStyle: "short", timeStyle: "short" }).format(new Date(value)) : "";
}
