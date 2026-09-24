"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import {
  AlertCircle,
  ArrowLeft,
  Check,
  CheckCheck,
  ExternalLink,
  Info,
  Loader2,
  MessageCircle,
  Search,
  Send,
  UserPlus,
  X
} from "lucide-react";
import Avatar from "@/components/Avatar";
import { useWhatsappChatSummary } from "@/components/useWhatsappChatSummary";

// Filtros da lista — para acrescentar outro no futuro basta uma linha aqui
// (e o filtro correspondente em lib/whatsapp-chat.js).
const FILTERS = [
  { key: "all", label: "Todas" },
  { key: "unread", label: "Não lidas" },
  { key: "in_service", label: "Em atendimento" },
  { key: "finished", label: "Finalizadas" }
];

const STATUS_LABELS = { open: "Nova", in_service: "Em atendimento", finished: "Finalizada" };

const TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const DAY_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });
const SHORT_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit" });

const MEDIA_LABELS = {
  image: "Imagem",
  audio: "Áudio",
  video: "Vídeo",
  document: "Documento",
  sticker: "Figurinha",
  location: "Localização",
  contacts: "Contato",
  reaction: "Reação",
  order: "Pedido",
  unsupported: "Mensagem não suportada"
};

function dayKey(value) {
  return DAY_FORMATTER.format(new Date(value));
}

function formatListTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return dayKey(date) === dayKey(new Date()) ? TIME_FORMATTER.format(date) : SHORT_DATE_FORMATTER.format(date);
}

function formatDayLabel(value) {
  const key = dayKey(value);
  if (key === dayKey(new Date())) return "Hoje";
  if (key === dayKey(new Date(Date.now() - 24 * 60 * 60 * 1000))) return "Ontem";
  return DATE_FORMATTER.format(new Date(value));
}

function displayName(conversation) {
  return conversation.client?.name || conversation.name || conversation.phone;
}

function formatPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const national = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (national.length === 11) return `(${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  if (national.length === 10) return `(${national.slice(0, 2)}) ${national.slice(2, 6)}-${national.slice(6)}`;
  return phone || "";
}

export default function WhatsappChat() {
  const [filter, setFilter] = useState("all");
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [conversations, setConversations] = useState([]);
  const [listLoading, setListLoading] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [detail, setDetail] = useState(null);
  const [detailError, setDetailError] = useState("");
  const [infoOpen, setInfoOpen] = useState(false);

  const sectionRef = useRef(null);
  const filterRef = useRef(filter);
  const searchRef = useRef(search);
  const selectedRef = useRef(selectedId);
  filterRef.current = filter;
  searchRef.current = search;
  selectedRef.current = selectedId;

  useEffect(() => {
    const handle = setTimeout(() => setSearch(searchInput.trim()), 300);
    return () => clearTimeout(handle);
  }, [searchInput]);

  const loadList = useCallback(async ({ silent = false } = {}) => {
    if (!silent) setListLoading(true);
    try {
      const params = new URLSearchParams({ filter: filterRef.current });
      if (searchRef.current) params.set("q", searchRef.current);
      const response = await fetch(`/api/admin/whatsapp-chat/conversations?${params.toString()}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar as conversas.");
      setConversations(data.conversations || []);
      setListError("");
    } catch (error) {
      setListError(error.message);
    } finally {
      setListLoading(false);
    }
  }, []);

  const loadDetail = useCallback(async (id, { silent = false } = {}) => {
    if (!id) return;
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${id}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível abrir a conversa.");
      if (selectedRef.current !== id) return;
      setDetail(data);
      setDetailError("");
      if (data.conversation.unreadCount > 0 && document.visibilityState === "visible") {
        fetch(`/api/admin/whatsapp-chat/conversations/${id}/read`, { method: "POST" }).catch(() => {});
        setConversations((current) => current.map((item) => (item.id === id ? { ...item, unreadCount: 0 } : item)));
      }
    } catch (error) {
      if (!silent) setDetailError(error.message);
    }
  }, []);

  // Tempo real: um ping do servidor (ou o polling de segurança) refaz a lista
  // e a conversa aberta.
  const { summary, refresh: refreshSummary } = useWhatsappChatSummary(
    useCallback(() => {
      loadList({ silent: true });
      if (selectedRef.current) loadDetail(selectedRef.current, { silent: true });
    }, [loadList, loadDetail])
  );

  useEffect(() => {
    loadList();
  }, [filter, search, loadList]);

  function openConversation(id) {
    // Leva o painel para o topo da tela: a conversa e o campo de mensagem
    // ocupam a altura inteira da janela, sem precisar rolar a página.
    sectionRef.current?.scrollIntoView({ block: "start" });
    setSelectedId(id);
    selectedRef.current = id;
    setDetail(null);
    setDetailError("");
    setInfoOpen(false);
    loadDetail(id).then(() => refreshSummary());
  }

  function closeConversation() {
    setSelectedId("");
    selectedRef.current = "";
    setDetail(null);
  }

  const totalUnread = summary.unreadMessages || 0;

  return (
    <section className="container-page scroll-mt-[72px]" ref={sectionRef}>
      <div className="overflow-hidden rounded-[28px] border border-line bg-white shadow-soft">
        <div className="grid h-[calc(100dvh-100px)] min-h-[520px] grid-cols-1 lg:grid-cols-[340px_minmax(0,1fr)] xl:grid-cols-[340px_minmax(0,1fr)_300px]">
          <ConversationList
            className={selectedId ? "hidden lg:flex" : "flex"}
            conversations={conversations}
            error={listError}
            filter={filter}
            loading={listLoading}
            onFilter={setFilter}
            onSearch={setSearchInput}
            onSelect={openConversation}
            search={searchInput}
            selectedId={selectedId}
            totalUnread={totalUnread}
          />

          <div className={`${selectedId ? "flex" : "hidden lg:flex"} min-h-0 min-w-0 flex-col border-line lg:border-l`}>
            {selectedId ? (
              <Thread
                detail={detail}
                error={detailError}
                infoOpen={infoOpen}
                onBack={closeConversation}
                onChanged={() => {
                  loadList({ silent: true });
                  loadDetail(selectedId, { silent: true });
                  refreshSummary();
                }}
                onToggleInfo={() => setInfoOpen((open) => !open)}
              />
            ) : (
              <div className="grid flex-1 place-items-center p-8 text-center">
                <div>
                  <span className="mx-auto grid h-14 w-14 place-items-center rounded-2xl bg-blue-50 text-brand">
                    <MessageCircle className="h-7 w-7" />
                  </span>
                  <p className="mt-4 text-lg font-black text-navy">Selecione uma conversa</p>
                  <p className="mt-1 text-sm font-bold text-muted">Tudo que os clientes mandam para o número oficial aparece aqui.</p>
                </div>
              </div>
            )}
          </div>

          {selectedId && detail ? (
            <aside className="hidden min-h-0 overflow-y-auto border-l border-line xl:block">
              <ContactPanel detail={detail} onChanged={() => { loadList({ silent: true }); loadDetail(selectedId, { silent: true }); }} />
            </aside>
          ) : null}
        </div>
      </div>

      {infoOpen && detail ? (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-navy/40 p-0 xl:hidden" onClick={() => setInfoOpen(false)}>
          <div className="max-h-[80dvh] w-full overflow-y-auto rounded-t-[24px] bg-white shadow-soft" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between border-b border-line px-5 py-3">
              <p className="font-black text-navy">Informações do contato</p>
              <button type="button" onClick={() => setInfoOpen(false)} className="grid h-9 w-9 place-items-center rounded-full hover:bg-mist" aria-label="Fechar">
                <X className="h-5 w-5" />
              </button>
            </div>
            <ContactPanel detail={detail} onChanged={() => { loadList({ silent: true }); loadDetail(selectedId, { silent: true }); }} />
          </div>
        </div>
      ) : null}
    </section>
  );
}

function ConversationList({ className, conversations, error, filter, loading, onFilter, onSearch, onSelect, search, selectedId, totalUnread }) {
  return (
    <div className={`${className} min-h-0 min-w-0 flex-col`}>
      <div className="space-y-3 border-b border-line p-4">
        <div className="flex items-center justify-between">
          <h2 className="text-lg font-black text-navy">Conversas</h2>
          {totalUnread > 0 ? (
            <span className="rounded-full bg-emerald-500 px-2.5 py-0.5 text-xs font-black text-white">{totalUnread} não lidas</span>
          ) : null}
        </div>
        <label className="relative block">
          <span className="sr-only">Buscar conversa</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-brand" aria-hidden="true" />
          <input
            className="h-11 w-full rounded-2xl border border-line bg-white pl-10 pr-3 text-sm font-bold text-navy outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
            onChange={(event) => onSearch(event.target.value)}
            placeholder="Buscar por nome ou telefone"
            type="search"
            value={search}
          />
        </label>
        <div className="flex gap-1.5 overflow-x-auto pb-0.5">
          {FILTERS.map((item) => (
            <button
              key={item.key}
              type="button"
              onClick={() => onFilter(item.key)}
              className={`shrink-0 rounded-full border px-3 py-1.5 text-xs font-extrabold transition ${
                filter === item.key ? "border-brand bg-blue-50 text-brand" : "border-line bg-white text-navy hover:border-brand/40"
              }`}
            >
              {item.label}
            </button>
          ))}
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? <p className="m-4 rounded-2xl border border-red-100 bg-red-50 p-3 text-sm font-bold text-red-700">{error}</p> : null}
        {loading && !conversations.length ? (
          <p className="flex items-center justify-center gap-2 p-8 text-sm font-bold text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Carregando...</p>
        ) : null}
        {!loading && !error && !conversations.length ? (
          <p className="p-8 text-center text-sm font-bold text-muted">
            {search || filter !== "all" ? "Nenhuma conversa neste filtro." : "Nenhuma conversa ainda. Quando alguém escrever para o número oficial, aparece aqui."}
          </p>
        ) : null}
        {conversations.map((conversation) => (
          <ConversationRow key={conversation.id} conversation={conversation} selected={conversation.id === selectedId} onSelect={() => onSelect(conversation.id)} />
        ))}
      </div>
    </div>
  );
}

function ConversationRow({ conversation, selected, onSelect }) {
  const unread = conversation.unreadCount > 0;
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-start gap-3 border-b border-line/70 px-4 py-3 text-left transition hover:bg-mist/60 ${selected ? "bg-blue-50/70" : ""}`}
    >
      <Avatar name={displayName(conversation)} photoUrl={conversation.photoUrl} size={44} />
      <span className="min-w-0 flex-1">
        <span className="flex items-baseline justify-between gap-2">
          <span className={`truncate text-sm text-navy ${unread ? "font-black" : "font-extrabold"}`}>{displayName(conversation)}</span>
          <span className={`shrink-0 text-[11px] font-bold ${unread ? "text-emerald-600" : "text-muted"}`}>{formatListTime(conversation.lastMessageAt)}</span>
        </span>
        <span className="block truncate text-[11px] font-bold text-muted">{formatPhone(conversation.phone)}</span>
        <span className="mt-0.5 flex items-center justify-between gap-2">
          <span className={`flex min-w-0 items-center gap-1 text-xs ${unread ? "font-extrabold text-navy" : "font-semibold text-slate-500"}`}>
            {conversation.lastMessageDirection === "outbound" ? <Check className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="Enviada" /> : null}
            <span className="truncate">{conversation.lastMessagePreview || "—"}</span>
          </span>
          {unread ? (
            <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-emerald-500 px-1.5 text-[11px] font-black text-white">{conversation.unreadCount}</span>
          ) : null}
        </span>
        <span className="mt-1 flex flex-wrap gap-1">
          <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-600">{STATUS_LABELS[conversation.status] || conversation.status}</span>
          {!conversation.client ? <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700">Não cadastrado</span> : null}
        </span>
      </span>
    </button>
  );
}

function Thread({ detail, error, infoOpen, onBack, onChanged, onToggleInfo }) {
  const scrollRef = useRef(null);
  const lastCountRef = useRef(0);
  const conversation = detail?.conversation;
  const messages = detail?.messages || [];

  useEffect(() => {
    const element = scrollRef.current;
    if (!element) return;
    // Desce ao abrir e a cada mensagem nova.
    if (messages.length !== lastCountRef.current) {
      element.scrollTop = element.scrollHeight;
      lastCountRef.current = messages.length;
    }
  }, [messages.length, conversation?.id]);

  useEffect(() => {
    lastCountRef.current = 0;
  }, [conversation?.id]);

  async function changeStatus(status) {
    await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ status })
    }).catch(() => {});
    onChanged();
  }

  if (error) return <p className="m-6 rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>;
  if (!conversation) {
    return <p className="flex flex-1 items-center justify-center gap-2 text-sm font-bold text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Abrindo conversa...</p>;
  }

  const rows = [];
  let previousDay = "";
  for (const message of messages) {
    const key = dayKey(message.at);
    if (key !== previousDay) {
      rows.push({ kind: "day", key: `day-${key}`, label: formatDayLabel(message.at) });
      previousDay = key;
    }
    rows.push({ kind: "message", key: message.id, message });
  }

  return (
    <>
      <header className="flex items-center gap-3 border-b border-line px-4 py-3">
        <button type="button" onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-mist lg:hidden" aria-label="Voltar para as conversas">
          <ArrowLeft className="h-5 w-5 text-navy" />
        </button>
        <Avatar name={displayName(conversation)} photoUrl={conversation.photoUrl} size={40} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-black text-navy">{displayName(conversation)}</p>
          <p className="truncate text-xs font-bold text-muted">{formatPhone(conversation.phone)} · {STATUS_LABELS[conversation.status]}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          {conversation.status !== "in_service" ? (
            <button type="button" onClick={() => changeStatus("in_service")} className="hidden rounded-full border border-line px-3 py-1.5 text-xs font-extrabold text-navy hover:border-brand sm:inline-block">Em atendimento</button>
          ) : null}
          {conversation.status !== "finished" ? (
            <button type="button" onClick={() => changeStatus("finished")} className="rounded-full border border-line px-3 py-1.5 text-xs font-extrabold text-navy hover:border-brand">Finalizar</button>
          ) : (
            <button type="button" onClick={() => changeStatus("open")} className="rounded-full border border-line px-3 py-1.5 text-xs font-extrabold text-navy hover:border-brand">Reabrir</button>
          )}
          <button
            type="button"
            onClick={onToggleInfo}
            className={`grid h-9 w-9 place-items-center rounded-full hover:bg-mist xl:hidden ${infoOpen ? "bg-blue-50 text-brand" : "text-navy"}`}
            aria-label="Informações do contato"
          >
            <Info className="h-5 w-5" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="min-h-0 flex-1 space-y-1.5 overflow-y-auto bg-[#F1F5FA] px-3 py-4 sm:px-5">
        {detail.hasMore ? <p className="pb-2 text-center text-xs font-bold text-muted">Mostrando as últimas mensagens da conversa.</p> : null}
        {rows.map((row) => (row.kind === "day" ? (
          <div key={row.key} className="flex justify-center py-2">
            <span className="rounded-full bg-white px-3 py-1 text-[11px] font-extrabold text-slate-500 shadow-sm">{row.label}</span>
          </div>
        ) : (
          <MessageBubble key={row.key} message={row.message} />
        )))}
        {!rows.length ? <p className="py-8 text-center text-sm font-bold text-muted">Nenhuma mensagem nesta conversa.</p> : null}
      </div>

      <Composer conversation={conversation} onSent={onChanged} />
    </>
  );
}

function MessageBubble({ message }) {
  const outbound = message.direction === "outbound";
  const failed = message.status === "failed";
  const isMedia = message.type !== "text" && message.type !== "button" && message.type !== "interactive";
  const label = MEDIA_LABELS[message.type] || "Mensagem";

  return (
    <div className={`flex ${outbound ? "justify-end" : "justify-start"}`}>
      <div className={`max-w-[85%] rounded-2xl px-3.5 py-2 shadow-sm sm:max-w-[70%] ${
        outbound ? "rounded-br-md bg-[#DCEBFF] text-navy" : "rounded-bl-md bg-white text-navy"
      } ${failed ? "ring-1 ring-red-300" : ""}`}>
        {outbound && message.senderType === "automation" ? (
          <p className="mb-0.5 text-[10px] font-extrabold uppercase tracking-wide text-brand">{message.automationKind === "flow" ? "Automação · Fluxo" : "Automação"}</p>
        ) : null}
        {isMedia ? (
          <p className="text-sm font-bold italic text-slate-500">[{label}] — abra no WhatsApp para visualizar</p>
        ) : null}
        {message.body ? <p className="whitespace-pre-wrap break-words text-sm font-semibold leading-5">{message.body}</p> : null}
        {message.linkLabel ? <p className="mt-1.5 border-t border-navy/10 pt-1.5 text-center text-xs font-extrabold text-brand">🔗 {message.linkLabel}</p> : null}
        {message.buttons?.length ? (
          <div className="mt-1.5 flex flex-wrap gap-1.5">
            {message.buttons.map((label, index) => (
              <span key={index} className="rounded-full border border-brand/30 bg-white/70 px-2.5 py-0.5 text-[11px] font-extrabold text-brand">{label}</span>
            ))}
          </div>
        ) : null}
        <div className="mt-1 flex items-center justify-end gap-1.5 text-[10px] font-bold text-slate-400">
          {outbound && message.senderType === "user" && message.sentByName ? <span className="truncate">Enviada por {message.sentByName}</span> : null}
          <span>{TIME_FORMATTER.format(new Date(message.at))}</span>
          {outbound ? <StatusTicks status={message.status} /> : null}
        </div>
        {failed ? (
          <p className="mt-1 flex items-start gap-1 text-[11px] font-bold text-red-600">
            <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            <span>Não enviada{message.errorMessage ? ` — ${message.errorMessage}` : ""}{message.errorCode ? ` (código ${message.errorCode})` : ""}</span>
          </p>
        ) : null}
      </div>
    </div>
  );
}

function StatusTicks({ status }) {
  if (status === "read") return <CheckCheck className="h-3.5 w-3.5 text-sky-500" aria-label="Lida" />;
  if (status === "delivered") return <CheckCheck className="h-3.5 w-3.5" aria-label="Entregue" />;
  if (status === "sent") return <Check className="h-3.5 w-3.5" aria-label="Enviada" />;
  if (status === "failed") return <AlertCircle className="h-3.5 w-3.5 text-red-500" aria-label="Falhou" />;
  return <Loader2 className="h-3 w-3 animate-spin" aria-label="Enviando" />;
}

function Composer({ conversation, onSent }) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    setText("");
    setError("");
  }, [conversation.id]);

  if (!conversation.window.open) {
    return (
      <div className="border-t border-line bg-amber-50 px-4 py-3">
        <p className="text-sm font-extrabold text-amber-800">Janela de atendimento encerrada</p>
        <p className="mt-0.5 text-xs font-bold text-amber-700">
          Já se passaram mais de 24h desde a última mensagem deste contato. Pela regra do WhatsApp, agora só é possível enviar um modelo (template) aprovado — em breve disponível aqui. O contato volta a poder receber mensagem livre assim que ele escrever de novo.
        </p>
      </div>
    );
  }

  async function send() {
    const value = text.trim();
    if (!value || sending) return;
    setSending(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/messages`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ text: value })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível enviar a mensagem.");
      setText("");
    } catch (sendError) {
      setError(sendError.message);
    } finally {
      setSending(false);
      onSent();
    }
  }

  const expires = conversation.window.expiresAt ? TIME_FORMATTER.format(new Date(conversation.window.expiresAt)) : "";

  return (
    <div className="border-t border-line bg-white p-3">
      {error ? <p className="mb-2 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p> : null}
      <div className="flex items-end gap-2">
        <textarea
          className="max-h-32 min-h-11 flex-1 resize-none rounded-2xl border border-line bg-white px-4 py-2.5 text-sm font-semibold text-navy outline-none focus:border-brand focus:ring-4 focus:ring-brand/10"
          disabled={sending}
          onChange={(event) => setText(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              send();
            }
          }}
          placeholder="Digite uma mensagem…"
          rows={1}
          value={text}
        />
        <button
          type="button"
          onClick={send}
          disabled={sending || !text.trim()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-full bg-navy text-white transition hover:bg-[#082f55] disabled:opacity-40"
          aria-label="Enviar mensagem"
        >
          {sending ? <Loader2 className="h-5 w-5 animate-spin" /> : <Send className="h-5 w-5" />}
        </button>
      </div>
      {expires ? <p className="mt-1.5 px-1 text-[10px] font-bold text-slate-400">Mensagem livre permitida até {expires} (24h após a última mensagem do contato).</p> : null}
    </div>
  );
}

function ContactPanel({ detail, onChanged }) {
  const { conversation } = detail;
  const client = conversation.client;
  const [name, setName] = useState(conversation.name || "");
  const [adding, setAdding] = useState(false);
  const [error, setError] = useState("");
  const digits = useMemo(() => String(conversation.phone || "").replace(/\D/g, ""), [conversation.phone]);

  useEffect(() => {
    setName(conversation.name || "");
    setError("");
  }, [conversation.id, conversation.name]);

  async function addToCrm() {
    setAdding(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-chat/conversations/${conversation.id}/add-client`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível adicionar ao CRM.");
      onChanged();
    } catch (addError) {
      setError(addError.message);
    } finally {
      setAdding(false);
    }
  }

  const openClientHref = client ? `/admin/simulacoes?query=${encodeURIComponent(client.code || digits)}&clientId=${client.id}` : "";

  return (
    <div className="space-y-4 p-5">
      <div className="text-center">
        <div className="mx-auto w-fit"><Avatar name={displayName(conversation)} photoUrl={conversation.photoUrl} size={72} /></div>
        <p className="mt-3 font-black text-navy">{displayName(conversation)}</p>
        <p className="text-sm font-bold text-muted">{formatPhone(conversation.phone)}</p>
      </div>

      {client ? (
        <div className="space-y-2 rounded-2xl border border-line bg-mist/40 p-4 text-sm">
          <InfoRow label="Cliente" value={client.name ? `${client.name}${client.code ? ` · ${client.code}` : ""}` : "Vinculado"} />
          <InfoRow label="Corretor" value={client.responsibleName || "Sem corretor"} />
          <InfoRow label="Etapa" value={client.funnelStage || client.statusLabel} />
          <InfoRow label="Situação" value={client.statusLabel} />
          <InfoRow label="Origem" value={client.origin || (conversation.origin?.kind === "meta_ad" ? "Anúncio Meta" : "—")} />
          <Link href={openClientHref} className="mt-2 inline-flex h-10 w-full items-center justify-center gap-2 rounded-full border border-navy/15 bg-white text-sm font-extrabold text-navy transition hover:border-brand">
            <ExternalLink className="h-4 w-4" /> Abrir cliente
          </Link>
        </div>
      ) : (
        <div className="space-y-3 rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <p className="text-sm font-black text-amber-800">Contato não cadastrado</p>
          <p className="text-xs font-bold text-amber-700">Este telefone ainda não está em Clientes. Nada foi criado automaticamente.</p>
          <label className="block text-xs font-black text-navy">
            Nome
            <input
              className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand"
              onChange={(event) => setName(event.target.value)}
              placeholder="Nome do cliente"
              value={name}
            />
          </label>
          {error ? <p className="text-xs font-bold text-red-700">{error}</p> : null}
          <button
            type="button"
            onClick={addToCrm}
            disabled={adding || !name.trim()}
            className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-full bg-navy text-sm font-extrabold text-white transition hover:bg-[#082f55] disabled:opacity-50"
          >
            {adding ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserPlus className="h-4 w-4" />} Adicionar ao CRM
          </button>
        </div>
      )}

      {conversation.origin?.kind === "meta_ad" ? (
        <p className="rounded-2xl border border-blue-100 bg-blue-50 p-3 text-xs font-bold text-blue-700">Conversa iniciada por anúncio da Meta.</p>
      ) : null}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-3">
      <span className="text-[11px] font-extrabold uppercase tracking-wide text-muted">{label}</span>
      <span className="text-right font-bold text-navy">{value || "—"}</span>
    </div>
  );
}
