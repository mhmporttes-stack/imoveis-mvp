"use client";

import { useState } from "react";
import { Save } from "lucide-react";

// Fonte única de verdade de quando a automação "Novo cliente cadastrado"
// pode disparar, por origem do cliente — nunca fixo no código. Contato de
// Prospecção nunca notifica (regra própria, não aparece aqui).
export default function NewClientNotificationOriginSettings({ initialSettings }) {
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState("");
  const [error, setError] = useState("");

  async function save(next) {
    setSaving(true);
    setError("");
    setFeedback("");
    try {
      const response = await fetch("/api/crm-settings/new-client-notification-origins", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(next)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Não foi possível salvar.");
      setSettings(payload);
      setFeedback("Configuração salva.");
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="container-page">
      <div className="rounded-[24px] border border-line bg-white p-5 shadow-soft">
        <p className="text-sm font-black uppercase tracking-[0.16em] text-brand">Configurações de notificações</p>
        <h3 className="mt-2 text-xl font-black text-navy">Novo cliente — origem</h3>
        <p className="mt-2 text-sm font-bold text-muted">
          Controla quando a automação "Novo cliente cadastrado" pode disparar, conforme a origem do cliente. Um contato assumido da Prospecção nunca notifica, independente desta configuração.
        </p>

        <div className="mt-4 grid gap-2.5 sm:grid-cols-2">
          <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-line bg-white px-4 text-sm font-black text-navy">
            <input
              className="h-5 w-5 shrink-0 accent-brand"
              type="checkbox"
              checked={settings.manual}
              disabled={saving}
              onChange={(event) => save({ ...settings, manual: event.target.checked })}
            />
            Cliente cadastrado manualmente
          </label>
          <label className="flex min-h-11 items-center gap-3 rounded-2xl border border-line bg-white px-4 text-sm font-black text-navy">
            <input
              className="h-5 w-5 shrink-0 accent-brand"
              type="checkbox"
              checked={settings.form}
              disabled={saving}
              onChange={(event) => save({ ...settings, form: event.target.checked })}
            />
            Cliente recebido por formulário/link
          </label>
        </div>

        {saving ? <p className="mt-3 text-xs font-bold text-muted"><Save className="mr-1 inline h-3.5 w-3.5" />Salvando…</p> : null}
        {feedback ? <p className="mt-3 text-xs font-bold text-emerald-700">{feedback}</p> : null}
        {error ? <p className="mt-3 text-xs font-bold text-red-700">{error}</p> : null}
      </div>
    </section>
  );
}
