"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Check, History, MessageCircle, RefreshCw, ExternalLink, X } from "lucide-react";
import { journeyNoticeLabel } from "@/lib/journey-presentation";
import { CLIENT_STATUS_META } from "@/lib/client-status";

const date = value => value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "";
export default function ClientJourneyActions({ registration, canManage }) {
  const [detail, setDetail] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [open, setOpen] = useState(false);
  const endpoint = `/api/client-journey/${registration.id}`;
  useEffect(() => {
    const controller = new AbortController();
    fetch(endpoint, { signal: controller.signal, cache: "no-store" }).then(async r => { const data = await r.json(); if (!r.ok) throw new Error(data.error); setDetail(data); }).catch(e => { if (e.name !== "AbortError") setError(e.message); });
    return () => controller.abort();
  }, [endpoint, registration.status]);
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
  return <div className="mt-3 flex flex-wrap items-center gap-2 text-xs">
    <button type="button" disabled={busy || !detail} onClick={() => act("notify")} className="inline-flex items-center gap-1.5 rounded-full border border-brand/20 px-3 py-2 font-bold text-brand disabled:opacity-50">
      {detail?.state.notified_version === detail?.state.version && detail?.state.notified_at ? <Check size={14} /> : <MessageCircle size={14} />}{journeyNoticeLabel(detail?.state)}
    </button>
    <button type="button" title="Jornada e histórico do cliente" aria-label="Jornada e histórico do cliente" onClick={() => setOpen(true)} className="icon-button"><History size={16} /></button>
    {error ? <span role="alert" className="text-red-700">{error}</span> : null}
    {open ? createPortal(<div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/30 p-4" role="dialog" aria-modal="true" aria-label="Jornada e histórico" onKeyDown={event => { if (event.key === "Escape") setOpen(false); }}>
      <div className="max-h-[85svh] w-full max-w-xl overflow-auto rounded-lg bg-white p-5 shadow-xl">
        <div className="flex items-center justify-between gap-3"><h3 className="text-lg font-black">Minha Jornada · {registration.clientCode}</h3><button type="button" className="icon-button" aria-label="Fechar histórico" onClick={() => setOpen(false)}><X /></button></div>
        <div className="my-4 flex flex-wrap gap-3">
          {detail?.url ? <a href={detail.url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 font-bold text-brand"><ExternalLink size={16} />Pré-visualizar como cliente</a> : null}
          {canManage ? <button disabled={busy || !detail} type="button" className="inline-flex items-center gap-2 font-bold text-brand" onClick={() => act("regenerate")}><RefreshCw size={16} />Regenerar link</button> : null}
        </div>
        <div className="border-y border-line py-3 leading-6">
          <p>Cliente cadastrado: {date(registration.createdAt)}</p>
          <p>Origem: {detail?.origin?.source_label || "Origem não identificada"}</p>
          {detail?.origin?.created_by ? <p>Cadastrado por: {detail.origin.created_by}</p> : null}
          {detail?.origin?.initial_destination ? <p>Destino inicial: {detail.origin.initial_destination === "roulette" ? "Roleta" : "Corretor"}</p> : null}
          {detail?.origin?.initial_responsible_name ? <p>Distribuído para: {detail.origin.initial_responsible_name}</p> : null}
        </div>
        <ol className="divide-y divide-line">{detail?.events.map(event => <li key={event.id} className="py-3 leading-5">
          <p className="font-bold">{event.event_type === "notify" ? "Acionou Avisar progresso via WhatsApp" : event.event_type === "regenerate" ? "Link da jornada regenerado" : event.event_type === "created" ? "Jornada criada" : `${CLIENT_STATUS_META[event.previous_status]?.label || event.previous_status} → ${CLIENT_STATUS_META[event.new_status]?.label || event.new_status}`}</p>
          {event.event_type === "status" ? <p>{event.previous_progress}% → {event.progress}%</p> : null}
          <p className="text-muted">{date(event.occurred_at)} · {event.actor || "Sistema"}</p>
        </li>)}</ol>
      </div>
    </div>, document.body) : null}
  </div>;
}
