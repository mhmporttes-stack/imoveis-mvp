"use client";

import { useState } from "react";
import Link from "next/link";
import { Inbox, Loader2, MessageCircle, UserRound } from "lucide-react";

export default function WhatsappMasterInbox({ initialEvents = [] }) {
  const [events, setEvents] = useState(initialEvents);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState("");
  const [exhausted, setExhausted] = useState(initialEvents.length < 30);

  async function loadMore() {
    if (loadingMore || exhausted) return;
    setLoadingMore(true);
    setError("");
    try {
      const last = events.at(-1);
      const params = new URLSearchParams({ limit: "30" });
      if (last?.createdAt) params.set("before", last.createdAt);
      const response = await fetch(`/api/whatsapp-master/events?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar mais mensagens.");
      setEvents((current) => [...current, ...(data.events || [])]);
      if (!data.events || data.events.length < 30) setExhausted(true);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoadingMore(false);
    }
  }

  return (
    <section className="container-page mt-6 rounded-[28px] border border-line bg-white p-6 shadow-soft">
      <div className="flex items-center gap-3">
        <span className="grid h-11 w-11 shrink-0 place-items-center rounded-2xl bg-blue-50 text-brand">
          <Inbox className="h-5 w-5" />
        </span>
        <div>
          <h2 className="text-xl font-black text-navy">Mensagens recebidas</h2>
          <p className="text-sm font-bold text-muted">O que os clientes mandam para o número oficial da equipe.</p>
        </div>
      </div>

      {!events.length ? (
        <p className="mt-6 rounded-2xl border border-line bg-mist/40 p-6 text-center text-sm font-bold text-muted">
          Nenhuma mensagem recebida ainda.
        </p>
      ) : (
        <div className="mt-6 space-y-3">
          {events.map((event) => (
            <EventRow key={event.id} event={event} />
          ))}
        </div>
      )}

      {error ? <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      {!exhausted && events.length ? (
        <button
          className="premium-button-secondary mt-5 w-full justify-center disabled:pointer-events-none disabled:opacity-60"
          disabled={loadingMore}
          onClick={loadMore}
          type="button"
        >
          {loadingMore ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
          {loadingMore ? "Carregando..." : "Carregar mais"}
        </button>
      ) : null}
    </section>
  );
}

function EventRow({ event }) {
  const clientQuery = event.client?.code || event.client?.name || "";

  return (
    <div className="rounded-2xl border border-line bg-mist/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex items-center gap-2 font-black text-navy">
          <MessageCircle className="h-4 w-4 text-brand" />
          {event.contactName || event.senderPhone || "Contato desconhecido"}
          {event.senderPhone && event.contactName ? <span className="text-xs font-bold text-muted">{event.senderPhone}</span> : null}
        </div>
        <span className="text-xs font-bold text-muted">{formatDateTime(event.eventAt)}</span>
      </div>

      <p className="mt-2 whitespace-pre-wrap text-sm font-semibold leading-6 text-navy">
        {event.messageText || (event.messageType && event.messageType !== "text" ? `[${event.messageType}]` : "Sem texto.")}
      </p>

      {event.client ? (
        <Link
          className="mt-3 inline-flex items-center gap-1.5 text-xs font-black text-brand hover:underline"
          href={`/admin/simulacoes${clientQuery ? `?query=${encodeURIComponent(clientQuery)}` : ""}`}
        >
          <UserRound className="h-3.5 w-3.5" />
          {event.client.name} {event.client.code ? `· ${event.client.code}` : ""}
        </Link>
      ) : (
        <p className="mt-3 text-xs font-bold text-muted">Sem cliente correspondente cadastrado.</p>
      )}
    </div>
  );
}

function formatDateTime(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(date);
}
