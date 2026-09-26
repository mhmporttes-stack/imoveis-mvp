"use client";

import { useCallback, useEffect, useState } from "react";
import { Eye, Info, LoaderCircle, Save } from "lucide-react";

const PERIODS = [
  { value: 0, label: "Tudo" },
  { value: 7, label: "7 dias" },
  { value: 30, label: "30 dias" },
  { value: 90, label: "90 dias" }
];

const CATEGORY_TONE = {
  marketing: "bg-blue-50 text-brand",
  utility: "bg-emerald-50 text-emerald-700",
  authentication: "bg-amber-50 text-amber-800",
  service: "bg-slate-100 text-slate-600"
};

const RATE_FIELDS = [
  { key: "marketing", label: "Marketing" },
  { key: "utility", label: "Utilidade" },
  { key: "authentication", label: "Autenticação" }
];

export function brl(value, maxDigits = 2) {
  return Number(value || 0).toLocaleString("pt-BR", { style: "currency", currency: "BRL", minimumFractionDigits: 2, maximumFractionDigits: maxDigits });
}

function pct(value) {
  const number = Number(value || 0) * 100;
  return `${number >= 10 || number === 0 ? Math.round(number) : number.toFixed(1).replace(".", ",")}%`;
}

function formatDate(value) {
  if (!value) return "—";
  return new Date(value).toLocaleDateString("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", timeZone: "America/Sao_Paulo" });
}

// `enabled`: só consulta quando uma das abas (Gastos/Desempenho) está aberta — e atualiza a cada abertura.
export function useFinanceReport(enabled = true) {
  const [days, setDays] = useState(0);
  const [report, setReport] = useState(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-broadcasts/finance?days=${days}`, { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os dados do Disparo.");
      setReport(data);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }, [days]);

  useEffect(() => {
    if (enabled) load();
  }, [enabled, load]);

  return { days, setDays, report, error, loading, reload: load };
}

function PeriodFilter({ days, onChange }) {
  return (
    <div className="flex flex-wrap gap-1.5">
      {PERIODS.map((period) => (
        <button key={period.value} type="button" onClick={() => onChange(period.value)} className={`rounded-full border px-3.5 py-1.5 text-xs font-extrabold transition ${days === period.value ? "border-navy bg-navy text-white" : "border-line text-navy hover:border-brand"}`}>
          {period.label}
        </button>
      ))}
    </div>
  );
}

function StatCard({ label, value, hint, tone = "text-navy" }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <p className="text-[11px] font-black uppercase tracking-[0.12em] text-muted">{label}</p>
      <p className={`mt-1 text-2xl font-black ${tone}`}>{value}</p>
      {hint ? <p className="mt-0.5 text-xs font-bold text-muted">{hint}</p> : null}
    </div>
  );
}

function CategoryBadge({ item }) {
  return <span className={`inline-flex rounded-full px-2.5 py-0.5 text-[11px] font-extrabold ${CATEGORY_TONE[item.category] || CATEGORY_TONE.service}`}>{item.categoryLabel}</span>;
}

function LoadingOrError({ loading, error, report }) {
  if (error) return <p className="rounded-2xl border border-red-100 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p>;
  if (loading && !report) return <p className="flex items-center gap-2 text-sm font-bold text-muted"><LoaderCircle className="h-4 w-4 animate-spin" /> Carregando…</p>;
  return null;
}

/* --------------------------------- Gastos --------------------------------- */

export function CostsSection({ finance }) {
  const { days, setDays, report, error, loading, reload } = finance;
  const items = report?.items || [];
  const summary = report?.summary;

  return (
    <div className="space-y-5">
      <PeriodFilter days={days} onChange={setDays} />
      <LoadingOrError loading={loading} error={error} report={report} />

      {report ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Gasto total" value={brl(summary.totalCost)} hint={`${summary.billable} mensagens cobradas`} tone="text-brand" />
            <StatCard label="Mensagens enviadas" value={summary.sent.toLocaleString("pt-BR")} hint={`${summary.delivered.toLocaleString("pt-BR")} entregues`} />
            <StatCard label="Custo por envio" value={brl(summary.costPerSent, 4)} hint="gasto total ÷ enviadas" />
            <StatCard label="Campanhas" value={summary.campaigns} hint={days ? `últimos ${days} dias` : "todo o período"} />
          </div>

          {items.length ? (
            <>
              <div className="hidden overflow-x-auto rounded-2xl border border-line md:block">
                <table className="w-full min-w-[720px] text-left text-sm">
                  <thead className="bg-mist/60 text-[11px] font-black uppercase tracking-[0.1em] text-muted">
                    <tr>
                      <th className="px-4 py-3">Campanha</th>
                      <th className="px-3 py-3">Tipo de disparo</th>
                      <th className="px-3 py-3 text-right">Enviadas</th>
                      <th className="px-3 py-3 text-right">Custo por envio</th>
                      <th className="px-4 py-3 text-right">Custo total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {items.map((item) => (
                      <tr key={item.id}>
                        <td className="px-4 py-3">
                          <p className="font-black text-navy">{item.campaignName}</p>
                          <p className="text-xs font-bold text-muted">{item.templateName} · {formatDate(item.createdAt)}</p>
                        </td>
                        <td className="px-3 py-3"><CategoryBadge item={item} /></td>
                        <td className="px-3 py-3 text-right font-extrabold text-navy">{item.sent.toLocaleString("pt-BR")}</td>
                        <td className="px-3 py-3 text-right font-bold text-slate-600">{brl(item.costPerSent, 4)}</td>
                        <td className="px-4 py-3 text-right font-black text-navy">{brl(item.totalCost)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="space-y-2.5 md:hidden">
                {items.map((item) => (
                  <div key={item.id} className="rounded-2xl border border-line bg-white p-4">
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-black text-navy">{item.campaignName}</p>
                        <p className="text-xs font-bold text-muted">{item.templateName} · {formatDate(item.createdAt)}</p>
                      </div>
                      <CategoryBadge item={item} />
                    </div>
                    <div className="mt-3 grid grid-cols-3 gap-2 text-center">
                      <div><p className="text-[10px] font-black uppercase text-muted">Enviadas</p><p className="font-black text-navy">{item.sent.toLocaleString("pt-BR")}</p></div>
                      <div><p className="text-[10px] font-black uppercase text-muted">Por envio</p><p className="font-black text-navy">{brl(item.costPerSent, 4)}</p></div>
                      <div><p className="text-[10px] font-black uppercase text-muted">Total</p><p className="font-black text-brand">{brl(item.totalCost)}</p></div>
                    </div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm font-bold text-muted">Nenhum disparo neste período.</p>
          )}

          <PricingEditor pricing={report.pricing} canEdit={report.canEditPricing} onSaved={reload} />
        </>
      ) : null}
    </div>
  );
}

function PricingEditor({ pricing, canEdit, onSaved }) {
  const [values, setValues] = useState({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    setValues(Object.fromEntries(RATE_FIELDS.map((field) => [field.key, String(pricing.rates[field.key]).replace(".", ",")])));
  }, [pricing]);

  async function save() {
    setSaving(true);
    setMessage("");
    try {
      const response = await fetch("/api/admin/whatsapp-broadcasts/finance", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rates: values })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      setMessage("Preços salvos.");
      onSaved();
    } catch (saveError) {
      setMessage(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="rounded-2xl border border-line bg-mist/40 p-4">
      <p className="flex items-center gap-2 text-sm font-black text-navy"><Info className="h-4 w-4 text-brand" /> Preço por mensagem (R$)</p>
      <p className="mt-1 text-xs font-bold leading-5 text-muted">
        {pricing.estimated ? "Valores ESTIMADOS (faixas públicas da Meta no Brasil) — ajuste para o valor da sua fatura. " : ""}
        O custo é: mensagens <b>entregues e cobradas pela Meta</b> × o preço da categoria do modelo.
      </p>
      <div className="mt-3 flex flex-wrap items-end gap-3">
        {RATE_FIELDS.map((field) => (
          <label key={field.key} className="text-xs font-extrabold text-navy">
            {field.label}
            <input
              value={values[field.key] ?? ""}
              onChange={(event) => setValues((current) => ({ ...current, [field.key]: event.target.value }))}
              disabled={!canEdit}
              inputMode="decimal"
              className="mt-1 block h-10 w-28 rounded-xl border border-line bg-white px-3 text-sm font-bold text-navy outline-none focus:border-brand disabled:bg-mist disabled:text-muted"
            />
          </label>
        ))}
        {canEdit ? (
          <button type="button" onClick={save} disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-full bg-navy px-5 text-sm font-extrabold text-white disabled:opacity-60">
            {saving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />} Salvar preços
          </button>
        ) : <p className="text-xs font-bold text-muted">Só o administrador geral edita os preços.</p>}
      </div>
      {message ? <p className="mt-2 text-xs font-bold text-brand">{message}</p> : null}
    </div>
  );
}

/* ------------------------------- Desempenho -------------------------------- */

function FunnelBar({ label, value, base, tone }) {
  const width = base > 0 ? Math.max(Math.min((value / base) * 100, 100), value > 0 ? 3 : 0) : 0;
  return (
    <div>
      <div className="flex items-baseline justify-between text-xs font-extrabold text-navy">
        <span>{label}</span>
        <span>{value.toLocaleString("pt-BR")}{base > 0 ? <span className="ml-1 font-bold text-muted">({pct(value / base)})</span> : null}</span>
      </div>
      <div className="mt-1 h-2 overflow-hidden rounded-full bg-mist">
        <div className={`h-full rounded-full ${tone}`} style={{ width: `${width}%` }} />
      </div>
    </div>
  );
}

function PerformanceCard({ row, subtitle }) {
  return (
    <div className="rounded-2xl border border-line bg-white p-4">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate font-black text-navy">{row.campaignName || row.templateName}</p>
          {subtitle ? <p className="text-xs font-bold text-muted">{subtitle}</p> : null}
        </div>
        <CategoryBadge item={row} />
      </div>

      <div className="mt-3 space-y-2">
        <FunnelBar label="Enviadas" value={row.sent} base={row.sent} tone="bg-slate-400" />
        <FunnelBar label="Entregues" value={row.delivered} base={row.sent} tone="bg-blue-400" />
        <FunnelBar label="Lidas" value={row.read} base={row.sent} tone="bg-blue-600" />
        <FunnelBar label="Responderam (conversas)" value={row.replied} base={row.sent} tone="bg-emerald-500" />
        <FunnelBar label="Cadastros pelo link" value={row.registrations} base={row.sent} tone="bg-amber-500" />
      </div>

      <div className="mt-4 grid grid-cols-3 gap-2 rounded-xl bg-mist/60 p-3 text-center">
        <div><p className="text-[10px] font-black uppercase text-muted">Custo total</p><p className="font-black text-navy">{brl(row.totalCost)}</p></div>
        <div><p className="text-[10px] font-black uppercase text-muted">Por conversa</p><p className="font-black text-emerald-700">{row.costPerReply === null ? "—" : brl(row.costPerReply)}</p></div>
        <div><p className="text-[10px] font-black uppercase text-muted">Por cadastro</p><p className="font-black text-amber-700">{row.costPerRegistration === null ? "—" : brl(row.costPerRegistration)}</p></div>
      </div>
      {row.linkViews ? <p className="mt-2 flex items-center gap-1.5 text-[11px] font-bold text-muted"><Eye className="h-3.5 w-3.5" /> {row.linkViews} abertura(s) do link da campanha</p> : null}
    </div>
  );
}

export function PerformanceSection({ finance }) {
  const { days, setDays, report, error, loading } = finance;
  const [view, setView] = useState("campaign");
  const summary = report?.summary;
  const rows = view === "campaign" ? report?.items || [] : report?.templates || [];

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PeriodFilter days={days} onChange={setDays} />
        <div className="flex gap-1 rounded-xl border border-navy/[0.07] bg-mist/60 p-1">
          {[{ key: "campaign", label: "Por campanha" }, { key: "template", label: "Por mensagem" }].map((option) => (
            <button key={option.key} type="button" onClick={() => setView(option.key)} className={`rounded-[10px] px-3.5 py-1.5 text-xs font-black transition ${view === option.key ? "bg-navy text-white" : "text-navy hover:bg-white"}`}>{option.label}</button>
          ))}
        </div>
      </div>
      <LoadingOrError loading={loading} error={error} report={report} />

      {report ? (
        <>
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatCard label="Enviadas" value={summary.sent.toLocaleString("pt-BR")} hint={`${pct(summary.deliveredRate)} entregues · ${pct(summary.readRate)} lidas`} />
            <StatCard label="Responderam" value={summary.replied.toLocaleString("pt-BR")} hint={`${pct(summary.replyRate)} das enviadas`} tone="text-emerald-700" />
            <StatCard label="Cadastros pelo link" value={summary.registrations.toLocaleString("pt-BR")} hint={summary.costPerRegistration === null ? "sem cadastros ainda" : `${brl(summary.costPerRegistration)} por cadastro`} tone="text-amber-700" />
            <StatCard label="Custo por conversa" value={summary.costPerReply === null ? "—" : brl(summary.costPerReply)} hint={`gasto ${brl(summary.totalCost)} ÷ ${summary.replied} resposta(s)`} tone="text-brand" />
          </div>

          <p className="flex items-start gap-2 text-xs font-bold leading-5 text-muted">
            <Info className="mt-0.5 h-3.5 w-3.5 shrink-0" />
            Conversa = cliente que respondeu ao disparo em até 7 dias. Custo por conversa = custo total da campanha ÷ quem respondeu (ex.: R$ 60 gastos e 1 resposta = R$ 60 por conversa).
          </p>

          {rows.length ? (
            <div className="grid gap-3 lg:grid-cols-2">
              {rows.map((row) => (
                <PerformanceCard
                  key={row.id || row.templateName}
                  row={row}
                  subtitle={view === "campaign" ? `${row.templateName} · ${formatDate(row.createdAt)}` : `${row.campaigns} campanha(s) com este modelo`}
                />
              ))}
            </div>
          ) : (
            <p className="rounded-2xl border border-dashed border-line p-6 text-center text-sm font-bold text-muted">Nenhum disparo neste período.</p>
          )}
        </>
      ) : null}
    </div>
  );
}
