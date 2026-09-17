"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowDownAZ,
  ArrowRightLeft,
  ArrowUpAZ,
  Ban,
  Calendar as CalendarCheck,
  Check,
  ExternalLink,
  FileText,
  History,
  KeyRound,
  Link2,
  MessageCircle,
  Phone,
  RefreshCw,
  Tag as TagIcon,
  UserPlus,
  Users,
  X
} from "lucide-react";
import { journeyNoticeLabel } from "@/lib/journey-presentation";
import { CLIENT_STATUS_META, clientStatusLabel } from "@/lib/client-status";

const date = (value) => (value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");
const dateOnly = (value) => (value ? new Date(value).toLocaleDateString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");

const JOURNEY_MODALITY_LABEL = { simulation: "Simulação Completa", quick_service: "Atendimento Rápido" };
const FIELD_LABEL = {
  phone: "Telefone",
  primaryMonthlyIncome: "Renda",
  secondaryMonthlyIncome: "Renda (2ª pessoa)",
  primaryMaritalStatus: "Estado civil",
  hasOverThreeYearsRegisteredWork: "Regime de trabalho",
  contactPreference: "Preferência de contato"
};

// Categoria usada nos filtros do topo (item 22) — cada tipo de evento cai em
// uma categoria; tudo que não está mapeado explicitamente cai em "sistema"
// (nunca desaparece da timeline por ser um tipo novo/desconhecido).
const CATEGORY_BY_TYPE = {
  created: "sistema", legacy_status: "status", status: "status", notify: "jornada", regenerate: "jornada",
  responsible_transferred: "atribuicao", data_updated: "sistema", tag_added: "sistema", tag_removed: "sistema",
  activity_scheduled: "atividades", activity_completed: "atividades", activity_rescheduled: "atividades", activity_deleted: "atividades",
  sale_registered: "status",
  "distribution:assigned": "atribuicao", "distribution:auto_transferred": "atribuicao",
  "prospecting:claimed": "atividades", "prospecting:edited": "sistema", "prospecting:unblocked": "sistema",
  "prospecting:returned_to_queue": "atividades", "prospecting:prospecting_started": "atividades", "prospecting:in_service": "atividades",
  "prospecting:returned": "atividades", "prospecting:do_not_contact": "status", "prospecting:bulk_assigned": "atribuicao",
  "prospecting:daily_goal_attempt": "atividades", "prospecting:daily_goal_converted": "atividades", "prospecting:daily_goal_round_ended": "atividades"
};

const FILTERS = [
  { key: "all", label: "Todos" },
  { key: "status", label: "Status" },
  { key: "atividades", label: "Atividades" },
  { key: "atribuicao", label: "Atribuição" },
  { key: "jornada", label: "Jornada" },
  { key: "sistema", label: "Sistema" }
];

function EventIcon({ type }) {
  const props = { size: 16, "aria-hidden": true };
  if (type === "created") return <UserPlus {...props} />;
  if (type === "responsible_transferred" || type === "distribution:auto_transferred") return <ArrowRightLeft {...props} />;
  if (type === "distribution:assigned") return <Users {...props} />;
  if (type === "status" || type === "legacy_status") return <RefreshCw {...props} />;
  if (type === "notify") return <MessageCircle {...props} />;
  if (type === "regenerate") return <Link2 {...props} />;
  if (type === "tag_added" || type === "tag_removed") return <TagIcon {...props} />;
  if (type === "data_updated") return <FileText {...props} />;
  if (type.startsWith("activity_")) return <CalendarCheck {...props} />;
  if (type === "sale_registered") return <KeyRound {...props} />;
  if (type === "prospecting:do_not_contact") return <Ban {...props} />;
  if (type.startsWith("prospecting:")) return <Phone {...props} />;
  return <History {...props} />;
}

function eventTitleAndDescription(event, context = {}) {
  const d = event.details || {};
  switch (event.type) {
    case "created":
      // O trigger de banco que grava este evento não preenche `details` —
      // a origem/modalidade já foram carregadas à parte (origin/registration,
      // mesma fonte usada no cabeçalho do modal), reaproveitadas aqui.
      return { title: "CLIENTE CADASTRADO", description: [
        context.origin?.source_label ? `Origem: ${context.origin.source_label}` : "",
        JOURNEY_MODALITY_LABEL[context.registration?.journeyType] ? `Modalidade: ${JOURNEY_MODALITY_LABEL[context.registration.journeyType]}` : "",
        context.origin?.initial_destination ? `Destino: ${context.origin.initial_destination === "roulette" ? "Roleta" : "Corretor"}` : ""
      ].filter(Boolean) };
    case "status":
    case "legacy_status":
      return { title: "STATUS ALTERADO", description: [`${CLIENT_STATUS_META[event.previousStatus]?.label || event.previousStatus || "—"} → ${CLIENT_STATUS_META[event.newStatus]?.label || event.newStatus}`] };
    case "notify":
      return { title: "PROGRESSO AVISADO AO CLIENTE", description: ["Acionado via WhatsApp"] };
    case "regenerate":
      return { title: "LINK DA JORNADA REGENERADO", description: [] };
    case "responsible_transferred":
      return { title: "TRANSFERÊNCIA DE RESPONSÁVEL", description: [`${d.fromName || "—"} → ${d.toName || "—"}`, "Tipo: Transferência manual"] };
    case "distribution:assigned":
      return { title: "ATRIBUIÇÃO INICIAL", description: [`Distribuído para: ${d.toName || "—"}`, "Motivo: Distribuição automática"] };
    case "distribution:auto_transferred":
      return { title: "TRANSFERÊNCIA AUTOMÁTICA", description: [`${d.fromName || "—"} → ${d.toName || "—"}`, d.reason ? `Motivo: ${d.reason}` : "Motivo: Prazo de atendimento excedido"] };
    case "tag_added":
      return { title: "TAG ADICIONADA", description: [d.tagName ? `"${d.tagName}"` : ""] };
    case "tag_removed":
      return { title: "TAG REMOVIDA", description: [d.tagName ? `"${d.tagName}"` : ""] };
    case "data_updated":
      return { title: "DADOS ATUALIZADOS", description: (d.fields || []).map((f) => f.field === "phone" && f.fromLast4 ? `Telefone: final ${f.fromLast4} → final ${f.toLast4}` : `${FIELD_LABEL[f.field] || f.field} atualizado(a)`) };
    case "activity_scheduled":
      return { title: "ATIVIDADE AGENDADA", description: [d.title || "", d.scheduledAt ? `Data: ${date(d.scheduledAt)}` : ""].filter(Boolean) };
    case "activity_completed":
      return { title: "ATIVIDADE CONCLUÍDA", description: [d.title || ""] };
    case "activity_rescheduled":
      return { title: "ATIVIDADE REAGENDADA", description: [d.title || "", d.toAt ? `Nova data: ${date(d.toAt)}` : ""].filter(Boolean) };
    case "activity_deleted":
      return { title: "ATIVIDADE EXCLUÍDA", description: [d.title || ""] };
    case "sale_registered":
      return { title: "VENDA REALIZADA", description: [] };
    case "prospecting:claimed":
      return { title: "CONTATO DISPONIBILIZADO", description: ["Origem: Prospecção"] };
    case "prospecting:prospecting_started":
      return { title: "PROSPECÇÃO INICIADA", description: [] };
    case "prospecting:in_service":
      return { title: "CLIENTE EM ATENDIMENTO", description: [] };
    case "prospecting:returned":
    case "prospecting:returned_to_queue":
      return { title: "CONTATO DEVOLVIDO À FILA", description: [] };
    case "prospecting:do_not_contact":
      return { title: "CONTATO BLOQUEADO", description: ["Status: Não contactar novamente"] };
    case "prospecting:daily_goal_attempt":
      return { title: `${d.attempt ? `${d.attempt}ª TENTATIVA` : "TENTATIVA"} REALIZADA`, description: [d.channel === "whatsapp" ? "Canal: WhatsApp" : d.channel || "", "✓ Contabilizada na meta"].filter(Boolean) };
    case "prospecting:daily_goal_converted":
      return { title: "CONVERTIDO PELA META DIÁRIA", description: [] };
    case "prospecting:daily_goal_round_ended":
      return { title: "CICLO DE PROSPECÇÃO ENCERRADO", description: [] };
    case "prospecting:bulk_assigned":
      return { title: "ATRIBUÍDO EM LOTE", description: [] };
    case "prospecting:edited":
      return { title: "CONTATO EDITADO", description: [] };
    case "prospecting:unblocked":
      return { title: "CONTATO DESBLOQUEADO", description: [] };
    default:
      return { title: event.type.replace(/^prospecting:|^distribution:/, "").replace(/_/g, " ").toUpperCase(), description: [] };
  }
}

function EventRow({ event, context }) {
  const { title, description } = eventTitleAndDescription(event, context);
  return (
    <li className="flex gap-3 py-3.5">
      <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-blue-50 text-brand">
        <EventIcon type={event.type} />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
          <p className="text-[13px] font-black tracking-wide text-navy">{title}</p>
          <p className="text-[11px] font-bold text-muted">{date(event.occurredAt)}</p>
        </div>
        {description.filter(Boolean).map((line, index) => (
          <p key={index} className="mt-0.5 text-sm text-navy/80">{line}</p>
        ))}
        <p className="mt-1 text-[11px] font-bold text-muted">
          {event.actor?.name || "Sistema"}{event.actor?.role ? ` · ${event.actor.role}` : ""}
        </p>
      </div>
    </li>
  );
}

export default function ClientJourneyActions({ registration, canManage, responsibleName = "", tags = [] }) {
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const [filter, setFilter] = useState("all");
  const [sort, setSort] = useState("desc");
  const [visibleLimit, setVisibleLimit] = useState(20);
  const [loadingMore, setLoadingMore] = useState(false);
  const endpoint = `/api/client-journey/${registration.id}`;

  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error); setDetail(data); }).catch((e) => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [endpoint, registration.status]);

  useEffect(() => {
    if (!open) return;
    document.body.style.overflow = "hidden";
    function onKeyDown(event) { if (event.key === "Escape") setOpen(false); }
    window.addEventListener("keydown", onKeyDown);
    return () => { document.body.style.overflow = ""; window.removeEventListener("keydown", onKeyDown); };
  }, [open]);

  async function reload({ limit = visibleLimit, sortOverride = sort } = {}) {
    const params = new URLSearchParams({ limit: String(limit), sort: sortOverride });
    const response = await fetch(`${endpoint}?${params.toString()}`, { cache: "no-store" });
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    setDetail(data);
    return data;
  }

  async function act(action) {
    if (action === "regenerate" && !window.confirm("Invalidar o link atual e gerar um novo?")) return;
    const popup = action === "notify" ? window.open("about:blank", "_blank") : null;
    if (popup) popup.opener = null;
    setBusy(true); setError("");
    try {
      const response = await fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setDetail(result);
      if (result.whatsappUrl) { if (popup) popup.location.href = result.whatsappUrl; else window.location.assign(result.whatsappUrl); }
    } catch (e) { popup?.close(); setError(e.message); }
    finally { setBusy(false); }
  }

  async function toggleSort() {
    const next = sort === "desc" ? "asc" : "desc";
    setSort(next);
    try { await reload({ sortOverride: next }); } catch (e) { setError(e.message); }
  }

  async function loadMore() {
    setLoadingMore(true);
    try {
      const nextLimit = visibleLimit + 20;
      await reload({ limit: nextLimit });
      setVisibleLimit(nextLimit);
    } catch (e) { setError(e.message); }
    finally { setLoadingMore(false); }
  }

  const filteredEvents = useMemo(() => {
    const events = detail?.events || [];
    if (filter === "all") return events;
    return events.filter((event) => (CATEGORY_BY_TYPE[event.type] || "sistema") === filter);
  }, [detail, filter]);

  const modalidade = JOURNEY_MODALITY_LABEL[registration.journeyType] || "";
  const stageLabel = clientStatusLabel(registration.status);

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
      <button type="button" disabled={busy || !detail} onClick={() => act("notify")} className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 px-3 py-2 font-bold text-brand disabled:opacity-50">
        {detail?.state.notified_version === detail?.state.version && detail?.state.notified_at ? <Check size={14} /> : <MessageCircle size={14} />}{journeyNoticeLabel(detail?.state)}
      </button>
      <button type="button" title="Jornada e histórico do cliente" aria-label="Jornada e histórico do cliente" onClick={() => setOpen(true)} className="icon-button"><History size={16} /></button>
      {error ? <span role="alert" className="text-red-700">{error}</span> : null}

      {open ? createPortal(
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-navy/60 p-3 sm:p-4" role="dialog" aria-modal="true" aria-label="Jornada e histórico" onMouseDown={() => setOpen(false)}>
          <div className="flex max-h-[92svh] w-full max-w-3xl flex-col overflow-hidden rounded-[24px] bg-white shadow-2xl sm:max-h-[88svh] sm:rounded-[28px]" onMouseDown={(event) => event.stopPropagation()}>
            {/* Cabeçalho fixo: resumo do cliente */}
            <div className="shrink-0 border-b border-line bg-white p-5 sm:p-6">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Minha Jornada</p>
                  <h3 className="mt-1 truncate text-xl font-black text-navy sm:text-2xl">{registration.fullName} <span className="font-bold text-muted">{registration.clientCode}</span></h3>
                </div>
                <button type="button" className="icon-button shrink-0" aria-label="Fechar histórico" onClick={() => setOpen(false)}><X /></button>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-x-4 gap-y-2 text-[13px] sm:grid-cols-3">
                <Field label="Responsável atual" value={responsibleName || "—"} />
                <Field label="Origem" value={detail?.origin?.source_label || "Origem não identificada"} />
                <Field label="Modalidade" value={modalidade || "—"} />
                <Field label="Status atual" value={stageLabel} />
                <Field label="Entrada" value={dateOnly(registration.createdAt)} />
              </div>

              {tags.length ? (
                <div className="mt-3 flex flex-wrap gap-1.5">
                  {tags.map((tag) => (
                    <span key={tag.id} className="rounded-full px-2.5 py-1 text-[11px] font-black text-white" style={{ backgroundColor: tag.color }}>{tag.name}</span>
                  ))}
                </div>
              ) : null}

              <div className="mt-4 flex flex-wrap gap-3 border-t border-line pt-3">
                {detail?.url ? <a href={detail.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-[13px] font-bold text-brand"><ExternalLink size={15} />Pré-visualizar como cliente</a> : null}
                {canManage ? <button disabled={busy || !detail} type="button" className="inline-flex items-center gap-2 text-[13px] font-bold text-brand" onClick={() => act("regenerate")}><RefreshCw size={15} />Regenerar link</button> : null}
              </div>
            </div>

            {/* Filtros + ordenação */}
            <div className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-line bg-mist/60 px-5 py-2.5 sm:px-6">
              <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar histórico">
                {FILTERS.map((item) => (
                  <button
                    key={item.key}
                    type="button"
                    onClick={() => setFilter(item.key)}
                    className={`rounded-full px-2.5 py-1 text-[11px] font-black uppercase tracking-wide transition ${filter === item.key ? "bg-navy text-white" : "bg-white text-muted hover:text-navy"}`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
              <button type="button" onClick={toggleSort} className="inline-flex items-center gap-1.5 text-[11px] font-bold text-muted hover:text-navy">
                {sort === "desc" ? <ArrowDownAZ size={14} /> : <ArrowUpAZ size={14} />}
                {sort === "desc" ? "Mais recente" : "Mais antigo"}
              </button>
            </div>

            {/* Corpo: linha do tempo, rolável */}
            <div className="min-h-0 flex-1 overflow-y-auto px-5 sm:px-6">
              {filteredEvents.length ? (
                <ol className="divide-y divide-line">{filteredEvents.map((event) => <EventRow key={event.id} event={event} context={{ origin: detail?.origin, registration }} />)}</ol>
              ) : (
                <p className="py-8 text-center text-sm font-bold text-muted">Nenhum evento nesse filtro.</p>
              )}
              {detail?.hasMore ? (
                <div className="flex justify-center py-4">
                  <button type="button" disabled={loadingMore} onClick={loadMore} className="premium-button-secondary text-xs disabled:opacity-60">
                    {loadingMore ? "Carregando..." : "Carregar histórico anterior"}
                  </button>
                </div>
              ) : <div className="h-4" />}
            </div>
          </div>
        </div>,
        document.body
      ) : null}
    </div>
  );
}

function Field({ label, value }) {
  if (!value) return null;
  return (
    <div className="min-w-0">
      <p className="text-[10px] font-black uppercase tracking-wide text-muted">{label}</p>
      <p className="truncate font-bold text-navy">{value}</p>
    </div>
  );
}
