"use client";

import { useEffect, useRef, useState } from "react";
import { FichaError, FichaIcon } from "@/components/simulation-form/FichaFields";
import styles from "@/components/simulation-form/SimulationForm.module.css";
import { getMaximumBirthDateForMinimumAge } from "@/lib/simulation-registration-format";

// Data de nascimento. O <input type="date"> nativo sempre abre no mês ATUAL (e não dá para mudar isso), então o
// calendário é próprio: abre em JANEIRO/2000 quando o campo está vazio (ou no mês da data já escolhida). Nada é
// preenchido sozinho — o valor continua sendo a string "AAAA-MM-DD" que o formulário já usava, só definida quando o
// cliente clica num dia. Mesma regra de idade mínima (max) de antes. Visual da ficha escura desde 2026-10-24.
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

export default function DateInputStep({ error, errorId, hint, label, onChange, step, value }) {
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

  return (
    <div className={error ? styles.invalid : undefined} ref={rootRef}>
      <label className={label ? styles.label : "sr-only"} htmlFor={inputId}>{label || step.title}</label>
      <button
        aria-describedby={[hint ? `${inputId}-hint` : "", error ? errorId : ""].filter(Boolean).join(" ") || undefined}
        aria-expanded={open}
        aria-haspopup="dialog"
        aria-invalid={error ? "true" : undefined}
        className={`${styles.field} ${styles.fieldButton}`}
        id={inputId}
        onClick={toggle}
        type="button"
      >
        <span className={value ? "" : styles.placeholder}>{formatBr(value) || "dd/mm/aaaa"}</span>
        {FichaIcon.calendar}
      </button>
      {hint && !open && !error ? <p className={styles.hint} id={`${inputId}-hint`}>{hint}</p> : null}
      {open ? (
        <div aria-label="Escolha a data de nascimento" className={styles.cal} role="dialog">
          <div className={styles.calHead}>
            <button aria-label="Mês anterior" className={styles.calArrow} onClick={() => shiftMonth(-1)} type="button">
              {FichaIcon.chevLeft}
            </button>
            <select aria-label="Mês" onChange={(event) => setView((current) => clampView({ ...current, month: Number(event.target.value) }, max))} value={view.month}>
              {MONTHS.map((name, index) => <option key={name} value={index}>{name}</option>)}
            </select>
            <select aria-label="Ano" onChange={(event) => setView((current) => clampView({ ...current, year: Number(event.target.value) }, max))} value={view.year}>
              {years.map((year) => <option key={year} value={year}>{year}</option>)}
            </select>
            <button aria-label="Próximo mês" className={styles.calArrow} disabled={Boolean(max) && view.year * 12 + view.month >= max.year * 12 + max.month} onClick={() => shiftMonth(1)} type="button">
              {FichaIcon.chevRight}
            </button>
          </div>
          <div aria-hidden="true" className={styles.calWeek}>
            {WEEKDAYS.map((weekday, index) => <span key={`${weekday}-${index}`}>{weekday}</span>)}
          </div>
          <div className={styles.calDays}>
            {cells.map((day, index) => {
              if (!day) return <span key={`empty-${index}`} />;
              const isSelected = Boolean(selected && selected.year === view.year && selected.month === view.month && selected.day === day);
              const disabled = isAfterMax(day);
              return (
                <button
                  aria-label={`${day} de ${MONTHS[view.month]} de ${view.year}`}
                  aria-pressed={isSelected}
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
      <FichaError id={errorId} message={error} />
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
