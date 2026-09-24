"use client";

import { Clock, UserRound } from "lucide-react";

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
      Cliente sem responder há {formatWait(waiting.minutes)}
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
