"use client";

import Link from "next/link";
import { useEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, Check, Copy, MousePointerClick, Pencil, Percent, Plus, Save, Trash2, UserRound, Users, X, Zap, ZapOff } from "lucide-react";

const EMPTY_FORM = {
  name: "",
  destinationType: "roulette",
  brokerId: ""
};

const STATUS_LABELS = {
  active: "Ativa",
  inactive: "Inativa"
};

const TYPE_FILTERS = [
  { value: "all", label: "Todos" },
  { value: "official", label: "Oficiais" },
  { value: "custom", label: "Personalizados" }
];

const PERIODS = [
  { value: "", label: "Todo período" },
  { value: "today", label: "Hoje" },
  { value: "last7", label: "7 dias" },
  { value: "last30", label: "30 dias" },
  { value: "month", label: "Este mês" },
  { value: "custom", label: "Personalizado" }
];

export default function CampaignsManager({ initialCampaigns = [], initialSummary = {}, brokers = [] }) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [summary, setSummary] = useState(initialSummary);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState(null);
  const [copiedId, setCopiedId] = useState("");

  const [type, setType] = useState("all");
  const [search, setSearch] = useState("");
  const [period, setPeriod] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [loading, setLoading] = useState(false);
  const isFirstLoad = useRef(true);

  useEffect(() => {
    if (isFirstLoad.current) {
      isFirstLoad.current = false;
      return;
    }
    const timeoutId = setTimeout(loadCampaigns, search ? 350 : 0);
    return () => clearTimeout(timeoutId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, search, period, startDate, endDate]);

  async function loadCampaigns() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ type, search });
      if (period) {
        params.set("period", period);
        if (period === "custom") {
          if (startDate) params.set("startDate", startDate);
          if (endDate) params.set("endDate", endDate);
        }
      }
      const response = await fetch(`/api/campaigns?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível carregar os links.");
      setCampaigns(payload.campaigns || []);
      setSummary(payload.summary || {});
    } catch (loadError) {
      setError(loadError.message || "Não foi possível carregar os links.");
    } finally {
      setLoading(false);
    }
  }

  const sortedCampaigns = useMemo(
    () => [...campaigns].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt)),
    [campaigns]
  );

  function beginEdit(campaign) {
    setEditingId(campaign.id);
    setEditForm({ name: campaign.name, destinationType: campaign.destinationType, brokerId: campaign.brokerId || "" });
    setError("");
    setMessage("");
  }

  async function createCampaign(event) {
    event.preventDefault();
    setError("");
    setMessage("");
    setIsSaving(true);

    try {
      const response = await fetch("/api/campaigns", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível gerar o link.");

      setCampaigns((current) => [payload.campaign, ...current]);
      setForm(EMPTY_FORM);
      setMessage("Link gerado com sucesso.");
    } catch (createError) {
      setError(createError.message || "Não foi possível gerar o link.");
    } finally {
      setIsSaving(false);
    }
  }

  async function saveCampaign(event) {
    event.preventDefault();
    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/campaigns/${editingId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(editForm)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar a campanha.");
      setCampaigns((current) => current.map((item) => (item.id === editingId ? { ...item, ...payload.campaign } : item)));
      setEditingId("");
      setEditForm(null);
      setMessage("Campanha atualizada com sucesso.");
    } catch (saveError) {
      setError(saveError.message || "Não foi possível atualizar a campanha.");
    } finally {
      setIsSaving(false);
    }
  }

  async function toggleStatus(campaign) {
    setError("");
    setMessage("");
    const nextStatus = campaign.status === "active" ? "inactive" : "active";

    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ status: nextStatus })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível atualizar a campanha.");
      setCampaigns((current) => current.map((item) => (item.id === campaign.id ? { ...item, ...payload.campaign } : item)));
      setMessage(nextStatus === "active" ? "Campanha ativada." : "Campanha desativada.");
    } catch (statusError) {
      setError(statusError.message || "Não foi possível atualizar a campanha.");
    }
  }

  async function removeCampaign(campaign) {
    if (!confirm(`Excluir a campanha "${campaign.name}"? O link deixa de funcionar. Os cadastros que já vieram por ele continuam no CRM normalmente.`)) return;
    setError("");
    setMessage("");

    try {
      const response = await fetch(`/api/campaigns/${campaign.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível excluir a campanha.");
      setCampaigns((current) => current.filter((item) => item.id !== campaign.id));
      setMessage("Campanha excluída.");
    } catch (removeError) {
      setError(removeError.message || "Não foi possível excluir a campanha.");
    }
  }

  async function copyLink(campaign) {
    try {
      await navigator.clipboard.writeText(campaign.link);
      setCopiedId(campaign.id);
      setTimeout(() => setCopiedId(""), 2000);
    } catch {
      setError("Não foi possível copiar o link automaticamente. Copie manualmente: " + campaign.link);
    }
  }

  return (
    <section className="container-page grid gap-6">
      <div className="rounded-[28px] border border-line bg-white p-5 shadow-soft sm:p-6">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Tipo de link">
            {TYPE_FILTERS.map((option) => (
              <button
                key={option.value}
                type="button"
                onClick={() => setType(option.value)}
                className={`min-h-11 rounded-full border px-4 text-sm font-extrabold transition ${
                  type === option.value ? "border-brand bg-blue-50 text-brand" : "border-navy/10 bg-white text-navy hover:border-brand"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Buscar por nome do link ou corretor..."
            className="h-11 w-full min-w-0 rounded-2xl border border-line bg-white px-4 font-bold outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10 lg:max-w-xs"
          />
        </div>

        <div className="mt-4 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
          <div className="flex flex-wrap gap-2" role="tablist" aria-label="Período">
            {PERIODS.map((option) => (
              <button
                key={option.value || "all-time"}
                type="button"
                onClick={() => setPeriod(option.value)}
                className={`min-h-10 rounded-full border px-3.5 text-xs font-extrabold uppercase tracking-wide transition ${
                  period === option.value ? "border-brand bg-blue-50 text-brand" : "border-navy/10 bg-white text-muted hover:border-brand"
                }`}
              >
                {option.label}
              </button>
            ))}
          </div>
          {period === "custom" ? (
            <div className="grid gap-3 sm:grid-cols-2">
              <DateField label="Início" value={startDate} onChange={setStartDate} />
              <DateField label="Final" value={endDate} onChange={setEndDate} />
            </div>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        <SummaryCard icon={MousePointerClick} label="Cliques" value={summary.views || 0} tone="blue" />
        <SummaryCard icon={Users} label="Cadastros" value={summary.clients || 0} tone="amber" />
        <SummaryCard icon={Percent} label="Conversão" value={formatPercent(summary.conversion)} tone="green" />
        <SummaryCard icon={UserRound} label="Simulações" value={summary.simulation || 0} tone="slate" />
        <SummaryCard icon={BadgeCheck} label="Vendas" value={summary.sale || 0} tone="green" />
      </div>

      <form onSubmit={createCampaign} className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Novo link personalizado</p>
            <h2 className="mt-2 text-3xl font-black text-navy">Gerar link</h2>
          </div>
          <button type="submit" disabled={isSaving} className="premium-button-primary min-h-11 px-5 py-2.5 disabled:cursor-not-allowed disabled:opacity-60">
            <Plus className="h-5 w-5" aria-hidden="true" />
            {isSaving ? "Gerando..." : "Gerar Link"}
          </button>
        </div>

        <div className="mt-5 grid gap-3 md:grid-cols-2 lg:grid-cols-3">
          <Field label="Nome da campanha" value={form.name} onChange={(value) => setForm((current) => ({ ...current, name: value }))} placeholder='Ex: "Facebook - Terras de São Paulo"' />
          <DestinationField value={form.destinationType} onChange={(value) => setForm((current) => ({ ...current, destinationType: value, brokerId: value === "broker" ? current.brokerId : "" }))} />
          {form.destinationType === "broker" ? (
            <BrokerField brokers={brokers} value={form.brokerId} onChange={(value) => setForm((current) => ({ ...current, brokerId: value }))} />
          ) : null}
        </div>

        {message ? <p className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 font-bold text-brand">{message}</p> : null}
        {error ? <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}
      </form>

      <div className={`grid gap-4 transition-opacity ${loading ? "opacity-60" : ""}`}>
        {sortedCampaigns.map((campaign) => {
          const isActive = campaign.status === "active";
          const isOfficial = campaign.kind === "official";
          const conversion = campaign.viewCount > 0 ? (campaign.clientCount / campaign.viewCount) * 100 : null;
          return (
            <article key={campaign.id} className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
              {editingId === campaign.id && editForm ? (
                <form className="mb-6 rounded-[20px] border border-brand/20 bg-mist p-4" onSubmit={saveCampaign}>
                  <div className="grid gap-3 md:grid-cols-2 lg:grid-cols-3">
                    <Field label="Nome da campanha" value={editForm.name} onChange={(value) => setEditForm((current) => ({ ...current, name: value }))} />
                    <DestinationField value={editForm.destinationType} onChange={(value) => setEditForm((current) => ({ ...current, destinationType: value, brokerId: value === "broker" ? current.brokerId : "" }))} />
                    {editForm.destinationType === "broker" ? (
                      <BrokerField brokers={brokers} value={editForm.brokerId} onChange={(value) => setEditForm((current) => ({ ...current, brokerId: value }))} />
                    ) : null}
                  </div>
                  <div className="mt-4 flex flex-wrap gap-2">
                    <button className="premium-button-primary" disabled={isSaving} type="submit"><Save className="h-4 w-4" /> Salvar alterações</button>
                    <button className="premium-button-secondary" onClick={() => { setEditingId(""); setEditForm(null); }} type="button"><X className="h-4 w-4" /> Cancelar</button>
                  </div>
                </form>
              ) : null}

              <div className="flex flex-col gap-4">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black ${isActive ? "bg-blue-50 text-brand" : "bg-red-50 text-red-700"}`}>
                      {isActive ? <Zap className="h-4 w-4" aria-hidden="true" /> : <ZapOff className="h-4 w-4" aria-hidden="true" />}
                      {STATUS_LABELS[campaign.status] || "Ativa"}
                    </span>
                    <span className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-black uppercase tracking-[0.12em] ${isOfficial ? "bg-navy text-white" : "bg-mist text-muted"}`}>
                      {isOfficial ? <BadgeCheck className="h-3.5 w-3.5" aria-hidden="true" /> : null}
                      {isOfficial ? "Link Oficial" : "Link Personalizado"}
                    </span>
                    {!isOfficial ? (
                      <span className="rounded-full bg-mist px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-muted">
                        {campaign.destinationType === "broker" ? "Corretor específico" : "Roleta"}
                      </span>
                    ) : null}
                  </div>
                  <h3 className="mt-3 truncate text-2xl font-black text-navy">{campaign.name}</h3>
                  {campaign.brokerName ? (
                    <p className="mt-1 font-bold text-muted">Corretor: <strong className="text-navy">{campaign.brokerName}</strong></p>
                  ) : null}
                  <p className="mt-1 break-all font-bold text-brand">{campaign.link}</p>

                  <div className="mt-4 grid grid-cols-3 gap-2 sm:max-w-md">
                    <MiniStat label="Cliques" value={campaign.viewCount || 0} />
                    <MiniStat label="Cadastros" value={campaign.clientCount || 0} />
                    <MiniStat label="Conversão" value={conversion === null ? "—" : `${conversion.toFixed(1)}%`} />
                  </div>
                  <p className="mt-3 text-xs font-bold text-muted">Criado em: {formatDate(campaign.createdAt)}</p>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <button type="button" onClick={() => copyLink(campaign)} className="premium-button-secondary justify-center">
                    {copiedId === campaign.id ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                    {copiedId === campaign.id ? "Copiado!" : "Copiar link"}
                  </button>
                  <Link href={`/admin/gerador-de-links/${campaign.id}/clientes`} className="premium-button-secondary justify-center">
                    <Users className="h-5 w-5" /> Ver performance
                  </Link>
                  {!isOfficial ? (
                    <>
                      <button type="button" onClick={() => beginEdit(campaign)} className="premium-button-secondary justify-center">
                        <Pencil className="h-5 w-5" /> Editar
                      </button>
                      <button type="button" onClick={() => toggleStatus(campaign)} className="premium-button-secondary justify-center">
                        {isActive ? <ZapOff className="h-5 w-5" aria-hidden="true" /> : <Zap className="h-5 w-5" aria-hidden="true" />}
                        {isActive ? "Desativar" : "Ativar"}
                      </button>
                      <button type="button" onClick={() => removeCampaign(campaign)} className="premium-button border border-red-200 bg-white text-red-700 hover:shadow-soft justify-center">
                        <Trash2 className="h-5 w-5" aria-hidden="true" /> Excluir
                      </button>
                    </>
                  ) : null}
                </div>
              </div>
            </article>
          );
        })}

        {!sortedCampaigns.length ? (
          <article className="rounded-[28px] border border-line bg-white p-8 text-center font-black text-navy shadow-soft">
            Nenhum link encontrado para esse filtro.
          </article>
        ) : null}
      </div>
    </section>
  );
}

function SummaryCard({ icon: Icon, label, value, tone }) {
  const toneClasses = {
    blue: "border-blue-100 bg-blue-50 text-blue-700",
    amber: "border-amber-100 bg-amber-50 text-amber-700",
    slate: "border-slate-100 bg-slate-50 text-slate-700",
    green: "border-emerald-100 bg-emerald-50 text-emerald-700"
  };
  return (
    <article className={`rounded-2xl border bg-white p-4 shadow-soft ${toneClasses[tone] || toneClasses.slate}`}>
      <Icon className="h-5 w-5" aria-hidden="true" />
      <p className="mt-2 text-2xl font-black text-navy">{value}</p>
      <p className="text-xs font-bold uppercase tracking-wide text-muted">{label}</p>
    </article>
  );
}

function MiniStat({ label, value }) {
  return (
    <div className="rounded-xl border border-line bg-mist px-3 py-2 text-center">
      <p className="text-lg font-black text-navy">{value}</p>
      <p className="text-[10px] font-black uppercase tracking-wide text-muted">{label}</p>
    </div>
  );
}

function DestinationField({ value, onChange, className = "" }) {
  return (
    <label className={`grid min-w-0 gap-2 text-sm font-black text-navy ${className}`}>
      Destino
      <select
        className="h-14 min-w-0 w-full rounded-2xl border border-line bg-white px-4 font-extrabold outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="roulette">Roleta</option>
        <option value="broker">Corretor específico</option>
      </select>
    </label>
  );
}

function BrokerField({ brokers, value, onChange, className = "" }) {
  return (
    <label className={`grid min-w-0 gap-2 text-sm font-black text-navy ${className}`}>
      Corretor
      <select
        className="h-14 min-w-0 w-full rounded-2xl border border-line bg-white px-4 font-extrabold outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
        required
        value={value}
        onChange={(event) => onChange(event.target.value)}
      >
        <option value="">Selecione um corretor</option>
        {brokers.map((broker) => (
          <option key={broker.id} value={broker.id}>{broker.name}</option>
        ))}
      </select>
    </label>
  );
}

function Field({ label, value, onChange, type = "text", className = "", placeholder = "" }) {
  return (
    <label className={`grid min-w-0 gap-2 text-sm font-black text-navy ${className}`}>
      {label}
      <input
        type={type}
        value={value}
        placeholder={placeholder}
        onChange={(event) => onChange(event.target.value)}
        className="h-14 min-w-0 w-full rounded-2xl border border-line bg-white px-4 font-extrabold outline-none transition focus:border-brand focus:ring-4 focus:ring-brand/10"
      />
    </label>
  );
}

function DateField({ label, value, onChange }) {
  return (
    <label className="text-sm font-extrabold text-navy">
      {label}
      <input
        type="date"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        className="mt-2 min-h-11 rounded-2xl border border-navy/15 px-4 text-sm text-navy outline-none focus:border-brand focus:ring-4 focus:ring-brand/15"
      />
    </label>
  );
}

function formatPercent(value) {
  if (value === null || value === undefined) return "—";
  return `${(value * 100).toFixed(1)}%`;
}

function formatDate(value) {
  if (!value) return "Não informado";
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
  } catch {
    return "Não informado";
  }
}
