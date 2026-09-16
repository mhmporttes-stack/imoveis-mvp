"use client";

import { useEffect, useRef, useState } from "react";
import Avatar from "@/components/Avatar";

// Mesmo espírito de NewClientSoundListener: intervalo fixo e moderado, só
// enquanto a aba está visível — nunca polling agressivo nem uma requisição
// por segundo. A tela também nunca fica presa num "Online" desatualizado:
// cada leitura recalcula o status a partir da idade real do último
// heartbeat (lib/admin-presence.js), não de um valor armazenado.
const POLL_INTERVAL_MS = 20000;

const STATUS_META = {
  online: { emoji: "🟢", label: "Online", dot: "bg-emerald-500", chip: "border-emerald-100 bg-emerald-50 text-emerald-700" },
  away: { emoji: "🟡", label: "Ausente", dot: "bg-amber-500", chip: "border-amber-100 bg-amber-50 text-amber-700" },
  offline: { emoji: "⚫", label: "Offline", dot: "bg-slate-400", chip: "border-slate-200 bg-slate-50 text-slate-600" }
};

export default function OnlinePresenceBoard({ initialPresence, initialError = "" }) {
  const [presence, setPresence] = useState(initialPresence);
  const [error, setError] = useState(initialError);
  const [, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      if (cancelled || document.visibilityState !== "visible") return;
      try {
        const response = await fetch("/api/admin/presence");
        const data = await response.json().catch(() => null);
        if (cancelled) return;
        if (!response.ok) {
          setError(data?.error || "Não foi possível carregar a presença da equipe.");
          return;
        }
        setPresence(data);
        setError("");
      } catch {
        // Falha de rede pontual — tenta de novo no próximo ciclo.
      }
    }

    const intervalId = setInterval(load, POLL_INTERVAL_MS);
    document.addEventListener("visibilitychange", load);
    // Recalcula só os textos relativos ("há X min") a cada minuto, sem
    // depender de uma nova requisição — o status/contagem em si só muda
    // quando um novo heartbeat chega (próximo poll).
    const tickId = setInterval(() => setTick((value) => value + 1), 60000);

    return () => {
      cancelled = true;
      clearInterval(intervalId);
      clearInterval(tickId);
      document.removeEventListener("visibilitychange", load);
    };
  }, []);

  const members = presence?.members || [];

  return (
    <div className="container-page grid gap-5">
      {error ? (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700">{error}</div>
      ) : null}

      <div className="grid grid-cols-3 gap-3 sm:gap-4">
        <StatPill emoji="🟢" label="Online" value={presence?.online || 0} tone="border-emerald-100 bg-emerald-50 text-emerald-700" />
        <StatPill emoji="🟡" label="Ausentes" value={presence?.away || 0} tone="border-amber-100 bg-amber-50 text-amber-700" />
        <StatPill emoji="⚫" label="Offline" value={presence?.offline || 0} tone="border-slate-200 bg-slate-50 text-slate-600" />
      </div>

      <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
        <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Equipe</p>
        <h3 className="mt-2 text-2xl font-extrabold text-navy">Presença no CRM</h3>

        <div className="mt-6 space-y-3">
          {!members.length ? (
            <p className="rounded-2xl bg-blue-50 p-4 text-sm font-bold text-slate-600">Nenhum corretor na sua equipe.</p>
          ) : (
            members.map((member) => <MemberRow key={member.id} member={member} />)
          )}
        </div>
      </article>
    </div>
  );
}

function StatPill({ emoji, label, value, tone }) {
  return (
    <div className={`flex items-center gap-2 rounded-2xl border px-4 py-3 sm:px-5 sm:py-4 ${tone}`}>
      <span className="text-xl leading-none sm:text-2xl">{emoji}</span>
      <div>
        <p className="text-xl font-black leading-none sm:text-2xl">{value}</p>
        <p className="text-[11px] font-bold uppercase tracking-wide sm:text-xs">{label}</p>
      </div>
    </div>
  );
}

function MemberRow({ member }) {
  const meta = STATUS_META[member.status] || STATUS_META.offline;
  return (
    <div className="flex items-center justify-between gap-4 rounded-2xl border border-navy/10 p-4 transition hover:border-brand">
      <div className="flex min-w-0 items-center gap-3">
        <span className="relative shrink-0">
          <Avatar name={member.name} photoUrl={member.photoUrl} size={40} />
          <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${meta.dot}`} aria-hidden="true" />
        </span>
        <div className="min-w-0">
          <p className="truncate font-extrabold text-navy">{member.name}</p>
          <p className="text-xs font-bold text-slate-500">{formatRelativeActivity(member.status, member.lastActivityAt)}</p>
        </div>
      </div>
      <div className="shrink-0 text-right">
        <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black ${meta.chip}`}>
          {meta.emoji} {meta.label}
        </span>
        <p className="mt-1 text-[11px] font-bold text-slate-400">{formatLastAccess(member.lastActivityAt)}</p>
      </div>
    </div>
  );
}

function formatRelativeActivity(status, lastActivityAt) {
  if (!lastActivityAt) return "Sem atividade registrada";
  if (status === "online") return "Ativo agora";

  const elapsedMs = Date.now() - new Date(lastActivityAt).getTime();
  const minutes = Math.max(1, Math.round(elapsedMs / 60000));
  if (minutes < 60) return `Última atividade há ${minutes} min`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `Última atividade há ${hours}h`;
  const days = Math.round(hours / 24);
  return `Última atividade há ${days} dia${days > 1 ? "s" : ""}`;
}

const DAY_KEY_FORMATTER = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" });
const TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", hour: "2-digit", minute: "2-digit" });
const DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", day: "2-digit", month: "2-digit", year: "numeric" });

function formatLastAccess(lastActivityAt) {
  if (!lastActivityAt) return "";
  const date = new Date(lastActivityAt);
  const time = TIME_FORMATTER.format(date);
  const dayKey = DAY_KEY_FORMATTER.format(date);
  const todayKey = DAY_KEY_FORMATTER.format(new Date());
  const yesterdayKey = DAY_KEY_FORMATTER.format(new Date(Date.now() - 24 * 60 * 60 * 1000));

  if (dayKey === todayKey) return `Hoje às ${time}`;
  if (dayKey === yesterdayKey) return `Ontem às ${time}`;
  return `${DATE_FORMATTER.format(date)} às ${time}`;
}
