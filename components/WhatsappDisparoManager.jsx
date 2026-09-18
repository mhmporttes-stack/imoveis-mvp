"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, CircleX, Clock, LoaderCircle, RefreshCw, Send, Upload } from "lucide-react";

const SECTIONS = [
  { key: "campaign", label: "Nova campanha" },
  { key: "templates", label: "Templates" },
  { key: "history", label: "Histórico" }
];

const TEMPLATE_STATUS_TONE = {
  APPROVED: { icon: CheckCircle2, tone: "text-emerald-700 bg-emerald-50" },
  PENDING: { icon: Clock, tone: "text-amber-700 bg-amber-50" },
  REJECTED: { icon: CircleX, tone: "text-red-700 bg-red-50" },
  PAUSED: { icon: Clock, tone: "text-amber-700 bg-amber-50" },
  DISABLED: { icon: CircleX, tone: "text-muted bg-mist" }
};

const DESTINATION_OPTIONS = [
  { value: "quick_service", label: "Atendimento rápido", description: "Abre direto o formulário de Atendimento rápido, sem tela intermediária." },
  { value: "simulation", label: "Simulação completa", description: "Abre direto o formulário de Simulação, sem tela intermediária." },
  { value: "choice", label: "Escolher ao acessar", description: "Abre a tela atual com as duas opções — o cliente decide." }
];

const BROADCAST_STATUS_LABEL = {
  draft: "Rascunho", queued: "Na fila", processing: "Processando", completed: "Concluída", failed: "Falhou", canceled: "Cancelada"
};

export default function WhatsappDisparoManager() {
  const [section, setSection] = useState("campaign");
  const [templates, setTemplates] = useState([]);
  const [templatesLoaded, setTemplatesLoaded] = useState(false);

  async function loadTemplates() {
    const response = await fetch("/api/admin/whatsapp-broadcasts/templates");
    const payload = await response.json().catch(() => ({}));
    if (response.ok) setTemplates(payload.templates || []);
    setTemplatesLoaded(true);
  }

  useEffect(() => {
    loadTemplates();
  }, []);

  return (
    <section className="container-page mt-6 space-y-6 rounded-[28px] border border-line bg-white p-6 shadow-soft">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.12em] text-navy">Disparo</p>
        <p className="mt-1 text-sm text-muted">Campanhas em massa por WhatsApp usando templates oficiais aprovados pela Meta.</p>
      </div>

      <div className="flex w-fit flex-wrap gap-1.5 rounded-xl border border-navy/[0.07] bg-mist/60 p-1">
        {SECTIONS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setSection(item.key)}
            className={`rounded-[10px] px-4 py-1.5 text-center text-[13px] font-black transition ${
              section === item.key ? "bg-navy text-white" : "text-navy hover:bg-white"
            }`}
          >
            {item.label}
          </button>
        ))}
      </div>

      {section === "campaign" ? (
        <NewCampaignSection templates={templates} templatesLoaded={templatesLoaded} approvedTemplates={templates.filter((t) => t.status === "APPROVED")} />
      ) : null}
      {section === "templates" ? <TemplatesSection templates={templates} onReload={loadTemplates} /> : null}
      {section === "history" ? <HistorySection templates={templates} /> : null}
    </section>
  );
}

/* ------------------------------- Templates -------------------------------- */

function TemplatesSection({ templates, onReload }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [showCreate, setShowCreate] = useState(false);

  async function syncFromMeta() {
    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-broadcasts/templates/sync", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error);
      setMessage(`${payload.templates?.length || 0} modelos sincronizados com a Meta.`);
      await onReload();
    } catch (syncError) {
      setError(syncError.message || "Falha ao sincronizar.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-bold text-muted">Modelos aprovados pela Meta podem ser usados em campanhas. Modelos criados fora daqui aparecem depois de sincronizar.</p>
        <div className="flex gap-2">
          <button type="button" onClick={syncFromMeta} disabled={busy} className="premium-button-secondary disabled:cursor-not-allowed disabled:opacity-60">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
            Sincronizar com a Meta
          </button>
          <button type="button" onClick={() => setShowCreate((value) => !value)} className="premium-button-primary">
            Novo template
          </button>
        </div>
      </div>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-800">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      {showCreate ? (
        <CreateTemplateForm
          onCreated={async () => {
            setShowCreate(false);
            setMessage("Template enviado para análise da Meta.");
            await onReload();
          }}
          onError={setError}
        />
      ) : null}

      <div className="grid gap-3 md:grid-cols-2">
        {templates.map((template) => {
          const tone = TEMPLATE_STATUS_TONE[template.status] || TEMPLATE_STATUS_TONE.PENDING;
          const Icon = tone.icon;
          const body = (template.components || []).find((c) => String(c.type).toUpperCase() === "BODY");
          return (
            <div key={template.id} className="rounded-2xl border border-line p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-black text-navy">{template.name}</p>
                <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black ${tone.tone}`}>
                  <Icon className="h-3.5 w-3.5" /> {template.statusLabel}
                </span>
              </div>
              <p className="mt-1 text-xs font-bold uppercase tracking-wide text-muted">{template.category} · {template.language}</p>
              {body ? <p className="mt-2 text-sm text-muted">&quot;{body.text}&quot;</p> : null}
              {template.buttonText ? <p className="mt-2 text-xs font-bold text-brand">Botão: {template.buttonText}</p> : null}
            </div>
          );
        })}
        {!templates.length ? (
          <p className="rounded-2xl border border-line p-6 text-center text-sm font-bold text-muted md:col-span-2">
            Nenhum template ainda. Crie um novo ou sincronize com a Meta.
          </p>
        ) : null}
      </div>
    </div>
  );
}

function CreateTemplateForm({ onCreated, onError }) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState("MARKETING");
  const [headerText, setHeaderText] = useState("");
  const [bodyText, setBodyText] = useState("");
  const [footerText, setFooterText] = useState("");
  const [buttonText, setButtonText] = useState("");
  const [busy, setBusy] = useState(false);

  const variableCount = (bodyText.match(/\{\{(\d+)\}\}/g) || []).length ? Math.max(...(bodyText.match(/\{\{(\d+)\}\}/g) || []).map((m) => Number(m.replace(/\D/g, "")))) : 0;
  const [mapping, setMapping] = useState({});

  async function handleSubmit(event) {
    event.preventDefault();
    setBusy(true);
    onError("");
    try {
      const variableMapping = {};
      for (let i = 1; i <= variableCount; i += 1) variableMapping[i] = mapping[i] || { source: "contact_name" };

      const response = await fetch("/api/admin/whatsapp-broadcasts/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, category, languageCode: "pt_BR", headerText, bodyText, footerText, buttonText, variableMapping })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error);
      setName(""); setHeaderText(""); setBodyText(""); setFooterText(""); setButtonText(""); setMapping({});
      await onCreated();
    } catch (createError) {
      onError(createError.message || "Falha ao criar o template.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 rounded-2xl border border-line bg-mist/30 p-4">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold text-navy">
          Nome do template
          <input className="mt-1 w-full rounded-lg border border-line p-3 font-normal" placeholder="poder_de_compra" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="text-sm font-bold text-navy">
          Categoria
          <select className="mt-1 w-full rounded-lg border border-line p-3 font-normal" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="MARKETING">Marketing</option>
            <option value="UTILITY">Utilidade</option>
            <option value="AUTHENTICATION">Autenticação</option>
          </select>
        </label>
      </div>
      <label className="block text-sm font-bold text-navy">
        Cabeçalho (opcional)
        <input className="mt-1 w-full rounded-lg border border-line p-3 font-normal" value={headerText} onChange={(e) => setHeaderText(e.target.value)} />
      </label>
      <label className="block text-sm font-bold text-navy">
        Corpo da mensagem — use {"{{1}}"}, {"{{2}}"}... para variáveis
        <textarea className="mt-1 w-full rounded-lg border border-line p-3 font-normal" rows={4} value={bodyText} onChange={(e) => setBodyText(e.target.value)} required />
      </label>
      {variableCount > 0 ? (
        <div className="rounded-xl border border-line bg-white p-3">
          <p className="text-xs font-black uppercase tracking-wide text-muted">Mapear variáveis</p>
          <div className="mt-2 grid gap-2">
            {Array.from({ length: variableCount }, (_, i) => i + 1).map((index) => (
              <div key={index} className="flex flex-wrap items-center gap-2 text-sm">
                <span className="font-bold text-navy">{"{{" + index + "}}"} →</span>
                <select
                  className="rounded-lg border border-line p-2"
                  value={mapping[index]?.source || "contact_name"}
                  onChange={(e) => setMapping((cur) => ({ ...cur, [index]: e.target.value === "fixed" ? { source: "fixed", value: cur[index]?.value || "" } : { source: "contact_name" } }))}
                >
                  <option value="contact_name">Nome do contato</option>
                  <option value="fixed">Valor fixo</option>
                </select>
                {mapping[index]?.source === "fixed" ? (
                  <input
                    className="rounded-lg border border-line p-2"
                    placeholder="valor fixo"
                    value={mapping[index]?.value || ""}
                    onChange={(e) => setMapping((cur) => ({ ...cur, [index]: { source: "fixed", value: e.target.value } }))}
                  />
                ) : null}
              </div>
            ))}
          </div>
        </div>
      ) : null}
      <label className="block text-sm font-bold text-navy">
        Rodapé (opcional)
        <input className="mt-1 w-full rounded-lg border border-line p-3 font-normal" value={footerText} onChange={(e) => setFooterText(e.target.value)} />
      </label>
      <label className="block text-sm font-bold text-navy">
        Texto do botão (opcional — leva para o link da campanha)
        <input className="mt-1 w-full rounded-lg border border-line p-3 font-normal" placeholder="Fazer simulação" value={buttonText} onChange={(e) => setButtonText(e.target.value)} />
      </label>

      <div className="rounded-xl border border-dashed border-line bg-white p-3 text-sm text-muted">
        <strong className="text-navy">Preview: </strong>
        {headerText ? <><br />{headerText}<br /></> : null}
        {bodyText.replace(/\{\{(\d+)\}\}/g, (_, i) => (mapping[i]?.source === "fixed" ? (mapping[i].value || `{{${i}}}`) : "João")) || "—"}
        {footerText ? <><br /><span className="text-xs">{footerText}</span></> : null}
        {buttonText ? <><br /><span className="mt-1 inline-block rounded-lg bg-blue-50 px-3 py-1 text-xs font-bold text-brand">{buttonText}</span></> : null}
      </div>

      <button type="submit" disabled={busy} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">
        {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
        Enviar para aprovação da Meta
      </button>
    </form>
  );
}

/* ----------------------------- Nova campanha ------------------------------ */

function NewCampaignSection({ approvedTemplates, templatesLoaded }) {
  const [step, setStep] = useState("template"); // template | contacts | destination | review | done
  const [campaignName, setCampaignName] = useState("");
  const [templateId, setTemplateId] = useState("");
  const [sourceType, setSourceType] = useState("base");
  const [selectedContacts, setSelectedContacts] = useState(new Map()); // id -> {id, name, phone}
  const [csvRows, setCsvRows] = useState([]);
  const [destinationJourney, setDestinationJourney] = useState("choice");
  const [preview, setPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [dispatched, setDispatched] = useState(null);

  const selectedTemplate = approvedTemplates.find((t) => t.id === templateId) || null;

  async function goToReview() {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-broadcasts/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload())
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error);
      setPreview(payload.preview);
      setStep("review");
    } catch (previewError) {
      setError(previewError.message || "Não foi possível revisar a campanha.");
    } finally {
      setBusy(false);
    }
  }

  function buildPayload() {
    return {
      campaignName,
      templateId,
      destinationJourney,
      sourceType,
      contactIds: sourceType === "base" ? Array.from(selectedContacts.keys()) : [],
      csvRows: sourceType === "csv" ? csvRows : []
    };
  }

  async function confirmDispatch() {
    if (busy || dispatched) return; // proteção contra clique duplo (item 25)
    setBusy(true);
    setError("");
    try {
      const createResponse = await fetch("/api/admin/whatsapp-broadcasts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(buildPayload())
      });
      const createPayload = await createResponse.json().catch(() => ({}));
      if (!createResponse.ok) throw new Error(createPayload.error);

      const dispatchResponse = await fetch(`/api/admin/whatsapp-broadcasts/${createPayload.broadcast.id}/dispatch`, { method: "POST" });
      const dispatchPayload = await dispatchResponse.json().catch(() => ({}));
      if (!dispatchResponse.ok) throw new Error(dispatchPayload.error);

      setDispatched(dispatchPayload.broadcast);
      setStep("done");
    } catch (dispatchError) {
      setError(dispatchError.message || "Não foi possível disparar a campanha.");
    } finally {
      setBusy(false);
    }
  }

  function resetWizard() {
    setStep("template"); setCampaignName(""); setTemplateId(""); setSourceType("base");
    setSelectedContacts(new Map()); setCsvRows([]); setDestinationJourney("choice");
    setPreview(null); setDispatched(null); setError("");
  }

  if (!templatesLoaded) return <p className="text-sm font-bold text-muted">Carregando templates…</p>;

  if (step === "done" && dispatched) {
    return (
      <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-6 text-center">
        <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-600" />
        <p className="mt-3 text-lg font-black text-navy">Campanha &quot;{campaignName}&quot; disparada!</p>
        <p className="mt-1 text-sm text-emerald-800">
          {dispatched.totals.sent} enviadas de {dispatched.totals.selected} · status: {BROADCAST_STATUS_LABEL[dispatched.status] || dispatched.status}
        </p>
        <p className="mt-2 text-xs text-muted">O restante continua sendo processado no servidor — acompanhe em Histórico.</p>
        <button type="button" onClick={resetWizard} className="premium-button-secondary mt-4">Nova campanha</button>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      <label className="block text-sm font-bold text-navy">
        Nome interno da campanha
        <input className="mt-1 w-full max-w-md rounded-lg border border-line p-3 font-normal" placeholder="Poder de Compra - Setembro" value={campaignName} onChange={(e) => setCampaignName(e.target.value)} />
      </label>

      {step === "template" ? (
        <div className="space-y-3">
          <p className="text-sm font-black text-navy">1. Escolha o template</p>
          {!approvedTemplates.length ? (
            <p className="rounded-2xl border border-line p-4 text-sm text-muted">Nenhum template aprovado ainda. Crie um na aba Templates e aguarde a aprovação da Meta.</p>
          ) : (
            <div className="grid gap-2 sm:grid-cols-2">
              {approvedTemplates.map((template) => (
                <button
                  key={template.id}
                  type="button"
                  onClick={() => setTemplateId(template.id)}
                  className={`rounded-2xl border p-4 text-left ${templateId === template.id ? "border-brand bg-blue-50" : "border-line"}`}
                >
                  <p className="font-black text-navy">{template.name}</p>
                  <p className="mt-1 text-xs text-muted">{template.category}</p>
                </button>
              ))}
            </div>
          )}
          <button
            type="button"
            disabled={!campaignName.trim() || !templateId}
            onClick={() => setStep("contacts")}
            className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60"
          >
            Continuar
          </button>
          {!campaignName.trim() ? <p className="text-xs font-bold text-red-600">Preencha o nome interno da campanha acima para continuar.</p> : !templateId ? <p className="text-xs font-bold text-red-600">Selecione um template para continuar.</p> : null}
        </div>
      ) : null}

      {step === "contacts" ? (
        <ContactsStep
          sourceType={sourceType}
          setSourceType={setSourceType}
          selectedContacts={selectedContacts}
          setSelectedContacts={setSelectedContacts}
          csvRows={csvRows}
          setCsvRows={setCsvRows}
          onBack={() => setStep("template")}
          onContinue={() => setStep("destination")}
        />
      ) : null}

      {step === "destination" ? (
        <div className="space-y-3">
          <p className="text-sm font-black text-navy">3. Destino do link</p>
          <div className="grid gap-2 sm:grid-cols-3">
            {DESTINATION_OPTIONS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setDestinationJourney(option.value)}
                className={`rounded-2xl border p-4 text-left ${destinationJourney === option.value ? "border-brand bg-blue-50" : "border-line"}`}
              >
                <p className="font-black text-navy">{option.label}</p>
                <p className="mt-1 text-xs text-muted">{option.description}</p>
              </button>
            ))}
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("contacts")} className="premium-button-secondary">Voltar</button>
            <button type="button" disabled={busy} onClick={goToReview} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} Revisar campanha
            </button>
          </div>
        </div>
      ) : null}

      {step === "review" && preview ? (
        <div className="space-y-3">
          <p className="text-sm font-black text-navy">4. Revisão</p>
          <div className="rounded-2xl border border-line p-4">
            <dl className="grid gap-2 text-sm sm:grid-cols-2">
              <Row label="Campanha" value={campaignName} />
              <Row label="Template" value={`${preview.templateName} (${preview.templateCategory})`} />
              <Row label="Destino" value={DESTINATION_OPTIONS.find((o) => o.value === preview.destinationJourney)?.label} />
              <Row label="Botão" value={preview.buttonText || "—"} />
              <Row label="Selecionados" value={preview.totalCandidates} />
              <Row label="Inválidos removidos" value={preview.totalInvalid} />
              <Row label="Duplicados removidos" value={preview.totalDuplicate} />
              <Row label="Bloqueados (não contactar)" value={preview.totalBlocked} />
            </dl>
            <p className="mt-3 rounded-xl bg-mist/60 p-3 text-sm text-muted"><strong className="text-navy">Preview da mensagem: </strong>&quot;{preview.bodyPreview}&quot;</p>
            <p className="mt-3 text-lg font-black text-navy">Total real a enviar: {preview.totalToSend}</p>
          </div>
          <div className="flex gap-2">
            <button type="button" onClick={() => setStep("destination")} className="premium-button-secondary">Voltar</button>
            <button type="button" disabled={busy || !preview.totalToSend} onClick={confirmDispatch} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">
              {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Disparar agora
            </button>
            {!busy && !preview.totalToSend ? <p className="self-center text-xs font-bold text-red-600">Nenhum contato válido para disparo.</p> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div>
      <dt className="text-xs font-black uppercase tracking-wide text-muted">{label}</dt>
      <dd className="font-bold text-navy">{value ?? "—"}</dd>
    </div>
  );
}

function ContactsStep({ sourceType, setSourceType, selectedContacts, setSelectedContacts, csvRows, setCsvRows, onBack, onContinue }) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const pageSize = 30;

  async function search(nextOffset = 0) {
    setLoading(true);
    try {
      const url = `/api/admin/whatsapp-broadcasts/contacts?query=${encodeURIComponent(query)}&limit=${pageSize}&offset=${nextOffset}`;
      const response = await fetch(url);
      const payload = await response.json().catch(() => ({}));
      if (response.ok) { setResults(payload.contacts || []); setTotal(payload.total || 0); setOffset(nextOffset); }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (sourceType === "base") search(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sourceType]);

  function toggle(contact) {
    setSelectedContacts((current) => {
      const next = new Map(current);
      if (next.has(contact.id)) next.delete(contact.id); else next.set(contact.id, contact);
      return next;
    });
  }

  function selectAllOnPage() {
    setSelectedContacts((current) => {
      const next = new Map(current);
      for (const contact of results) next.set(contact.id, contact);
      return next;
    });
  }

  async function handleCsvUpload(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    const XLSX = await import("xlsx");
    const workbook = XLSX.read(await file.arrayBuffer(), { type: "array" });
    const raw = XLSX.utils.sheet_to_json(workbook.Sheets[workbook.SheetNames[0]], { defval: "" });
    const headers = Array.from(new Set(raw.flatMap((row) => Object.keys(row))));
    const nameColumn = headers.find((h) => /nome|name/i.test(h)) || headers[0];
    const phoneColumn = headers.find((h) => /telefone|phone|whatsapp|celular/i.test(h)) || headers[1];
    setCsvRows(raw.map((row) => ({ name: row[nameColumn], phone: row[phoneColumn] })));
  }

  const totalSelected = sourceType === "base" ? selectedContacts.size : csvRows.length;

  return (
    <div className="space-y-3">
      <p className="text-sm font-black text-navy">2. Contatos</p>
      <div className="flex gap-2">
        <button type="button" onClick={() => setSourceType("base")} className={`premium-button-${sourceType === "base" ? "primary" : "secondary"}`}>Base da Imobiliária</button>
        <button type="button" onClick={() => setSourceType("csv")} className={`premium-button-${sourceType === "csv" ? "primary" : "secondary"}`}>Importar CSV</button>
      </div>

      {sourceType === "base" ? (
        <div className="space-y-2">
          <div className="flex flex-wrap gap-2">
            <input className="min-w-[220px] flex-1 rounded-lg border border-line p-2 font-normal" placeholder="Buscar por nome ou telefone" value={query} onChange={(e) => setQuery(e.target.value)} />
            <button type="button" onClick={() => search(0)} className="premium-button-secondary">Buscar</button>
            <button type="button" onClick={selectAllOnPage} className="premium-button-secondary">Selecionar todos desta página</button>
            <button type="button" onClick={() => setSelectedContacts(new Map())} className="premium-button-secondary">Desmarcar todos</button>
          </div>
          <p className="text-xs font-bold text-muted">{total} contatos elegíveis na base (excluindo &quot;não contactar novamente&quot;) · {totalSelected} selecionados</p>
          <div className="max-h-72 overflow-y-auto rounded-2xl border border-line">
            {loading ? <p className="p-4 text-center text-sm text-muted">Carregando…</p> : results.map((contact) => (
              <label key={contact.id} className="flex items-center gap-3 border-b border-line px-4 py-2 last:border-0">
                <input type="checkbox" checked={selectedContacts.has(contact.id)} onChange={() => toggle(contact)} />
                <span className="font-bold text-navy">{contact.name}</span>
                <span className="text-xs text-muted">{contact.phone}</span>
              </label>
            ))}
            {!loading && !results.length ? <p className="p-4 text-center text-sm text-muted">Nenhum contato encontrado.</p> : null}
          </div>
          <div className="flex gap-2">
            <button type="button" disabled={offset === 0} onClick={() => search(Math.max(offset - pageSize, 0))} className="premium-button-secondary disabled:cursor-not-allowed disabled:opacity-60">Anterior</button>
            <button type="button" disabled={offset + pageSize >= total} onClick={() => search(offset + pageSize)} className="premium-button-secondary disabled:cursor-not-allowed disabled:opacity-60">Próxima</button>
          </div>
        </div>
      ) : (
        <div className="space-y-2">
          <label className="flex w-fit cursor-pointer items-center gap-2 rounded-2xl border border-dashed border-line px-4 py-3 text-sm font-bold text-navy">
            <Upload className="h-4 w-4" /> Selecionar planilha (.csv/.xlsx) com colunas nome/telefone
            <input type="file" accept=".csv,.xlsx,.xls" className="hidden" onChange={handleCsvUpload} />
          </label>
          <p className="text-xs font-bold text-muted">{csvRows.length} linhas carregadas — telefones inválidos/duplicados/bloqueados são filtrados na revisão.</p>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={onBack} className="premium-button-secondary">Voltar</button>
        <button type="button" disabled={!totalSelected} onClick={onContinue} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">Continuar</button>
        {!totalSelected ? <p className="text-xs font-bold text-red-600">Selecione ao menos um contato para continuar.</p> : null}
      </div>
    </div>
  );
}

/* -------------------------------- Histórico -------------------------------- */

function HistorySection({ templates }) {
  const [broadcasts, setBroadcasts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState("");
  const [templateFilter, setTemplateFilter] = useState("");
  const [detail, setDetail] = useState(null);

  async function load() {
    setLoading(true);
    const params = new URLSearchParams();
    if (statusFilter) params.set("status", statusFilter);
    if (templateFilter) params.set("templateId", templateFilter);
    const response = await fetch(`/api/admin/whatsapp-broadcasts?${params.toString()}`);
    const payload = await response.json().catch(() => ({}));
    if (response.ok) setBroadcasts(payload.broadcasts || []);
    setLoading(false);
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [statusFilter, templateFilter]);

  async function openDetail(id) {
    const response = await fetch(`/api/admin/whatsapp-broadcasts/${id}`);
    const payload = await response.json().catch(() => ({}));
    if (response.ok) setDetail(payload.broadcast);
  }

  if (detail) {
    return (
      <div className="space-y-4">
        <button type="button" onClick={() => setDetail(null)} className="premium-button-secondary">← Voltar ao histórico</button>
        <div className="rounded-2xl border border-line p-4">
          <p className="text-lg font-black text-navy">{detail.campaignName}</p>
          <p className="text-sm text-muted">{detail.templateName} · {BROADCAST_STATUS_LABEL[detail.status] || detail.status}</p>
          {detail.campaignLink ? <p className="mt-1 break-all text-xs text-brand">{detail.campaignLink}</p> : null}
          <div className="mt-3 grid grid-cols-3 gap-2 text-center sm:grid-cols-6">
            <Metric label="Selecionados" value={detail.totals.selected} />
            <Metric label="Fila" value={detail.totals.queued} />
            <Metric label="Enviados" value={detail.totals.sent} />
            <Metric label="Entregues" value={detail.totals.delivered} />
            <Metric label="Lidos" value={detail.totals.read} />
            <Metric label="Falhas" value={detail.totals.failed} />
          </div>
        </div>
        <div className="max-h-96 overflow-y-auto rounded-2xl border border-line">
          <table className="w-full text-left text-sm">
            <thead className="sticky top-0 bg-mist text-xs font-black uppercase text-muted">
              <tr><th className="px-4 py-2">Nome</th><th className="px-4 py-2">Telefone</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Erro</th></tr>
            </thead>
            <tbody>
              {detail.messages.map((message) => (
                <tr key={message.id} className="border-t border-line">
                  <td className="px-4 py-2 font-bold text-navy">{message.name}</td>
                  <td className="px-4 py-2 text-muted">{message.phone}</td>
                  <td className="px-4 py-2">{message.status}</td>
                  <td className="px-4 py-2 text-xs text-red-700">{message.errorMessage}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <select className="rounded-lg border border-line p-2 text-sm" value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
          <option value="">Todos os status</option>
          {Object.entries(BROADCAST_STATUS_LABEL).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
        <select className="rounded-lg border border-line p-2 text-sm" value={templateFilter} onChange={(e) => setTemplateFilter(e.target.value)}>
          <option value="">Todos os templates</option>
          {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </div>

      {loading ? <p className="text-sm text-muted">Carregando…</p> : (
        <div className="overflow-x-auto rounded-2xl border border-line">
          <table className="w-full min-w-[640px] text-left text-sm">
            <thead className="bg-mist text-xs font-black uppercase text-muted">
              <tr><th className="px-4 py-2">Campanha</th><th className="px-4 py-2">Template</th><th className="px-4 py-2">Status</th><th className="px-4 py-2">Enviados</th><th className="px-4 py-2">Lidos</th><th className="px-4 py-2">Falhas</th></tr>
            </thead>
            <tbody>
              {broadcasts.map((row) => (
                <tr key={row.id} className="cursor-pointer border-t border-line hover:bg-mist/40" onClick={() => openDetail(row.id)}>
                  <td className="px-4 py-2 font-bold text-navy">{row.campaignName}</td>
                  <td className="px-4 py-2 text-muted">{row.templateName}</td>
                  <td className="px-4 py-2">{BROADCAST_STATUS_LABEL[row.status] || row.status}</td>
                  <td className="px-4 py-2">{row.totals.sent}</td>
                  <td className="px-4 py-2">{row.totals.read}</td>
                  <td className="px-4 py-2">{row.totals.failed}</td>
                </tr>
              ))}
              {!broadcasts.length ? <tr><td className="px-4 py-6 text-center text-muted" colSpan={6}>Nenhuma campanha ainda.</td></tr> : null}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value }) {
  return (
    <div>
      <p className="text-lg font-black text-navy">{value}</p>
      <p className="text-[10px] font-bold uppercase text-muted">{label}</p>
    </div>
  );
}
