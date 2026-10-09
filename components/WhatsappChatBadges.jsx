"use client";

import { Clock, UserRound } from "lucide-react";
import { CLIENT_STATUS_FILTER_GROUPS, CLIENT_STATUS_META } from "@/lib/client-status";

export function formatWait(minutes) {
  const value = Math.max(0, Math.round(minutes || 0));
  if (value < 1) return "agora";
  if (value < 60) return `${value} min`;
  const hours = Math.floor(value / 60);
  if (hours < 24) return `${hours} h`;
  const days = Math.floor(hours / 24);
  return `${days} dia${days > 1 ? "s" : ""}`;
}

// Sinal de conversa parada ("no vácuo"):
//  - awaiting_us: o cliente escreveu e ninguém respondeu (atenção >10 min, atrasado >30 min);
//  - contact_silent: nós escrevemos por último e o cliente não voltou a responder (>3 h).
export function WaitingBadge({ waiting, className = "" }) {
  if (!waiting) return null;
  if (waiting.kind === "awaiting_us") {
    if (waiting.level === "ok") return null;
    const late = waiting.level === "late";
    return (
      <span className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-extrabold ${late ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-800"} ${className}`}>
        <Clock className="h-3 w-3" aria-hidden="true" />
        {late ? "Sem resposta há" : "Aguardando há"} {formatWait(waiting.minutes)}
      </span>
    );
  }
  return (
    <span className={`inline-flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-extrabold text-slate-600 ${className}`}>
      <Clock className="h-3 w-3" aria-hidden="true" />
      Cliente em silêncio há {formatWait(waiting.minutes)}
    </span>
  );
}

// Etapa/situação do card do cliente (mesmos rótulos e cores da lista de Clientes).
export function ClientStatusBadge({ client, className = "" }) {
  if (!client?.status) return null;
  const meta = CLIENT_STATUS_META[client.status];
  const label = meta?.label || client.statusLabel;
  if (!label) return null;
  return (
    <span className={`inline-flex max-w-full items-center rounded-full px-2 py-0.5 text-[10px] font-extrabold ${meta?.badgeClass || "bg-slate-100 text-slate-600"} ${className}`} title={`Situação do cliente: ${label}`}>
      <span className="truncate">{label}</span>
    </span>
  );
}

// Só 3 cores por FASE (pedido do dono, 2026-10-09): começo do atendimento azul, documentação/aprovação laranja,
// fechamento verde; o resto (prospecção, arquivado, Não contactar) cinza. Grupos da fonte única (lib/client-status.js).
const PHASE_OF_GROUP = { service: "start", simulation: "start", documentation: "docs", approval: "docs", approved: "docs", meeting: "close", sale: "close" };
const PHASE_DOT = { start: "text-[#1D6FE8]", docs: "text-amber-500", close: "text-emerald-600" };
function phaseOfStatus(status) {
  const group = CLIENT_STATUS_FILTER_GROUPS.find((item) => item.key !== "all" && item.statuses.includes(status));
  return PHASE_OF_GROUP[group?.key] || "";
}

// Versão discreta para a lista de conversas (pedido do dono, 2026-10-09 — "tudo muito colorido"): texto cinza com uma
// bolinha na cor da etapa (mesma cor do selo, via currentColor).
export function ClientStatusDot({ client, className = "" }) {
  if (!client?.status) return null;
  const meta = CLIENT_STATUS_META[client.status];
  const label = meta?.label || client.statusLabel;
  if (!label) return null;
  const textClass = PHASE_DOT[phaseOfStatus(client.status)] || "text-slate-400";
  return (
    <span className={`inline-flex min-w-0 items-center gap-1 text-[12px] font-semibold text-[#667781] ${className}`} title={`Situação do cliente: ${label}`}>
      <span className={`shrink-0 ${textClass}`}><span className="block h-2 w-2 rounded-full bg-current" aria-hidden="true" /></span>
      <span className="truncate">{label}</span>
    </span>
  );
}

export function BrokerChip({ broker, className = "" }) {
  if (!broker) {
    return <span className={`inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-extrabold text-amber-700 ${className}`}>Sem corretor</span>;
  }
  return (
    <span className={`inline-flex max-w-full items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-extrabold text-brand ${className}`}>
      <UserRound className="h-3 w-3 shrink-0" aria-hidden="true" />
      <span className="truncate">{broker.name || "Corretor"}</span>
    </span>
  );
}
