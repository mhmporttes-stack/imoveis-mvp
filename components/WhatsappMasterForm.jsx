"use client";

import { useState } from "react";
import { Save } from "lucide-react";

export default function WhatsappMasterForm({ initialSettings }) {
  const [form, setForm] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function submit(event) {
    event.preventDefault();
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/crm-settings/whatsapp-master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar.");
      setForm(payload.settings);
      setMessage("Configuração salva.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="container-page rounded-[28px] border border-line bg-white p-6 shadow-soft">
      <div className="grid gap-4 md:grid-cols-2">
        <Field label="Número do WhatsApp Master" value={form.phone} onChange={(phone) => setForm((current) => ({ ...current, phone }))} />
        <Field label="Identificador da conexão" value={form.connectionId} onChange={(connectionId) => setForm((current) => ({ ...current, connectionId }))} />
        <label className="grid gap-2 text-sm font-black text-navy">
          Status da conexão
          <select value={form.connectionStatus} onChange={(event) => setForm((current) => ({ ...current, connectionStatus: event.target.value }))} className="h-14 rounded-2xl border border-line bg-white px-4 font-extrabold outline-none focus:border-brand">
            <option value="disconnected">Desconectado</option>
            <option value="connecting">Conectando</option>
            <option value="connected">Conectado</option>
          </select>
        </label>
        <Field label="Última conexão" type="datetime-local" value={toInputDateTime(form.lastConnectedAt)} onChange={(lastConnectedAt) => setForm((current) => ({ ...current, lastConnectedAt }))} />
      </div>
      <label className="mt-5 flex items-center gap-3 font-black text-navy">
        <input type="checkbox" checked={form.active} onChange={(event) => setForm((current) => ({ ...current, active: event.target.checked }))} className="h-5 w-5 accent-brand" />
        Ativo para notificações internas futuras
      </label>
      {message ? <p className="mt-4 rounded-2xl bg-blue-50 px-4 py-3 font-bold text-brand">{message}</p> : null}
      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}
      <button type="submit" disabled={saving} className="premium-button-primary mt-6">
        <Save className="h-5 w-5" aria-hidden="true" />
        {saving ? "Salvando..." : "Salvar"}
      </button>
    </form>
  );
}

function Field({ label, value, onChange, type = "text" }) {
  return (
    <label className="grid gap-2 text-sm font-black text-navy">
      {label}
      <input type={type} value={value || ""} onChange={(event) => onChange(event.target.value)} className="h-14 rounded-2xl border border-line bg-white px-4 font-extrabold outline-none focus:border-brand" />
    </label>
  );
}

function toInputDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) return String(value).slice(0, 16);
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}
