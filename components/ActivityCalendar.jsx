"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { AlertTriangle, CalendarClock, CalendarDays, CheckCircle2, ChevronLeft, ChevronRight, Clock, UserRound, X } from "lucide-react";

const WEEK_DAYS = ["Dom", "Seg", "Ter", "Qua", "Qui", "Sex", "Sáb"];

export default function ActivityCalendar() {
  const today = useMemo(() => new Date(), []);
  const [visibleMonth, setVisibleMonth] = useState(new Date(today.getFullYear(), today.getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(toDateKey(today));
  const [activities, setActivities] = useState([]);
  const [selectedActivity, setSelectedActivity] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [completeLoadingId, setCompleteLoadingId] = useState("");
  const [completeError, setCompleteError] = useState("");
  const [activeLateActivityId, setActiveLateActivityId] = useState("");
  const [rescheduleActivity, setRescheduleActivity] = useState(null);
  const [rescheduleDate, setRescheduleDate] = useState("");
  const [rescheduleTime, setRescheduleTime] = useState("");
  const [rescheduleNote, setRescheduleNote] = useState("");
  const [rescheduleLoading, setRescheduleLoading] = useState(false);
  const [rescheduleError, setRescheduleError] = useState("");

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
  const selectedActivityGroups = useMemo(() => {
    const groups = {
      pending: [],
      scheduled: [],
      completed: []
    };

    for (const activity of selectedActivities) {
      groups[getActivityState(activity)].push(activity);
    }

    return [
      { key: "pending", title: "Atividades pendentes", items: groups.pending },
      { key: "scheduled", title: "Atividades agendadas", items: groups.scheduled },
      { key: "completed", title: "Atividades concluídas", items: groups.completed }
    ].filter((group) => group.items.length);
  }, [selectedActivities]);
  const monthDays = buildMonthDays(visibleMonth);

  async function completeActivity(activity) {
    if (!activity?.id || activity.scheduledActivityCompletedAt || completeLoadingId) return;

    setCompleteError("");
    setCompleteLoadingId(activity.id);

    try {
      const response = await fetch(`/api/simulation-registrations/${activity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scheduledActivityCompleted: true })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Não foi possível concluir a atividade.");

      const completedAt = payload?.scheduledActivityCompletedAt || new Date().toISOString();
      setActivities((current) => current.map((item) => (
        item.id === activity.id
          ? { ...item, scheduledActivityCompleted: true, scheduledActivityCompletedAt: completedAt }
          : item
      )));
      setSelectedActivity((current) => (
        current?.id === activity.id
          ? { ...current, scheduledActivityCompleted: true, scheduledActivityCompletedAt: completedAt }
          : current
      ));
      setActiveLateActivityId("");
    } catch (completeActivityError) {
      setCompleteError(completeActivityError.message || "Não foi possível concluir a atividade.");
    } finally {
      setCompleteLoadingId("");
    }
  }

  function openReschedule(activity) {
    setRescheduleActivity(activity);
    setRescheduleDate(toSaoPauloDateKey(activity.scheduledActivityAt));
    setRescheduleTime(formatInputTime(activity.scheduledActivityAt));
    setRescheduleNote(activity.scheduledActivityNote || "");
    setRescheduleError("");
    setActiveLateActivityId("");
  }

  async function submitReschedule(event) {
    event.preventDefault();
    if (!rescheduleActivity?.id || rescheduleLoading) return;

    setRescheduleError("");
    setRescheduleLoading(true);
    try {
      const response = await fetch(`/api/simulation-registrations/${rescheduleActivity.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          scheduledActivityDate: rescheduleDate,
          scheduledActivityTime: rescheduleTime,
          scheduledActivityNote: rescheduleNote
        })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Não foi possível reagendar a atividade.");

      const nextActivity = {
        ...rescheduleActivity,
        scheduledActivityAt: payload.scheduledActivityAt,
        scheduledActivityNote: payload.scheduledActivityNote || "",
        scheduledActivityCompleted: false,
        scheduledActivityCompletedAt: "",
        scheduledActivityCompletedBy: ""
      };

      setActivities((current) => current.map((item) => (
        item.id === rescheduleActivity.id ? { ...item, ...nextActivity } : item
      )));
      setSelectedActivity((current) => (
        current?.id === rescheduleActivity.id ? { ...current, ...nextActivity } : current
      ));
      setRescheduleActivity(null);
    } catch (rescheduleActivityError) {
      setRescheduleError(rescheduleActivityError.message || "Não foi possível reagendar a atividade.");
    } finally {
      setRescheduleLoading(false);
    }
  }

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
                {completeError ? (
                  <p className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">
                    {completeError}
                  </p>
                ) : null}
                {selectedActivityGroups.map((group) => (
                  <div key={group.key} className="space-y-2">
                    <p className="px-1 text-[11px] font-black uppercase tracking-[0.18em] text-slate">{group.title}</p>
                    {group.items.map((activity) => {
                      const state = getActivityState(activity);
                      const isLateOpen = activeLateActivityId === activity.id;
                      return (
                        <div
                          key={activity.id}
                          className={`rounded-2xl border bg-white p-4 text-left transition hover:-translate-y-0.5 hover:shadow-soft ${
                            state === "completed"
                              ? "border-emerald-200 bg-emerald-50/70"
                              : state === "pending"
                                ? "border-red-200 bg-red-50/70"
                                : "border-brand/15 hover:border-brand"
                          }`}
                        >
                          <div className="flex w-full items-center gap-3">
                            <button
                              type="button"
                              className="min-w-0 flex-1 text-left"
                              onClick={() => setSelectedActivity(activity)}
                            >
                              <span className={`flex items-center gap-2 text-sm font-black ${
                                state === "pending" ? "text-red-700" : state === "completed" ? "text-emerald-700" : "text-brand"
                              }`}>
                                <Clock size={16} /> {formatTime(activity.scheduledActivityAt)}
                              </span>
                              <span className="mt-2 block font-black text-navy">
                                {activity.responsibleName} - {activity.clientName}
                              </span>
                              {activity.scheduledActivityNote ? (
                                <span className="mt-1 block line-clamp-2 text-sm font-semibold text-slate">{activity.scheduledActivityNote}</span>
                              ) : null}
                            </button>
                            <ActivityStateButton
                              activity={activity}
                              state={state}
                              loading={completeLoadingId === activity.id}
                              onOpenLateActions={() => setActiveLateActivityId(isLateOpen ? "" : activity.id)}
                            />
                          </div>

                          {state === "pending" && isLateOpen ? (
                            <div className="mt-4 grid gap-2 border-t border-red-100 pt-4 sm:grid-cols-2">
                              <button
                                type="button"
                                className="rounded-full border border-brand/20 bg-white px-4 py-3 text-sm font-black text-brand transition hover:bg-brand hover:text-white"
                                onClick={() => openReschedule(activity)}
                              >
                                Reagendar atividade
                              </button>
                              <button
                                type="button"
                                className="rounded-full border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 transition hover:bg-emerald-600 hover:text-white"
                                disabled={completeLoadingId === activity.id}
                                onClick={() => completeActivity(activity)}
                              >
                                Atividade concluída
                              </button>
                            </div>
                          ) : null}
                        </div>
                      );
                    })}
                  </div>
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
      {rescheduleActivity ? (
        <RescheduleActivityModal
          activity={rescheduleActivity}
          date={rescheduleDate}
          time={rescheduleTime}
          note={rescheduleNote}
          error={rescheduleError}
          loading={rescheduleLoading}
          onDateChange={setRescheduleDate}
          onTimeChange={setRescheduleTime}
          onNoteChange={setRescheduleNote}
          onClose={() => setRescheduleActivity(null)}
          onSubmit={submitReschedule}
        />
      ) : null}
    </section>
  );
}

function ActivityStateButton({ activity, state, loading, onOpenLateActions }) {
  if (state === "completed") {
    return (
      <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-emerald-200 bg-emerald-100 text-emerald-700" title="Atividade concluída">
        <CheckCircle2 size={22} />
      </span>
    );
  }

  if (state === "pending") {
    return (
      <button
        type="button"
        className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-red-200 bg-red-100 text-red-700 transition hover:border-red-300 hover:bg-red-600 hover:text-white"
        aria-label={`Abrir opções da atividade atrasada de ${activity.clientName}`}
        title="Atividade pendente"
        disabled={loading}
        onClick={onOpenLateActions}
      >
        <AlertTriangle size={22} />
      </button>
    );
  }

  return (
    <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-brand/20 bg-brand/10 text-brand" title="Atividade agendada">
      <CalendarClock size={22} />
    </span>
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
          <Detail icon={<CheckCircle2 size={18} />} label="Status" value={activity.scheduledActivityCompletedAt ? `Realizada em ${formatDateLabel(toSaoPauloDateKey(activity.scheduledActivityCompletedAt))} às ${formatTime(activity.scheduledActivityCompletedAt)}` : "Atividade agendada"} />
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

function RescheduleActivityModal({
  activity,
  date,
  time,
  note,
  error,
  loading,
  onDateChange,
  onTimeChange,
  onNoteChange,
  onClose,
  onSubmit
}) {
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
      <form className="w-full max-w-xl rounded-[28px] bg-white p-6 shadow-2xl md:p-8" onSubmit={onSubmit} onMouseDown={(event) => event.stopPropagation()}>
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="text-xs font-black uppercase tracking-[0.24em] text-brand">Reagendar atividade</p>
            <h3 className="mt-2 text-2xl font-black text-navy">{activity.clientName}</h3>
          </div>
          <button type="button" className="rounded-full border border-line p-3 text-navy transition hover:bg-mist" aria-label="Fechar reagendamento" onClick={onClose}>
            <X size={20} />
          </button>
        </div>

        {error ? (
          <p className="mt-5 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-800">{error}</p>
        ) : null}

        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <label className="font-black text-navy">
            Data
            <input
              type="date"
              className="mt-2 w-full rounded-2xl border border-line px-4 py-3 font-bold text-navy outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
              value={date}
              required
              onChange={(event) => onDateChange(event.target.value)}
            />
          </label>
          <label className="font-black text-navy">
            Horário
            <input
              type="time"
              className="mt-2 w-full rounded-2xl border border-line px-4 py-3 font-bold text-navy outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
              value={time}
              required
              onChange={(event) => onTimeChange(event.target.value)}
            />
          </label>
        </div>

        <label className="mt-4 block font-black text-navy">
          Descrição
          <textarea
            className="mt-2 min-h-28 w-full rounded-2xl border border-line px-4 py-3 font-bold text-navy outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
            value={note}
            maxLength={240}
            onChange={(event) => onNoteChange(event.target.value)}
          />
        </label>

        <div className="mt-6 flex flex-col gap-3 sm:flex-row">
          <button type="submit" className="premium-button-primary" disabled={loading}>
            {loading ? "Salvando..." : "Salvar reagendamento"}
          </button>
          <button type="button" className="premium-button-secondary" onClick={onClose}>Cancelar</button>
        </div>
      </form>
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

function getActivityState(activity) {
  if (activity?.scheduledActivityCompletedAt) return "completed";
  const scheduledAt = new Date(activity?.scheduledActivityAt || "");
  if (Number.isFinite(scheduledAt.getTime()) && scheduledAt.getTime() < Date.now()) return "pending";
  return "scheduled";
}

function formatInputTime(value) {
  const date = new Date(value || "");
  if (!Number.isFinite(date.getTime())) return "";
  return new Intl.DateTimeFormat("pt-BR", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
    timeZone: "America/Sao_Paulo"
  }).format(date);
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
