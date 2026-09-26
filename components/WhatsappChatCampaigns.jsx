"use client";

import { useEffect, useState } from "react";
import { ChevronDown, LoaderCircle, MessageCircle } from "lucide-react";

const STATUS_LABEL = { draft: "Rascunho", queued: "Na fila", processing: "Processando", completed: "Concluída", failed: "Falhou", canceled: "Cancelada" };
const MESSAGE_STATUS_LABEL = { queued: "Na fila", processing: "Enviando", sent: "Enviada", delivered: "Entregue", read: "Lida", failed: "Falhou" };
const CATEGORY_TONE = { marketing: "bg-blue-50 text-brand", utility: "bg-emerald-50 text-emerald-700", authentication: "bg-amber-50 text-amber-800", service: "bg-slate-100 text-slate-600" };

function formatDateTime(value) {
  if (!value) return "—";
  return new Date(value).toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit", timeZone: "America/Sao_Paulo" });
}

function formatPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const national = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return phone || "";
}

// Chat > Campanhas: todos os disparos realizados. Quem recebe um disparo NÃO vira conversa: só aparece
// em Conversas e na Visão geral quando responde (aqui dá para abrir a conversa de quem respondeu).
export default function WhatsappChatCampaigns({ onOpenConversation }) {
  const [items, setItems] = useState(null);
  const [error, setError] = useState("");
  const [openId, setOpenId] = useState("");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/admin/whatsapp-broadcasts/finance?days=0", { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar as campanhas.");
        if (!cancelled) setItems(data.items || []);
      })
      .catch((loadError) => { if (!cancelled) setError(loadError.message); });
    return () => { cancelled = true; };
  }, []);

  return (
    <div className="space-y-3 p-4 sm:p-5">
      <div>
        <p className="text-lg font-black text-navy">Campanhas de disparo</p>
        <p className="text-xs font-bold leading-5 text-muted">Todos os disparos realizados. Quem recebe a mensagem só aparece em <b>Conversas</b> e na <b>Visão geral</b> quando responde.</p>
      </div>

      {error ? <p className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p> : null}
      {items === null && !error ? <p className="flex items-center gap-2 text-sm font-bold text-muted"><LoaderCircle className="h-4 w-4 animate-spin" /> Carregando…</p> : null}
      {items && !items.length ? <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm font-bold text-muted">Nenhum disparo realizado ainda.</p> : null}

      {(items || []).map((item) => (
        <CampaignCard key={item.id} item={item} open={openId === item.id} onToggle={() => setOpenId(openId === item.id ? "" : item.id)} onOpenConversation={onOpenConversation} />
      ))}
    </div>
  );
}

function CampaignCard({ item, open, onToggle, onOpenConversation }) {
  return (
    <div className="rounded-2xl border border-line bg-white">
      <button type="button" onClick={onToggle} className="flex w-full items-start gap-3 p-4 text-left" aria-expanded={open}>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="truncate font-black text-navy">{item.campaignName}</p>
            <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${CATEGORY_TONE[item.category] || CATEGORY_TONE.service}`}>{item.categoryLabel}</span>
            <span className="rounded-full bg-slate-100 px-2.5 py-0.5 text-[11px] font-extrabold text-slate-600">{STATUS_LABEL[item.status] || item.status}</span>
          </div>
          <p className="mt-0.5 text-xs font-bold text-muted">Modelo {item.templateName} · {formatDateTime(item.startedAt || item.createdAt)}</p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs font-extrabold text-navy">
            <span>{item.sent} enviadas</span>
            <span>{item.delivered} entregues</span>
            <span>{item.read} lidas</span>
            {item.failed ? <span className="text-red-600">{item.failed} falhas</span> : null}
            <span className="text-emerald-700">{item.replied} responderam</span>
          </div>
        </div>
        <ChevronDown className={`mt-1 h-5 w-5 shrink-0 text-muted transition ${open ? "rotate-180" : ""}`} />
      </button>
      {open ? <Recipients id={item.id} onOpenConversation={onOpenConversation} /> : null}
    </div>
  );
}

function Recipients({ id, onOpenConversation }) {
  const [detail, setDetail] = useState(null);
  const [error, setError] = useState("");
  const [onlyReplied, setOnlyReplied] = useState(false);

  useEffect(() => {
    let cancelled = false;
    fetch(`/api/admin/whatsapp-broadcasts/${id}`, { cache: "no-store" })
      .then(async (response) => {
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || "Não foi possível carregar os destinatários.");
        if (!cancelled) setDetail(data.broadcast);
      })
      .catch((loadError) => { if (!cancelled) setError(loadError.message); });
    return () => { cancelled = true; };
  }, [id]);

  if (error) return <p className="border-t border-line p-4 text-sm font-bold text-red-700">{error}</p>;
  if (!detail) return <p className="flex items-center gap-2 border-t border-line p-4 text-sm font-bold text-muted"><LoaderCircle className="h-4 w-4 animate-spin" /> Carregando destinatários…</p>;

  const messages = onlyReplied ? detail.messages.filter((message) => message.replied) : detail.messages;
  const repliedCount = detail.messages.filter((message) => message.replied).length;

  return (
    <div className="border-t border-line">
      <div className="flex flex-wrap items-center gap-2 px-4 py-3">
        <button type="button" onClick={() => setOnlyReplied(false)} className={`rounded-full border px-3 py-1 text-xs font-extrabold ${!onlyReplied ? "border-navy bg-navy text-white" : "border-line text-navy"}`}>Todos ({detail.messages.length})</button>
        <button type="button" onClick={() => setOnlyReplied(true)} className={`rounded-full border px-3 py-1 text-xs font-extrabold ${onlyReplied ? "border-emerald-600 bg-emerald-600 text-white" : "border-line text-navy"}`}>Responderam ({repliedCount})</button>
      </div>
      <ul className="max-h-80 divide-y divide-line overflow-y-auto">
        {messages.map((message) => (
          <li key={message.id} className="flex items-center gap-3 px-4 py-2.5">
            <div className="min-w-0 flex-1">
              <p className="truncate text-sm font-extrabold text-navy">{message.name || "Sem nome"}</p>
              <p className="text-[11px] font-bold text-muted">{formatPhone(message.phone)} · {MESSAGE_STATUS_LABEL[message.status] || message.status}{message.errorMessage ? ` — ${message.errorMessage}` : ""}</p>
            </div>
            {message.replied ? (
              <button type="button" onClick={() => message.conversationId && onOpenConversation(message.conversationId)} className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-emerald-50 px-3 py-1.5 text-xs font-extrabold text-emerald-700 hover:bg-emerald-100">
                <MessageCircle className="h-3.5 w-3.5" /> Respondeu · abrir
              </button>
            ) : null}
          </li>
        ))}
        {!messages.length ? <li className="px-4 py-5 text-center text-sm font-bold text-muted">Ninguém respondeu ainda.</li> : null}
      </ul>
    </div>
  );
}
