"use client";

import { useState } from "react";
import { AlertTriangle, ChevronDown, SlidersHorizontal } from "lucide-react";
import Badge from "@/components/ui/Badge";
import Button from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";

// Peças de interface da área Vendas / Comissões do Financeiro (só layout; nenhuma regra ou conta aqui —
// os números chegam prontos de AdminFinancialDashboard). Reutiliza os componentes de components/ui.

/* ---------- abas (padrão único do sistema visual: sublinhado, sem caixa alta nem azul cheio) ---------- */

export function SectionTabs({ tabs, active, onChange, label = "Seções do Financeiro" }) {
  return (
    <div role="tablist" aria-label={label} className="-mx-4 flex gap-1 overflow-x-auto border-b border-line px-4 sm:mx-0 sm:px-0">
      {tabs.map((tab) => {
        const Icon = tab.icon;
        const selected = active === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(tab.key)}
            className={cx(
              "-mb-px inline-flex min-h-touch shrink-0 items-center gap-2 border-b-2 px-3.5 text-sm font-semibold transition-colors duration-150 ease-out-ui",
              "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2",
              selected ? "border-brand text-navy" : "border-transparent text-muted hover:text-navy"
            )}
          >
            {Icon ? <Icon className="h-4 w-4" aria-hidden="true" /> : null}
            {tab.label}
          </button>
        );
      })}
    </div>
  );
}

/* ---------- 3 números grandes ---------- */

export function HeroNumbers({ received, receivable, overdue, overdueActive, monthLabel, onSeeOverdue }) {
  return (
    <section aria-label="Resumo de comissões" className="rounded-card border border-line bg-white">
      <dl className="grid grid-cols-2 sm:grid-cols-3 sm:divide-x sm:divide-line">
        <div className="col-span-2 min-w-0 border-b border-line p-4 sm:col-span-1 sm:border-b-0 sm:p-5">
          <dt className="text-sm font-medium text-ink-2">Recebido no mês</dt>
          <dd className="mt-1 truncate text-[32px] font-bold leading-10 tracking-[-0.02em] tabular-nums text-navy sm:text-[36px] sm:leading-[44px]">{received}</dd>
          <p className="mt-1 text-xs text-muted">Pagamentos confirmados em {monthLabel}</p>
        </div>
        <div className="min-w-0 border-r border-line p-4 sm:border-r-0 sm:p-5">
          <dt className="text-sm font-medium text-ink-2">A receber</dt>
          <dd className="mt-1 whitespace-nowrap text-xl font-bold leading-8 tracking-[-0.02em] tabular-nums text-navy sm:text-[36px] sm:leading-[44px]">{receivable}</dd>
          <p className="mt-1 text-xs text-muted">Previsto para {monthLabel}</p>
        </div>
        <div className={cx("min-w-0 p-4 sm:p-5", overdueActive && "bg-danger-soft/50")}>
          <dt className={cx("flex items-center gap-1.5 text-sm font-medium", overdueActive ? "text-danger" : "text-ink-2")}>
            {overdueActive ? <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" /> : null}
            Comissões em atraso
          </dt>
          <dd className={cx("mt-1 whitespace-nowrap text-xl font-bold leading-8 tracking-[-0.02em] tabular-nums sm:text-[36px] sm:leading-[44px]", overdueActive ? "text-danger" : "text-navy")}>{overdue}</dd>
          {overdueActive && onSeeOverdue ? (
            <button type="button" onClick={onSeeOverdue} className="-ml-2 mt-0.5 inline-flex min-h-touch items-center rounded-control px-2 text-sm font-semibold text-danger underline underline-offset-2 hover:bg-danger-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-danger">
              Ver quais
            </button>
          ) : (
            <p className="mt-1 text-xs text-muted">{overdueActive ? "De meses anteriores" : "Nada atrasado"}</p>
          )}
        </div>
      </dl>
    </section>
  );
}

/* ---------- bloco recolhível ---------- */

export function Collapsible({ title, summary, defaultOpen = false, className, children, tone = "plain" }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <details
      open={open}
      onToggle={(event) => setOpen(event.currentTarget.open)}
      className={cx("group rounded-card border border-line bg-white", className)}
    >
      <summary className="flex min-h-touch cursor-pointer list-none items-center gap-3 rounded-card px-4 py-2.5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand [&::-webkit-details-marker]:hidden">
        <span className="min-w-0 flex-1">
          <span className={cx("block text-base font-semibold", tone === "muted" ? "text-ink-2" : "text-navy")}>{title}</span>
          {summary ? <span className="block truncate text-xs tabular-nums text-muted">{summary}</span> : null}
        </span>
        <ChevronDown className="h-5 w-5 shrink-0 text-muted transition-transform duration-150 ease-out-ui group-open:rotate-180 motion-reduce:transition-none" aria-hidden="true" />
      </summary>
      <div className="border-t border-line p-4">{children}</div>
    </details>
  );
}

/* ---------- filtros: Período e Status à vista, o resto em "Mais filtros" ---------- */

export function FilterBar({ primary, extra, extraCount = 0, onClear, hint }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="rounded-card border border-line bg-white p-3 sm:p-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-[repeat(2,minmax(0,220px))_auto_1fr] sm:items-end">
        {primary}
        <Button
          variant="secondary"
          aria-expanded={open}
          aria-controls="financeiro-mais-filtros"
          onClick={() => setOpen((value) => !value)}
          className="col-span-2 sm:col-span-1"
        >
          <SlidersHorizontal className="h-4 w-4" aria-hidden="true" />
          Mais filtros
          {extraCount > 0 ? <span className="inline-flex h-5 min-w-5 items-center justify-center rounded-full bg-brand px-1.5 text-2xs font-semibold tabular-nums text-white">{extraCount}</span> : null}
          <ChevronDown className={cx("h-4 w-4 transition-transform duration-150 ease-out-ui motion-reduce:transition-none", open && "rotate-180")} aria-hidden="true" />
        </Button>
        <div className="col-span-2 sm:col-span-1 sm:justify-self-end">
          <Button variant="ghost" onClick={onClear}>Limpar filtros</Button>
        </div>
      </div>
      {open ? (
        <div id="financeiro-mais-filtros" className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-3">
          {extra}
        </div>
      ) : null}
      {hint ? <p className="mt-3 text-xs text-muted">{hint}</p> : null}
    </div>
  );
}

/* ---------- selos de status ---------- */

const FINANCIAL_TONE = { pending: "warning", partial: "info", received: "success", cancelled: "neutral" };
const PAYMENT_TONE = { expected: "info", received: "success", overdue: "danger", cancelled: "neutral" };

export function FinancialStatusBadge({ value, label, overdue = false }) {
  if (overdue) return <Badge tone="danger" icon={AlertTriangle}>Atrasado</Badge>;
  return <Badge tone={FINANCIAL_TONE[value] || "neutral"} dot>{label}</Badge>;
}

export function PaymentStatusBadge({ value, label }) {
  const overdue = value === "overdue";
  return <Badge tone={PAYMENT_TONE[value] || "neutral"} dot={!overdue} icon={overdue ? AlertTriangle : null}>{label}</Badge>;
}

/* ---------- campos do editor: linha de resumo fixa no rodapé ---------- */

export function EditorFooter({ metrics, onSave, saving }) {
  return (
    <div className="sticky bottom-[var(--admin-bottom-nav-space,0px)] z-20 -mx-px border-t border-line bg-white/95 px-4 py-3 shadow-float backdrop-blur supports-[backdrop-filter]:bg-white/90 sm:rounded-b-card">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <dl className="grid grid-cols-3 gap-3 sm:flex sm:gap-6" aria-label="Resumo da venda">
          {metrics.map((metric) => (
            <div key={metric.label} className="min-w-0">
              <dt className="text-xs text-muted">{metric.label}</dt>
              <dd className="truncate text-sm font-semibold tabular-nums text-navy sm:text-base">{metric.value}</dd>
            </div>
          ))}
        </dl>
        <Button onClick={onSave} loading={saving} disabled={saving} className="w-full sm:w-auto sm:min-w-44">
          {saving ? "Salvando..." : "Salvar financeiro"}
        </Button>
      </div>
    </div>
  );
}
