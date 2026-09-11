"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { Check, Copy, Pencil, Plus, Save, Trash2, Users, X, Zap, ZapOff } from "lucide-react";

const EMPTY_FORM = {
  name: "",
  destinationType: "roulette",
  brokerId: ""
};

const STATUS_LABELS = {
  active: "Ativa",
  inactive: "Inativa"
};

export default function CampaignsManager({ initialCampaigns = [], brokers = [] }) {
  const [campaigns, setCampaigns] = useState(initialCampaigns);
  const [form, setForm] = useState(EMPTY_FORM);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [editForm, setEditForm] = useState(null);
  const [copiedId, setCopiedId] = useState("");

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
      <form onSubmit={createCampaign} className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
        <div className="flex flex-col gap-3 md:flex-row md:items-end md:justify-between">
          <div>
            <p className="text-sm font-black uppercase tracking-[0.18em] text-brand">Nova campanha</p>
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

      <div className="grid gap-4">
        {sortedCampaigns.map((campaign) => {
          const isActive = campaign.status === "active";
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

              <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className={`inline-flex items-center gap-2 rounded-full px-3 py-1 text-xs font-black ${isActive ? "bg-blue-50 text-brand" : "bg-red-50 text-red-700"}`}>
                      {isActive ? <Zap className="h-4 w-4" aria-hidden="true" /> : <ZapOff className="h-4 w-4" aria-hidden="true" />}
                      {STATUS_LABELS[campaign.status] || "Ativa"}
                    </span>
                    <span className="rounded-full bg-mist px-3 py-1 text-xs font-black uppercase tracking-[0.12em] text-muted">
                      {campaign.destinationType === "broker" ? "Corretor específico" : "Roleta"}
                    </span>
                  </div>
                  <h3 className="mt-3 truncate text-2xl font-black text-navy">{campaign.name}</h3>
                  {campaign.destinationType === "broker" ? (
                    <p className="mt-1 font-bold text-muted">Corretor: <strong className="text-navy">{campaign.brokerName || "Não definido"}</strong></p>
                  ) : null}
                  <p className="mt-1 break-all font-bold text-brand">{campaign.link}</p>
                  <p className="mt-3 text-sm font-bold text-muted">
                    Criado em: {formatDate(campaign.createdAt)} · Cadastros: <strong className="text-navy">{campaign.clientCount || 0}</strong>
                  </p>
                </div>

                <div className="grid gap-2 sm:grid-cols-2 lg:min-w-[420px]">
                  <button type="button" onClick={() => copyLink(campaign)} className="premium-button-secondary justify-center">
                    {copiedId === campaign.id ? <Check className="h-5 w-5" /> : <Copy className="h-5 w-5" />}
                    {copiedId === campaign.id ? "Copiado!" : "Copiar link"}
                  </button>
                  <Link href={`/admin/gerador-de-links/${campaign.id}/clientes`} className="premium-button-secondary justify-center">
                    <Users className="h-5 w-5" /> Ver clientes
                  </Link>
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
                </div>
              </div>
            </article>
          );
        })}

        {!sortedCampaigns.length ? (
          <article className="rounded-[28px] border border-line bg-white p-8 text-center font-black text-navy shadow-soft">
            Nenhuma campanha criada ainda.
          </article>
        ) : null}
      </div>
    </section>
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

function formatDate(value) {
  if (!value) return "Não informado";
  try {
    return new Intl.DateTimeFormat("pt-BR", { timeZone: "America/Sao_Paulo" }).format(new Date(value));
  } catch {
    return "Não informado";
  }
}
