"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { History, Laptop, Smartphone } from "lucide-react";
import Avatar from "@/components/Avatar";
import { formatRelativeActivityText } from "@/lib/admin-presence-core.mjs";

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
  { value: "last_week", label: "Semana passada" },
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

function formatShortDate(plainDate) {
  const [, month, day] = String(plainDate || "").split("-");
  return day && month ? `${day}/${month}` : "";
}

// "Semana passada · 05/10 a 11/10" — o intervalo vem da resposta do servidor
// (o que de fato foi somado), nunca recalculado na tela.
function formatRangeLabel(range) {
  if (!range?.startDate) return "";
  const label = REPORT_PERIODS.find((option) => option.value === range.period)?.label || "";
  const dates = range.startDate === range.endDate
    ? formatShortDate(range.startDate)
    : `${formatShortDate(range.startDate)} a ${formatShortDate(range.endDate)}`;
  return label ? `${label} · ${dates}` : dates;
}

// "12 contatos · 8 manuais · 4 automáticos" (regra do dono, 2026-10-12).
function formatContacts(total, manual, auto) {
  const head = `${total} ${total === 1 ? "contato" : "contatos"}`;
  if (!total) return head;
  return `${head} · ${manual} ${manual === 1 ? "manual" : "manuais"} · ${auto} ${auto === 1 ? "automático" : "automáticos"}`;
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
    if (period === "custom" && (!startDate || !endDate)) {
      // Sem as duas datas não há período: não deixa o resultado do filtro
      // anterior na tela como se fosse do "Personalizado".
      setReport(null);
      setError("");
      setLoading(false);
      return undefined;
    }
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
  // Falha ao buscar os contatos nunca aparece como "0 contatos".
  const contactsAvailable = report?.contactsAvailable !== false;

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

      {period === "custom" && (!startDate || !endDate) ? (
        <p className="mt-4 rounded-2xl bg-blue-50 p-4 text-sm font-bold text-slate-600">Escolha a data de início e a final para ver as horas.</p>
      ) : null}

      {report?.ready ? (
        <>
          <p className="mt-5 text-sm font-extrabold text-navy">{formatRangeLabel(report.range)}</p>
          {!contactsAvailable ? (
            <p className="mt-2 text-xs font-bold text-amber-700">Não foi possível carregar os contatos agora.</p>
          ) : null}
          <div className="mt-3 grid grid-cols-2 gap-3">
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
                    {contactsAvailable ? (
                      <span className="rounded-full border border-blue-100 bg-blue-50 px-3 py-1 text-brand">{formatContacts(member.contacts, member.manualContacts, member.autoContacts)}</span>
                    ) : null}
                  </span>
                </button>

                {expandedId === member.id ? (
                  <div className="border-t border-navy/10 bg-blue-50/30 p-4">
                    {member.days.length ? (
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[640px] text-left text-sm">
                          <thead className="text-[11px] font-extrabold uppercase tracking-wide text-slate-500">
                            <tr>
                              <th className="pb-2">Dia</th>
                              <th className="pb-2">Primeiro</th>
                              <th className="pb-2">Último</th>
                              <th className="pb-2">Online</th>
                              <th className="pb-2">Ausente</th>
                              <th className="pb-2">Contatos</th>
                              <th className="pb-2">Manuais</th>
                              <th className="pb-2">Automáticos</th>
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
                                <td className="py-2">{contactsAvailable ? day.contacts : "—"}</td>
                                <td className="py-2">{contactsAvailable ? day.manualContacts : "—"}</td>
                                <td className="py-2">{contactsAvailable ? day.autoContacts : "—"}</td>
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
    <div className={`flex items-center justify-center gap-2.5 rounded-2xl border px-4 py-3 text-center sm:px-5 sm:py-4 ${tone}`}>
      <span className="text-xl leading-none sm:text-2xl">{emoji}</span>
      <div className="text-center">
        <p className="text-xl font-black leading-none sm:text-2xl">{value}</p>
        <p className="text-[11px] font-bold uppercase tracking-wide sm:text-xs">{label}</p>
      </div>
    </div>
  );
}

function MemberRow({ member }) {
  const meta = STATUS_META[member.status] || STATUS_META.offline;
  const [historyOpen, setHistoryOpen] = useState(false);
  return (
    <div className="rounded-2xl border border-navy/10 p-4 transition hover:border-brand">
      <div className="flex items-center justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          <span className="relative shrink-0">
            <Avatar name={member.name} photoUrl={member.photoUrl} size={40} />
            <span className={`absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-white ${meta.dot}`} aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <p className="truncate font-extrabold text-navy">{member.name}</p>
            <p className="text-xs font-bold text-slate-500">{formatRelativeActivityText(member.status, member.lastActivityAt)}</p>
          </div>
        </div>
        <div className="shrink-0 text-right">
          <span className="inline-flex items-center gap-1.5">
            <DeviceButton device={member.device} open={historyOpen} onClick={() => setHistoryOpen((value) => !value)} />
            <span className={`inline-flex items-center gap-1 rounded-full border px-2.5 py-1 text-[11px] font-black ${meta.chip}`}>
              {meta.emoji} {meta.label}
            </span>
          </span>
          <p className="mt-1 text-[11px] font-bold text-slate-400">{formatLastAccess(member.lastActivityAt)}</p>
        </div>
      </div>
      {historyOpen ? <PresenceHistory userId={member.id} /> : null}
    </div>
  );
}

// Aparelho do último acesso (celular = app/navegador do celular; notebook = computador). Clique abre o histórico do
// dia (entrou/saiu e aparelho). Sem aparelho conhecido ainda: ícone de histórico.
function DeviceButton({ device, open, onClick }) {
  const label = device === "mobile" ? "Pelo celular" : device === "desktop" ? "Pelo computador" : "Histórico de hoje";
  const Icon = device === "mobile" ? Smartphone : device === "desktop" ? Laptop : History;
  return (
    <button
      type="button"
      onClick={onClick}
      aria-expanded={open}
      title={`${label} — ver entradas e saídas de hoje`}
      aria-label={`${label}. Ver entradas e saídas de hoje`}
      className={`grid h-7 w-7 place-items-center rounded-full border transition ${open ? "border-navy bg-navy text-white" : "border-navy/10 bg-mist text-navy hover:border-brand hover:text-brand"}`}
    >
      <Icon size={15} strokeWidth={2.4} aria-hidden="true" />
    </button>
  );
}

// Hoje + os 3 dias anteriores (pedido do dono, 2026-10-12). Dias antes da coluna de aparelho existir mostram os
// horários com "Aparelho não identificado".
const HISTORY_DAYS = 4;

function PresenceHistory({ userId }) {
  const days = useMemo(() => buildHistoryDays(HISTORY_DAYS), []);
  const [day, setDay] = useState(days[0].key);
  const [state, setState] = useState({ loading: true, error: "", sessions: [] });
  useEffect(() => {
    let ignore = false;
    setState({ loading: true, error: "", sessions: [] });
    fetch(`/api/admin/presence/history?userId=${encodeURIComponent(userId)}&date=${day}`, { cache: "no-store" })
      .then(async (response) => {
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o histórico.");
        if (!ignore) setState({ loading: false, error: "", sessions: payload.sessions || [] });
      })
      .catch((error) => {
        if (!ignore) setState({ loading: false, error: error.message || "Não foi possível carregar o histórico.", sessions: [] });
      });
    return () => {
      ignore = true;
    };
  }, [userId, day]);

  const totalMinutes = state.sessions.reduce((sum, session) => sum + (session.minutes || 0), 0);

  return (
    <div className="mt-3 border-t border-navy/10 pt-3">
      <div className="flex flex-wrap gap-1.5" role="group" aria-label="Dia do histórico">
        {days.map((option) => (
          <button
            key={option.key}
            type="button"
            aria-pressed={day === option.key}
            onClick={() => setDay(option.key)}
            className={`rounded-full px-3 py-1 text-xs font-black transition ${day === option.key ? "bg-navy text-white" : "border border-navy/10 bg-mist text-navy hover:text-brand"}`}
          >
            {option.label}
          </button>
        ))}
      </div>
      {state.loading ? <p className="mt-2 text-sm font-bold text-slate-500">Carregando…</p> : null}
      {state.error ? <p className="mt-2 text-sm font-bold text-red-700">{state.error}</p> : null}
      {!state.loading && !state.error && !state.sessions.length ? <p className="mt-2 text-sm font-bold text-slate-500">Sem acesso neste dia.</p> : null}
      {!state.loading && state.sessions.length ? (
        <>
          <p className="mt-2 text-xs font-bold text-slate-500">{state.sessions.length} acesso{state.sessions.length === 1 ? "" : "s"} · {formatSessionMinutes(totalMinutes)} no total</p>
          <ul className="mt-1.5 space-y-1.5">
            {[...state.sessions].reverse().map((session) => {
              const Icon = session.device === "mobile" ? Smartphone : session.device === "desktop" ? Laptop : History;
              const deviceLabel = session.device === "mobile" ? "Celular" : session.device === "desktop" ? "Computador" : "Aparelho não identificado";
              return (
                <li key={session.start} className="flex items-center gap-2 text-sm font-bold text-navy">
                  <Icon size={15} strokeWidth={2.4} className="shrink-0 text-brand" aria-hidden="true" />
                  <span className="tabular-nums">{TIME_FORMATTER.format(new Date(session.start))} – {TIME_FORMATTER.format(new Date(session.end))}</span>
                  <span className="text-slate-500">· {deviceLabel} · {formatSessionMinutes(session.minutes)}</span>
                </li>
              );
            })}
          </ul>
        </>
      ) : null}
    </div>
  );
}

const WEEKDAY_FORMATTER = new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo", weekday: "short", day: "2-digit", month: "2-digit" });

function buildHistoryDays(count) {
  const now = Date.now();
  return Array.from({ length: count }, (_, index) => {
    const date = new Date(now - index * 24 * 60 * 60 * 1000);
    const key = DAY_KEY_FORMATTER.format(date);
    const label = index === 0 ? "Hoje" : index === 1 ? "Ontem" : WEEKDAY_FORMATTER.format(date).replace(".", "");
    return { key, label };
  });
}

function formatSessionMinutes(minutes) {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours}h${String(rest).padStart(2, "0")}` : `${hours}h`;
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
