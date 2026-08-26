"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { CalendarDays, ChevronLeft, ChevronRight, Clock, UserRound, X } from "lucide-react";

const WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function ActivityCalendar() {
  const today = useMemo(() => new Date(), []);
  const [visibleMonth, setVisibleMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(toDateKey(today));
  const [activities, setActivities] = useState([]);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let ignore = false;
    async function loadActivities() {
      setLoading(true);
      setError("");
      try {
        const start = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth(), 1, 0, 0, 0);
        const end = new Date(visibleMonth.getFullYear(), visibleMonth.getMonth() + 1, 0, 23, 59, 59);
        const response = await fetch(`/api/calendar-activities?from=${encodeURIComponent(start.toISOString())}&to=${encodeURIComponent(end.toISOString())}`, {
          cache: "no-store"
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o calendário.");
        if (!ignore) setActivities(payload.activities || []);
      } catch (loadError) {
        if (!ignore) setError(loadError.message || "Não foi possível carregar o calendário.");
      } finally {
        if (!ignore) setLoading(false);
      }
    }

    loadActivities();
    return () => {
      ignore = true;
    };
  }, [visibleMonth]);

  const activitiesByDate = useMemo(() => {
    const grouped = new Map();
    for (const activity of activities) {
      const key = toSaoPauloDateKey(activity.scheduledActivityAt);
      if (!key) continue;
      grouped.set(key, [...(grouped.get(key) || []), activity]);
    }
    for (const [key, value] of grouped.entries()) {
      grouped.set(key, value.sort((a, b) => new Date(a.scheduledActivityAt) - new Date(b.scheduledActivityAt)));
    }
    return grouped;
  }, [activities]);

  const selectedActivities = activitiesByDate.get(selectedDate) || [];
  const monthDays = buildMonthDays(visibleMonth);

  return (
    <section className="container-page pb-14">
      <div className="rounded-[28px] border border-line bg-white p-5 shadow-soft md:p-8">
        <div className="flex flex-col gap-4 border-b border-line pb-5 md:flex-row md:items-center md:justify-between">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.28em] text-brand">Agenda dos corretores</p>
            <h2 className="mt-2 text-3xl font-black text-navy md:text-4xl">{formatMonthTitle(visibleMonth)}</h2>
          </div>
          <div className="flex gap-2">
            <button type="button" className="rounded-full border border-brand/20 bg-white p-3 text-brand transition hover:-translate-y-0.5 hover:shadow-soft" aria-label="Mês anterior" onClick={() => setVisibleMonth(addMonths(visibleMonth, -1))}>
              <ChevronLeft size={20} />
            </button>
            <button type="button" className="rounded-full border border-brand/20 bg-white p-3 text-brand transition hover:-translate-y-0.5 hover:shadow-soft" aria-label="Próximo mês" onClick={() => setVisibleMonth(addMonths(visibleMonth, 1))}>
              <ChevronRight size={20} />
            </button>
          </div>
        </div>

        {error ? (
          <p className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-5 py-4 font-bold text-red-800">{error}</p>
        ) : null}

        <div className="mt-6 grid gap-6 xl:grid-cols-[minmax(0,1.35fr)_minmax(340px,0.65fr)]">
          <div>
            <div className="grid grid-cols-7 gap-2 text-center text-xs font-black uppercase tracking-[0.12em] text-slate">
              {WEEK_DAYS.map((day) => <span key={day}>{day}</span>)}
            </div>
            <div className="mt-3 grid grid-cols-7 gap-2">
              {monthDays.map((day, index) => {
                const key = day ? toDateKey(day) : `empty-${index}`;
                const dayActivities = day ? activitiesByDate.get(key) || [] : [];
                const isSelected = key === selectedDate;
                return day ? (
                  <button
                    key={key}
                    type="button"
                    className={`min-h-24 rounded-2xl border p-2 text-left transition md:min-h-32 ${
                      isSelected
                        ? "border-brand bg-brand/10 shadow-soft"
                        : dayActivities.length
                          ? "border-brand/20 bg-white hover:-translate-y-0.5 hover:border-brand hover:shadow-soft"
                          : "border-line bg-[#f8fbff] hover:border-brand/30"
                    }`}
                    onClick={() => setSelectedDate(key)}
                  >
                    <span className="text-sm font-black text-navy">{day.getDate()}</span>
                    {dayActivities.length ? (
                      <span className="mt-1 block w-fit rounded-full bg-navy px-2 py-0.5 text-[11px] font-black text-white">
                        {dayActivities.length} {dayActivities.length === 1 ? "atividade" : "atividades"}
                      </span>
                    ) : null}
                    <span className="mt-2 hidden space-y-1 md:block">
                      {dayActivities.slice(0, 2).map((activity) => (
                        <span key={activity.id} className="block truncate rounded-full bg-brand/10 px-2 py-1 text-[11px] font-bold text-navy">
                          {formatTime(activity.scheduledActivityAt)} · {activity.responsibleName}
                        </span>
                      ))}
                      {dayActivities.length > 2 ? <span className="block text-[11px] font-bold text-brand">+{dayActivities.length - 2}</span> : null}
                    </span>
                  </button>
                ) : (
                  <div key={key} className="min-h-24 rounded-2xl border border-transparent md:min-h-32" />
                );
              })}
            </div>
          </div>

          <aside className="rounded-[24px] border border-line bg-[#f8fbff] p-5">
            <div className="flex items-center gap-3">
              <span className="grid h-11 w-11 place-items-center rounded-full bg-brand/10 text-brand">
                <CalendarDays size={22} />
              </span>
              <div>
                <p className="text-xs font-black uppercase tracking-[0.2em] text-brand">Atividades do dia</p>
                <h3 className="text-xl font-black text-navy">{formatDateLabel(selectedDate)}</h3>
              </div>
            </div>

            {loading ? (
              <p className="mt-5 rounded-2xl bg-white px-4 py-5 font-bold text-slate">Carregando atividades...</p>
            ) : selectedActivities.length ? (
              <div className="mt-5 space-y-3">
                {selectedActivities.map((activity) => (
                  <button
                    key={activity.id}
                    type="button"
                    className="w-full rounded-2xl border border-brand/15 bg-white p-4 text-left transition hover:-translate-y-0.5 hover:border-brand hover:shadow-soft"
                    onClick={() => setSelectedActivity(activity)}
                  >
                    <span className="flex items-center gap-2 text-sm font-black text-brand">
                      <Clock size={16} /> {formatTime(activity.scheduledActivityAt)}
                    </span>
                    <span className="mt-2 block font-black text-navy">
                      {activity.responsibleName} - {activity.clientName}
                    </span>
                    {activity.scheduledActivityNote ? (
                      <span className="mt-1 block line-clamp-2 text-sm font-semibold text-slate">{activity.scheduledActivityNote}</span>
                    ) : null}
                  </button>
                ))}
              </div>
            ) : (
              <p className="mt-5 rounded-2xl bg-white px-4 py-5 font-bold text-slate">Nenhuma atividade agendada para este dia.</p>
            )}
          </aside>
        </div>
      </div>

      {selectedActivity ? (
        <ActivityModal activity={selectedActivity} onClose={() => setSelectedActivity(null)} />
      ) : null}
    </section>
  );
}

function ActivityModal({ activity, onClose }) {
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = "";
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-navy/70 p-4" role="dialog" aria-modal="true" onMouseDown={onClose}>
      <div className="w-full max-w-2xl rounded-[28px] bg-white p-6 shadow-2xl md:p-8" onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-brand">Atividade agendada</p>
            <h3 className="mt-2 text-3xl font-black text-navy">{activity.clientName}</h3>
          </div>
          <button type="button" className="rounded-full border border-line p-3 text-navy transition hover:bg-mist" aria-label="Fechar detalhes da atividade" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          <Detail icon={<Clock size={18} />} label="Data e horário" value={`${formatDateLabel(toSaoPauloDateKey(activity.scheduledActivityAt))} às ${formatTime(activity.scheduledActivityAt)}`} />
          <Detail icon={<UserRound size={18} />} label="Corretor" value={activity.responsibleName} />
          <Detail label="Cliente" value={activity.clientName} />
          <Detail label="WhatsApp" value={activity.phone || "Não informado"} />
        </div>

        <div className="mt-5 rounded-2xl border border-line bg-[#f8fbff] p-5">
          <p className="text-xs font-black uppercase tracking-[0.18em] text-brand">Descrição</p>
          <p className="mt-2 whitespace-pre-wrap text-base font-semibold leading-7 text-navy">
            {activity.scheduledActivityNote || "Sem descrição informada."}
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <Link href={`/admin/simulacoes/${activity.id}`} className="premium-button-primary text-center">
            Abrir cliente
          </Link>
          <button type="button" className="premium-button-secondary" onClick={onClose}>Fechar</button>
        </div>
      </div>
    </div>
  );
}

function Detail({ icon = null, label, value }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.16em] text-brand">
        {icon} {label}
      </p>
      <p className="mt-2 font-bold text-navy">{value}</p>
    </div>
  );
}

function buildMonthDays(date) {
  const start = new Date(date.getFullYear(), date.getMonth(), 1);
  const days = Array.from({ length: start.getDay() }, () => null);
  const total = new Date(date.getFullYear(), date.getMonth() + 1, 0).getDate();
  for (let day = 1; day <= total; day += 1) {
    days.push(new Date(date.getFullYear(), date.getMonth(), day));
  }
  return days;
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function toSaoPauloDateKey(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).formatToParts(date);
  const part = (type) => parts.find((item) => item.type === type)?.value || "";
  return `${part("year")}-${part("month")}-${part("day")}`;
}

function formatMonthTitle(date) {
  return new Intl.DateTimeFormat("pt-BR", {
    month: "long",
    year: "numeric"
  }).format(date).replace(/^./, (letter) => letter.toUpperCase());
}

function formatDateLabel(dateKey) {
  if (!dateKey) return "Sem data";
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(year, month - 1, day, 12, 0, 0);
  return new Intl.DateTimeFormat("pt-BR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric"
  }).format(date);
}

function formatTime(value) {
  const date = new Date(value || "");
  if (Number.isNaN(date.getTime())) return "--:--";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    timeZone: "America/Sao_Paulo"
  }).format(date);
}
