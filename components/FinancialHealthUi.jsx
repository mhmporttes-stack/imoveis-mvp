"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CircleAlert, CircleCheck, X } from "lucide-react";
import UiField, { inputClasses } from "@/components/ui/Field";
import { cx } from "@/components/ui/cx";

// Peças compartilhadas da aba Saúde (só interface). Datas em YYYY-MM-DD, valores em BRL pt-BR.

const NUMBER = new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 });
export function fmtNumber(value) {
  return NUMBER.format(Number(value || 0));
}

export function formatDate(iso) {
  if (!iso) return "—";
  const [y, m, d] = String(iso).split("-");
  return `${d}/${m}/${y}`;
}

export function formatShortDate(iso) {
  if (!iso) return "—";
  const [, m, d] = String(iso).split("-");
  return `${d}/${m}`;
}

export function round2(value) {
  return Math.round((Number(value || 0) + Number.EPSILON) * 100) / 100;
}

// Lê "1.234,56", "1234,56" ou "1234.56". Vazio/ilegível → NaN (o servidor revalida tudo).
export function parseMoney(text) {
  const raw = String(text ?? "").replace(/[^\d,.-]/g, "");
  if (!raw) return Number.NaN;
  const normalized = raw.includes(",") ? raw.replace(/\./g, "").replace(",", ".") : raw;
  const n = Number(normalized);
  return Number.isFinite(n) ? n : Number.NaN;
}

export function moneyToInput(value) {
  return String(round2(value)).replace(".", ",");
}

/* ---------- campos ---------- */

export function TextInput({ label, value, onChange, hint, error, required, className, type = "text", ...rest }) {
  return (
    <UiField label={label} hint={hint} error={error} required={required} className={className}>
      <input type={type} value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputClasses} {...rest} />
    </UiField>
  );
}

export function SelectInput({ label, value, onChange, options, hint, error, className }) {
  return (
    <UiField label={label} hint={hint} error={error} className={className}>
      <select value={value ?? ""} onChange={(e) => onChange(e.target.value)} className={inputClasses}>
        {options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
      </select>
    </UiField>
  );
}

/* ---------- selos Realizado / Previsto / Estimado ---------- */

const TAGS = {
  Realizado: "bg-navy/[0.08] text-navy",
  Recebido: "bg-navy/[0.08] text-navy",
  Previsto: "border border-brand/40 bg-white text-brand",
  Estimado: "border border-dashed border-faint bg-white text-ink-2"
};

export function Tag({ kind, className }) {
  return (
    <span className={cx("inline-flex shrink-0 items-center rounded-chip px-2 py-0.5 text-2xs font-semibold uppercase", TAGS[kind] || TAGS.Realizado, className)}>
      {kind}
    </span>
  );
}

/* ---------- aviso com ação (Desfazer) ---------- */
// O Toast base não tem botão de ação; este segue o mesmo visual e some em 8 s quando traz ação.

export function useHealthToast() {
  const [toast, setToast] = useState(null);
  const timer = useRef(null);
  const close = useCallback(() => setToast(null), []);
  const notify = useCallback((message, tone = "success", action = null) => {
    clearTimeout(timer.current);
    setToast({ message, tone, action, id: Date.now() });
    if (tone !== "danger") timer.current = setTimeout(() => setToast(null), action ? 8000 : 3500);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [notify, <HealthToast key="health-toast" toast={toast} onClose={close} />];
}

function HealthToast({ toast, onClose }) {
  const danger = toast?.tone === "danger";
  const Icon = danger ? CircleAlert : CircleCheck;
  return (
    <div
      aria-live={danger ? "assertive" : "polite"}
      role={danger ? "alert" : "status"}
      className="pointer-events-none fixed inset-x-0 z-[60] flex justify-center px-4 bottom-[calc(1rem+max(env(safe-area-inset-bottom),var(--admin-bottom-nav-space,0px)))]"
    >
      {toast ? (
        <div
          key={toast.id}
          className={cx(
            "ui-toast pointer-events-auto flex w-full max-w-md items-start gap-2.5 rounded-control px-4 py-3 text-sm shadow-float",
            danger ? "bg-danger-soft text-danger ring-1 ring-danger-line" : "bg-navy text-white"
          )}
        >
          <Icon className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <p className="min-w-0 flex-1 font-medium">{toast.message}</p>
          {toast.action ? (
            <button
              type="button"
              onClick={() => { const act = toast.action.onClick; onClose(); act(); }}
              className="-my-1 min-h-9 shrink-0 rounded-chip px-2.5 text-sm font-bold underline underline-offset-2 hover:bg-white/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current"
            >
              {toast.action.label}
            </button>
          ) : null}
          <button type="button" onClick={onClose} aria-label="Fechar aviso" className="-m-1 inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-chip opacity-80 hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-current">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ) : null}
    </div>
  );
}
