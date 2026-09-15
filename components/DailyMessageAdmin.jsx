"use client";
import { useEffect, useState } from "react";
import DailyMessageExperience from "./DailyMessageExperience";
import DailyMessageLibrary from "./DailyMessageLibrary";
import DailyMessageDispatch from "./DailyMessageDispatch";

const FONT_OPTIONS = [
  { value: "playfair_display", label: "Playfair Display" },
  { value: "cormorant_garamond", label: "Cormorant Garamond" },
  { value: "libre_baskerville", label: "Libre Baskerville" },
  { value: "lora", label: "Lora" },
  { value: "cinzel", label: "Cinzel" }
];
const CONTENT_TYPE_OPTIONS = [
  { value: "alternate", label: "Alternar entre os dois" },
  { value: "biblical", label: "Bíblicos" },
  { value: "reflection", label: "Reflexivos/motivacionais" }
];
const SUB_TABS = [
  { key: "settings", label: "Configuração" },
  { key: "library", label: "Biblioteca de cards" },
  { key: "dispatch", label: "Disparar agora" }
];

export default function DailyMessageAdmin({ initialSettings }) {
  const [subTab, setSubTab] = useState("settings");
  const [settings, setSettings] = useState(initialSettings);
  const [draft, setDraft] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [previewCard, setPreviewCard] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [nextCycleLabel, setNextCycleLabel] = useState("");

  useEffect(() => {
    setNextCycleLabel(computeNextCycleLabelClientSide(draft.startTime));
  }, [draft.startTime]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(settings);

  async function saveSettings() {
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const response = await fetch("/api/daily-message/settings", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      setSettings(data);
      setDraft(data);
      setMessage("Configuração salva.");
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar.");
    } finally {
      setSaving(false);
    }
  }

  async function openPreview() {
    setPreviewLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/daily-message/cards/preview?type=${draft.contentType}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar um card para pré-visualizar.");
      if (!data.card) throw new Error("Nenhum card ativo disponível para pré-visualizar.");
      setPreviewCard({ ...data.card, font: draft.font });
    } catch (previewError) {
      setError(previewError.message);
    } finally {
      setPreviewLoading(false);
    }
  }

  return (
    <section className="container-page space-y-5">
      <div className="flex flex-wrap gap-2 rounded-xl border border-navy/[0.07] bg-white p-1 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
        {SUB_TABS.map((tab) => (
          <button
            key={tab.key}
            type="button"
            onClick={() => setSubTab(tab.key)}
            className={`min-h-9 flex-1 rounded-lg px-3 text-[13px] font-black transition ${subTab === tab.key ? "bg-navy text-white" : "text-navy hover:bg-mist"}`}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {subTab === "settings" ? (
        <div className="rounded-[24px] border border-line bg-white p-6 shadow-soft">
          <h3 className="text-xl font-black text-navy">Mensagem do Dia</h3>
          <p className="mt-1 text-sm text-muted">Experiência de abertura da jornada de trabalho, exibida uma vez por ciclo diário para os corretores.</p>

          <div className="mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-line bg-mist p-4">
            <div>
              <p className="text-sm font-black text-navy">Mensagem do Dia ativa</p>
              <p className="text-xs text-muted">Quando desativada, o ciclo automático não é apresentado. A biblioteca e o histórico não são apagados.</p>
            </div>
            <button
              type="button"
              onClick={() => setDraft((current) => ({ ...current, enabled: !current.enabled }))}
              aria-pressed={draft.enabled}
              className={`inline-flex h-10 items-center gap-2 rounded-full border px-4 text-sm font-black transition ${draft.enabled ? "border-brand bg-blue-50 text-brand" : "border-line bg-white text-muted"}`}
            >
              <span className={`h-2.5 w-2.5 rounded-full ${draft.enabled ? "bg-brand" : "bg-muted"}`} aria-hidden="true" />
              {draft.enabled ? "Ativa" : "Desativada"}
            </button>
          </div>

          <div className="mt-5 grid gap-4 sm:grid-cols-2">
            <label className="text-sm font-black text-navy">
              Tipo de conteúdo
              <select
                className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-4 font-bold outline-none focus:border-brand"
                value={draft.contentType}
                onChange={(event) => setDraft((current) => ({ ...current, contentType: event.target.value }))}
              >
                {CONTENT_TYPE_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>

            <label className="text-sm font-black text-navy">
              Horário de início da jornada
              <input
                type="time"
                className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-4 font-bold outline-none focus:border-brand"
                value={draft.startTime}
                onChange={(event) => setDraft((current) => ({ ...current, startTime: event.target.value }))}
              />
            </label>

            <label className="text-sm font-black text-navy sm:col-span-2">
              Fonte da experiência
              <select
                className="mt-2 h-11 w-full rounded-2xl border border-line bg-white px-4 font-bold outline-none focus:border-brand"
                value={draft.font}
                onChange={(event) => setDraft((current) => ({ ...current, font: event.target.value }))}
              >
                {FONT_OPTIONS.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
              </select>
            </label>
          </div>

          <p className="mt-4 text-sm text-muted">Uma nova Mensagem do Dia ficará disponível diariamente a partir deste horário.</p>
          <p className="text-sm font-bold text-navy">Próximo ciclo: {nextCycleLabel}</p>

          <div className="mt-6 flex flex-wrap items-center gap-2">
            <button type="button" onClick={saveSettings} disabled={!dirty || saving} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">
              {saving ? "Salvando..." : "Salvar configuração"}
            </button>
            <button type="button" onClick={openPreview} disabled={previewLoading} className="premium-button-secondary disabled:cursor-not-allowed disabled:opacity-60">
              {previewLoading ? "Carregando..." : "Visualizar experiência"}
            </button>
          </div>

          {message ? <p className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 font-bold text-brand">{message}</p> : null}
          {error ? <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}
        </div>
      ) : null}

      {subTab === "library" ? <DailyMessageLibrary /> : null}
      {subTab === "dispatch" ? <DailyMessageDispatch defaultContentType={settings.contentType} /> : null}

      {previewCard ? <DailyMessageExperience card={previewCard} font={draft.font} preview onComplete={() => setPreviewCard(null)} /> : null}
    </section>
  );
}

function computeNextCycleLabelClientSide(startTime) {
  const [hh, mm] = (startTime || "08:00").split(":").map(Number);
  const now = new Date();
  const spNow = new Date(now.toLocaleString("en-US", { timeZone: "America/Sao_Paulo" }));
  const boundaryToday = new Date(spNow);
  boundaryToday.setHours(hh, mm, 0, 0);
  const label = `${String(hh).padStart(2, "0")}:${String(mm).padStart(2, "0")}`;
  return spNow.getTime() < boundaryToday.getTime() ? `hoje às ${label}` : `amanhã às ${label}`;
}
