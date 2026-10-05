"use client";

import { useEffect, useRef, useState } from "react";
import { CalendarDays, ChevronLeft, ChevronRight } from "lucide-react";
import { getMaximumBirthDateForMinimumAge } from "@/lib/simulation-registration-format";

// Data de nascimento. O <input type="date"> nativo sempre abre no mês ATUAL (e não dá para mudar isso), então o
// calendário é próprio: abre em JANEIRO/2000 quando o campo está vazio (ou no mês da data já escolhida). Nada é
// preenchido sozinho — o valor continua sendo a string "AAAA-MM-DD" que o formulário já usava, só definida quando o
// cliente clica num dia. Mesma regra de idade mínima (max) de antes.
const INITIAL_VIEW = { year: 2000, month: 0 };
const MIN_YEAR = 1920;
const MONTHS = ["janeiro", "fevereiro", "março", "abril", "maio", "junho", "julho", "agosto", "setembro", "outubro", "novembro", "dezembro"];
const WEEKDAYS = ["D", "S", "T", "Q", "Q", "S", "S"];

function parseIso(value) {
  const match = String(value || "").match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return match ? { year: Number(match[1]), month: Number(match[2]) - 1, day: Number(match[3]) } : null;
}

function toIso(year, month, day) {
  return `${String(year).padStart(4, "0")}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function formatBr(value) {
  const parsed = parseIso(value);
  return parsed ? `${String(parsed.day).padStart(2, "0")}/${String(parsed.month + 1).padStart(2, "0")}/${parsed.year}` : "";
}

export default function DateInputStep({ error, onChange, step, value }) {
  const inputId = `simulation-${step.id}`;
  const maximumBirthDate = getMaximumBirthDateForMinimumAge();
  const max = parseIso(maximumBirthDate);
  const selected = parseIso(value);
  const [open, setOpen] = useState(false);
  const [view, setView] = useState(() => clampView(selected ? { year: selected.year, month: selected.month } : INITIAL_VIEW, max));
  const rootRef = useRef(null);

  useEffect(() => {
    if (!open) return undefined;
    const onPointerDown = (event) => {
      if (rootRef.current && !rootRef.current.contains(event.target)) setOpen(false);
    };
    const onKeyDown = (event) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  function toggle() {
    if (!open) setView(clampView(selected ? { year: selected.year, month: selected.month } : INITIAL_VIEW, max));
    setOpen((current) => !current);
  }

  function shiftMonth(delta) {
    setView((current) => {
      const index = current.year * 12 + current.month + delta;
      return clampView({ year: Math.floor(index / 12), month: ((index % 12) + 12) % 12 }, max);
    });
  }

  const maxYear = max?.year || new Date().getFullYear();
  const years = [];
  for (let year = maxYear; year >= MIN_YEAR; year -= 1) years.push(year);
  const firstWeekday = new Date(view.year, view.month, 1).getDay();
  const daysInMonth = new Date(view.year, view.month + 1, 0).getDate();
  const cells = [...Array(firstWeekday).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  const isAfterMax = (day) => Boolean(max) && toIso(view.year, view.month, day) > maximumBirthDate;
  const selectClass = "h-9 rounded-full border border-line bg-white px-3 text-sm font-bold capitalize text-ink outline-none focus:border-brand focus:ring-2 focus:ring-brand/20";
  const arrowClass = "grid h-9 w-9 shrink-0 place-items-center rounded-full border border-line bg-white text-ink transition hover:border-brand hover:text-brand disabled:opacity-30";

  return (
    <div className="relative" ref={rootRef}>
      <label className="sr-only" htmlFor={inputId}>{step.title}</label>
      <button
        aria-expanded={open}
        aria-haspopup="dialog"
        className="admin-input flex h-16 items-center justify-between rounded-2xl text-left text-lg shadow-[0_10px_28px_rgba(13,59,102,0.04)] focus:border-brand focus:ring-4 focus:ring-brand/10"
        id={inputId}
        onClick={toggle}
        type="button"
      >
        <span className={value ? "" : "font-semibold text-muted"}>{formatBr(value) || "dd/mm/aaaa"}</span>
        <CalendarDays aria-hidden="true" className="h-5 w-5 text-muted" />
      </button>
      {open ? (
        <div aria-label="Escolha a data de nascimento" className="mx-auto mt-3 w-full max-w-sm rounded-2xl border border-line bg-slate-50 p-3" role="dialog">
          <div className="flex items-center gap-2">
            <button aria-label="Mês anterior" className={arrowClass} onClick={() => shiftMonth(-1)} type="button">
              <ChevronLeft aria-hidden="true" className="h-4 w-4" />
            </button>
            <select aria-label="Mês" className={`${selectClass} min-w-0 flex-1`} onChange={(event) => setView((current) => clampView({ ...current, month: Number(event.target.value) }, max))} value={view.month}>
              {MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}
            </select>
            <select aria-label="Ano" className={selectClass} onChange={(event) => setView((current) => clampView({ ...current, year: Number(event.target.value) }, max))} value={view.year}>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
            <button aria-label="Próximo mês" className={arrowClass} disabled={Boolean(max) && view.year * 12 + view.month >= max.year * 12 + max.month} onClick={() => shiftMonth(1)} type="button">
              <ChevronRight aria-hidden="true" className="h-4 w-4" />
            </button>
          </div>
          <div className="mt-2 grid grid-cols-7 text-center text-[11px] font-black uppercase text-muted">
            {WEEKDAYS.map((label, index) => <span key={`${label}-${index}`}>{label}</span>)}
          </div>
          <div className="grid grid-cols-7 gap-y-0.5">
            {cells.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} />;
              const isSelected = selected && selected.year === view.year && selected.month === view.month && selected.day === day;
              const disabled = isAfterMax(day);
              return (
                <button
                  className={`mx-auto grid h-9 w-9 place-items-center rounded-full text-sm font-bold transition ${isSelected ? "bg-brand text-white" : "text-ink hover:bg-blue-100"} disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent`}
                  disabled={disabled}
                  key={day}
                  onClick={() => {
                    onChange(toIso(view.year, view.month, day));
                    setOpen(false);
                  }}
                  type="button"
                >
                  {day}
                </button>
              );
            })}
          </div>
        </div>
      ) : null}
      {error ? <p className="mt-3 text-sm font-bold text-red-700">{error}</p> : null}
    </div>
  );
}

// Nunca mostra um mês posterior ao da data máxima (idade mínima) nem anterior ao ano mínimo da lista.
function clampView(view, max) {
  const { year, month } = view;
  if (year < MIN_YEAR) return { year: MIN_YEAR, month: 0 };
  if (max && (year > max.year || (year === max.year && month > max.month))) return { year: max.year, month: max.month };
  return { year, month };
}
