"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import Avatar from "@/components/Avatar";

// Aba "Corretores" da Supervisão do WhatsApp — um card por corretor com o
// status REAL da sessão de WhatsApp individual dele (conectado via QR Code
// ao microsserviço, não presença no CRM) e as conversas atribuídas a
// ele/dos seus clientes. "Abrir" reaproveita o MESMO Chat (onOpen), só
// passando o escopo de corretor — nunca uma tela nova. Com dois números
// (2026-10-08) o card mostra o status de cada um ("Número 1", "Número 2").
const STATUS_META = {
  connected: { dot: "bg-emerald-500", label: "Conectado", order: 0 },
  qr_required: { dot: "bg-amber-400", label: "Aguardando QR Code", order: 1 },
  connecting: { dot: "bg-amber-400", label: "Conectando…", order: 1 },
  reconnecting: { dot: "bg-amber-400", label: "Reconectando…", order: 1 },
  error: { dot: "bg-red-500", label: "Erro na conexão", order: 1 },
  disconnected: { dot: "bg-slate-300", label: "Desconectado", order: 2 }
};

export default function WhatsappChatBrokers({ onOpen }) {
  const [brokers, setBrokers] = useState(null);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    fetch("/api/admin/whatsapp-chat/broker-cards", { cache: "no-store" })
      .then((response) => response.json())
      .then((payload) => { if (active) { setBrokers(payload.brokers || []); setError(payload.error || ""); } })
      .catch(() => active && setError("Não foi possível carregar os corretores."));
    return () => { active = false; };
  }, []);

  if (error) return <p className="p-6 text-sm font-bold text-red-700">{error}</p>;
  if (!brokers) return <p className="flex items-center gap-2 p-6 text-sm font-bold text-muted"><Loader2 className="h-4 w-4 animate-spin" /> Carregando corretores…</p>;
  if (!brokers.length) return <p className="p-6 text-sm text-muted">Nenhum corretor visível para você.</p>;

  // Conectados com pendência primeiro, depois conectados, depois desconectados.
  const sorted = [...brokers].sort((a, b) => {
    const orderDiff = (STATUS_META[a.status] || STATUS_META.disconnected).order - (STATUS_META[b.status] || STATUS_META.disconnected).order;
    if (orderDiff !== 0) return orderDiff;
    const pendingDiff = (b.counts.awaiting || 0) - (a.counts.awaiting || 0);
    if (pendingDiff !== 0) return pendingDiff;
    return a.name.localeCompare(b.name, "pt-BR");
  });

  return (
    <div className="grid grid-cols-1 gap-4 p-5 sm:grid-cols-2 lg:grid-cols-3">
      {sorted.map((broker) => {
        const meta = STATUS_META[broker.status] || STATUS_META.disconnected;
        return (
          <div key={broker.id} className="flex flex-col justify-between rounded-2xl border border-navy/[0.08] bg-white p-4 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
            <div className="flex items-center gap-3">
              <span className="relative shrink-0">
                <Avatar name={broker.name} photoUrl={broker.photoUrl} size={44} />
                <span className={`absolute -bottom-0.5 -right-0.5 h-3.5 w-3.5 rounded-full border-2 border-white ${meta.dot}`} title={meta.label} />
              </span>
              <div className="min-w-0">
                <p className="truncate text-sm font-black text-navy">{broker.name}</p>
                <p className="text-xs font-bold text-muted">{meta.label}</p>
              </div>
            </div>

            {/* Status de cada número (2026-10-08): o Número 2 só aparece quando foi configurado. */}
            {Array.isArray(broker.slots) ? (
              <ul className="mt-3 space-y-1">
                {broker.slots.filter((item) => item.slot === 1 || item.configured).map((item) => {
                  const slotMeta = STATUS_META[item.status] || STATUS_META.disconnected;
                  return (
                    <li key={item.slot} className="flex items-center gap-2 text-xs font-bold text-navy">
                      <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${slotMeta.dot}`} aria-hidden="true" />
                      <span className="truncate">{item.label}</span>
                      <span className="ml-auto shrink-0 text-muted">{slotMeta.label}</span>
                    </li>
                  );
                })}
              </ul>
            ) : null}

            <div className="mt-4 grid grid-cols-3 gap-2 text-center">
              <CountTile label="Não lidas" value={broker.counts.unread} tone={broker.counts.unread > 0 ? "text-emerald-600" : "text-navy"} />
              <CountTile label="Sem resposta" value={broker.counts.awaiting} tone={broker.counts.awaiting > 0 ? "text-red-600" : "text-navy"} />
              <CountTile label="Ativas" value={broker.counts.active} tone="text-navy" />
            </div>

            <button type="button" onClick={() => onOpen(broker.id)} className="mt-4 rounded-full border border-brand/30 py-2 text-xs font-black text-brand transition hover:bg-brand/5">
              Abrir
            </button>
          </div>
        );
      })}
    </div>
  );
}

function CountTile({ label, value, tone }) {
  return (
    <div className="rounded-xl bg-mist/50 py-2">
      <p className={`text-lg font-black ${tone}`}>{value || 0}</p>
      <p className="text-[10px] font-bold uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}
