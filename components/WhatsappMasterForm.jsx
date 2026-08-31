"use client";

import { useState } from "react";
import { CheckCircle2, CircleX, LoaderCircle, Save, Wifi } from "lucide-react";

export default function WhatsappMasterForm({ initialSettings, environment }) {
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const connected = settings.connectionStatus === "connected";

  async function save() {
    setSaving(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/crm-settings/whatsapp-master", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: settings.active })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar.");
      setSettings(payload.settings);
      setMessage("Configuração salva.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setSaving(false);
    }
  }

  async function testConnection() {
    setTesting(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/crm-settings/whatsapp-master/test", { method: "POST" });
      const payload = await response.json().catch(() => ({}));
      if (payload.settings) setSettings(payload.settings);
      if (!response.ok || !payload.ok) throw new Error(payload.error || "Falha na conexão.");
      setMessage("Conexão válida com a Meta Cloud API.");
    } catch (testError) {
      setError(testError.message);
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="container-page rounded-[28px] border border-line bg-white p-6 shadow-soft">
      <div className={`mb-6 flex items-center gap-3 rounded-2xl px-4 py-4 font-black ${connected ? "bg-emerald-50 text-emerald-800" : "bg-red-50 text-red-700"}`}>
        {connected ? <CheckCircle2 className="h-6 w-6" /> : <CircleX className="h-6 w-6" />}
        {connected ? "Conectado" : settings.connectionStatus === "not_configured" ? "Não configurado" : "Desconectado"}
      </div>

      <dl className="grid gap-4 md:grid-cols-2">
        <Info label="Número do WhatsApp Master" value={settings.phone || "Ainda não identificado"} />
        <Info label="Tipo da conexão" value="Meta Cloud API" />
        <Info label="Última verificação" value={formatDate(settings.lastCheckedAt)} />
        <Info label="Último webhook recebido" value={formatDate(settings.lastWebhookAt)} />
      </dl>

      <div className="mt-6 rounded-2xl border border-line p-4">
        <p className="mb-3 text-sm font-black uppercase tracking-[0.12em] text-navy">Configuração do servidor</p>
        <div className="grid gap-2 text-sm font-bold text-muted md:grid-cols-2">
          <ConfigItem ok={environment.accessToken} label="Token de acesso" />
          <ConfigItem ok={environment.phoneNumberId} label="ID do número" />
          <ConfigItem ok={environment.webhookVerifyToken} label="Token do webhook" />
          <ConfigItem ok={environment.appSecret} label="App Secret" />
        </div>
      </div>

      <label className="mt-5 flex items-center gap-3 font-black text-navy">
        <input type="checkbox" checked={settings.active} onChange={(event) => setSettings((current) => ({ ...current, active: event.target.checked }))} className="h-5 w-5 accent-brand" />
        Ativo para notificações internas futuras
      </label>

      {message ? <p className="mt-4 rounded-2xl bg-emerald-50 px-4 py-3 font-bold text-emerald-800">{message}</p> : null}
      {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}

      <div className="mt-6 flex flex-wrap gap-3">
        <button type="button" onClick={testConnection} disabled={testing} className="premium-button-primary">
          {testing ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Wifi className="h-5 w-5" />}
          {testing ? "Testando..." : "Testar conexão"}
        </button>
        <button type="button" onClick={save} disabled={saving} className="premium-button-secondary">
          <Save className="h-5 w-5" />
          {saving ? "Salvando..." : "Salvar"}
        </button>
      </div>
    </section>
  );
}

function Info({ label, value }) {
  return <div className="rounded-2xl border border-line p-4"><dt className="text-sm font-black text-muted">{label}</dt><dd className="mt-1 font-black text-navy">{value}</dd></div>;
}

function ConfigItem({ ok, label }) {
  return <p className="flex items-center gap-2">{ok ? <CheckCircle2 className="h-4 w-4 text-emerald-600" /> : <CircleX className="h-4 w-4 text-red-600" />}{label}</p>;
}

function formatDate(value) {
  if (!value) return "Ainda não verificado";
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("pt-BR") : "Ainda não verificado";
}
