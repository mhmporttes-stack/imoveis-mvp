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

      <HoursReport />
    </div>
  );
}

const REPORT_PERIODS = [
  { value: "today", label: "Hoje" },
  { value: "yesterday", label: "Ontem" },
  { value: "week", label: "Esta semana" },
  { value: "month", label: "Este mês" },
  { value: "custom", label: "Personalizado" }
];

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("pt-BR", { weekday: "short", timeZone: "UTC" });

function formatMinutes(total) {
  const minutes = Math.max(0, Math.round(total || 0));
  if (!minutes) return "0min";
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (!hours) return `${rest}min`;
  return rest ? `${hours}h ${String(rest).padStart(2, "0")}min` : `${hours}h`;
}

function formatDayLabel(plainDate) {
  const [year, month, day] = plainDate.split("-").map(Number);
  const weekday = WEEKDAY_FORMATTER.format(new Date(Date.UTC(year, month - 1, day))).replace(".", "");
  return `${weekday} ${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}`;
}

// Horas no CRM por corretor: tempo online (com interação real) e ausente,
// a partir do histórico de atividade gravado pelo heartbeat. Cruza com os
// contatos da Meta Diária para separar "online e produzindo" de "online sem
// produzir".
function HoursReport() {
  const [period, setPeriod] = useState("today");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [expandedId, setExpandedId] = useState("");

  useEffect(() => {
    if (period === "custom" && (!startDate || !endDate)) return undefined;
    const controller = new AbortController();
    setLoading(true);
    setError("");

    const params = new URLSearchParams({ period });
    if (period === "custom") {
      params.set("startDate", startDate);
      params.set("endDate", endDate);
    }

    fetch(`/api/admin/presence/report?${params.toString()}`, { signal: controller.signal })
      .then(async (response) => {
        const data = await response.json().catch(() => null);
        if (!response.ok) throw new Error(data?.error || "Não foi possível carregar as horas.");
        setReport(data);
      })
      .catch((requestError) => {
        if (requestError.name !== "AbortError") setError(requestError.message || "Não foi possível carregar as horas.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });

    return () => controller.abort();
  }, [period, startDate, endDate]);

  const members = report?.members || [];
  const teamActive = members.reduce((sum, member) => sum + member.activeMinutes, 0);
  const teamAway = members.reduce((sum, member) => sum + member.awayMinutes, 0);
  const multiDay = report?.range && report.range.startDate !== report.range.endDate;

  return (
    <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
      <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Horas no CRM</p>
      <h3 className="mt-2 text-2xl font-extrabold text-navy">Quanto tempo cada corretor trabalhou</h3>
      <p className="mt-2 text-sm font-bold text-slate-500">
        Conta só o tempo com interação real no CRM (clique, digitação, rolagem, toque). Sem interagir por 5 minutos o tempo online pausa e vira ausente.
      </p>

      <div className="mt-5 flex flex-wrap gap-2" role="tablist" aria-label="Período das horas">
        {REPORT_PERIODS.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => setPeriod(option.value)}
            className={`min-h-10 rounded-full border px-4 text-sm font-extrabold transition ${
              period === option.value ? "border-brand bg-blue-50 text-brand" : "border-navy/10 bg-white text-navy hover:border-brand"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      {period === "custom" ? (
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="text-sm font-extrabold text-navy">
            Início
            <input type="date" value={startDate} onChange={(event) => setStartDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-2xl border border-navy/15 px-4 text-sm text-navy outline-none focus:border-brand" />
          </label>
          <label className="text-sm font-extrabold text-navy">
            Final
            <input type="date" value={endDate} onChange={(event) => setEndDate(event.target.value)} className="mt-1 min-h-11 w-full rounded-2xl border border-navy/15 px-4 text-sm text-navy outline-none focus:border-brand" />
          </label>
        </div>
      ) : null}

      {error ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p> : null}

      {report && !report.ready ? (
        <p className="mt-4 rounded-2xl bg-amber-50 p-4 text-sm font-bold text-amber-800">
          O histórico de horas ainda não foi ativado no banco de dados (falta criar a tabela de atividade). Assim que for criada, os números começam a aparecer aqui conforme a equipe usa o CRM.
        </p>
      ) : null}

      {report?.ready ? (
        <>
          <div className="mt-5 grid grid-cols-2 gap-3">
            <div className="rounded-2xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-emerald-700">
              <p className="text-xl font-black sm:text-2xl">{formatMinutes(teamActive)}</p>
              <p className="text-[11px] font-bold uppercase tracking-wide">Online (equipe)</p>
            </div>
            <div className="rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 text-amber-700">
              <p className="text-xl font-black sm:text-2xl">{formatMinutes(teamAway)}</p>
              <p className="text-[11px] font-bold uppercase tracking-wide">Ausente (equipe)</p>
            </div>
          </div>

          <div className={`mt-5 space-y-3 transition-opacity ${loading ? "opacity-60" : ""}`}>
            {members.map((member) => (
              <div key={member.id} className="rounded-2xl border border-navy/10">
                <button
                  type="button"
                  onClick={() => setExpandedId((current) => (current === member.id ? "" : member.id))}
                  className="flex w-full flex-wrap items-center justify-between gap-3 p-4 text-left"
                  aria-expanded={expandedId === member.id}
                >
                  <span className="flex min-w-0 items-center gap-3">
                    <Avatar name={member.name} photoUrl={member.photoUrl} size={40} />
                    <span className="min-w-0">
                      <span className="block truncate font-extrabold text-navy">{member.name}</span>
                      <span className="block text-xs font-bold text-slate-500">
                        {member.daysWithPresence} {member.daysWithPresence === 1 ? "dia" : "dias"} com atividade
                        {multiDay ? ` · média ${formatMinutes(member.averageActiveMinutesPerDay)}/dia` : ""}
                      </span>
                    </span>
                  </span>
                  <span className="flex flex-wrap items-center gap-2 text-sm font-black">
                    <span className="rounded-full border border-emerald-100 bg-emerald-50 px-3 py-1 text-emerald-700">Online {formatMinutes(member.activeMinutes)}</span>
                    <span className="rounded-full border border-amber-100 bg-amber-50 px-3 py-1 text-amber-700">Ausente {formatMinutes(member.awayMinutes)}</span>
                    <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-brand">{member.contacts} {member.contacts === 1 ? "contato" : "contatos"}</span>
                  </span>
                </button>

                {expandedId === member.id ? (
                  <div className="border-t border-navy/10 bg-blue-50/30 p-4">
                    {member.days.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[520px] text-left text-sm">
                          <thead className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="pb-2">Dia</th>
                              <th className="pb-2">Primeiro</th>
                              <th className="pb-2">Último</th>
                              <th className="pb-2">Online</th>
                              <th className="pb-2">Ausente</th>
                              <th className="pb-2">Contatos</th>
                            </tr>
                          </thead>
                          <tbody className="font-bold text-navy">
                            {member.days.map((day) => (
                              <tr key={day.date} className="border-t border-navy/10">
                                <td className="py-2">{formatDayLabel(day.date)}</td>
                                <td className="py-2">{day.firstAt ? TIME_FORMATTER.format(new Date(day.firstAt)) : "—"}</td>
                                <td className="py-2">{day.lastAt ? TIME_FORMATTER.format(new Date(day.lastAt)) : "—"}</td>
                                <td className="py-2 text-emerald-700">{formatMinutes(day.activeMinutes)}</td>
                                <td className="py-2 text-amber-700">{formatMinutes(day.awayMinutes)}</td>
                                <td className="py-2">{day.contacts}</td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    ) : (
                      <p className="text-sm font-bold text-slate-500">Sem atividade registrada neste período.</p>
                    )}
                  </div>
                ) : null}
              </div>
            ))}
            {!members.length ? <p className="rounded-2xl bg-blue-50 p-4 text-sm font-bold text-slate-600">Nenhum corretor na sua equipe.</p> : null}
          </div>
        </>
      ) : null}
    </article>
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
