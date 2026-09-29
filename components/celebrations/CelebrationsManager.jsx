"use client";

import { useEffect, useMemo, useState } from "react";
import CelebrationOverlay from "./CelebrationOverlay";

const BASE_ANIMATIONS = ["confete", "fogos", "moedas", "coroa"];
const ANIMATION_LABELS = { confete: "Confete", fogos: "Fogos", moedas: "Moedas", coroa: "Coroa", combo_200: "Combo especial (fixo)" };
const SOURCE_LABELS = { auto: "Automático", manual: "Manual" };
const SUB_TABS = [
  { key: "gatilhos", label: "Gatilhos" },
  { key: "mensagens", label: "Mensagens" },
  { key: "disparo", label: "Disparo manual" },
  { key: "historico", label: "Histórico" }
];

const HISTORY_DATE_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

function formatDateTimeSP(value) {
  if (!value) return "";
  try {
    return HISTORY_DATE_FORMATTER.format(new Date(value));
  } catch {
    return "";
  }
}

function resolveSampleText(text) {
  return String(text || "").replace(/\[nome\]/g, "Você").replace(/\[N\]/g, "5");
}

// O "Testar" nunca chama a API: monta uma amostra local a partir das
// mensagens já cadastradas (ou um texto genérico, se o gatilho ainda não
// tiver nenhuma) e resolve a animação do mesmo jeito que o motor faria.
function sampleMessageForTrigger(trigger, templates) {
  const active = templates.filter((item) => item.trigger_key === trigger.key && item.active);
  const chosen = active.length ? active[Math.floor(Math.random() * active.length)] : null;
  const text = chosen ? chosen.template : `Parabéns! Você bateu: ${trigger.label}`;
  return resolveSampleText(text);
}

function pickAnimationForTest(trigger, animationMode) {
  if (trigger.animationLocked) return "combo_200";
  if (!animationMode || animationMode === "random") {
    return BASE_ANIMATIONS[Math.floor(Math.random() * BASE_ANIMATIONS.length)];
  }
  return animationMode;
}

function buildTriggerDraft(trigger) {
  const fields = {};
  for (const field of trigger.configFields || []) {
    const raw = trigger.config?.[field.key];
    if (field.type === "list") {
      fields[field.key] = Array.isArray(raw) ? raw.join(", ") : "";
    } else {
      fields[field.key] = raw === undefined || raw === null ? "" : String(raw);
    }
  }
  return { enabled: Boolean(trigger.enabled), animationMode: trigger.animationMode || "random", fields };
}

function buildAllDrafts(triggers) {
  return Object.fromEntries(triggers.map((trigger) => [trigger.key, buildTriggerDraft(trigger)]));
}

// Converte os textos digitados (todos os campos são strings no draft) de
// volta pro formato que a API espera: number vira Number, list vira array de
// inteiros positivos — string vazia cai no default do próprio gatilho.
function parseTriggerConfig(trigger, fields) {
  const config = {};
  for (const field of trigger.configFields || []) {
    const raw = String(fields?.[field.key] ?? "").trim();
    if (field.type === "list") {
      if (!raw) {
        config[field.key] = Array.isArray(field.default) ? field.default : [];
        continue;
      }
      const numbers = raw.split(",").map((part) => part.trim()).filter(Boolean).map(Number);
      if (!numbers.length || numbers.some((n) => !Number.isInteger(n) || n <= 0)) {
        throw new Error(`"${field.label}" deve conter apenas números inteiros positivos separados por vírgula.`);
      }
      config[field.key] = numbers;
    } else {
      if (!raw) {
        config[field.key] = field.default;
        continue;
      }
      const number = Number(raw);
      if (!Number.isFinite(number)) throw new Error(`"${field.label}" deve ser um número válido.`);
      config[field.key] = number;
    }
  }
  return config;
}

export default function CelebrationsManager({ initialTriggers = [], initialTemplates = [], brokers = [] }) {
  const [tab, setTab] = useState("gatilhos");
  const [triggers, setTriggers] = useState(initialTriggers);
  const [templates, setTemplates] = useState(initialTemplates);
  const [preview, setPreview] = useState(null);

  function testAnimation(message, animation) {
    setPreview({ message, animation });
  }

  return (
    <section className="space-y-6">
      <nav className="container-page flex flex-wrap justify-center gap-1.5 rounded-xl border border-navy/[0.07] bg-white p-1 shadow-[0_1px_2px_rgba(13,59,102,0.04)]">
        {SUB_TABS.map((item) => (
          <button
            key={item.key}
            type="button"
            onClick={() => setTab(item.key)}
            className={`rounded-[10px] px-4 py-1.5 text-center text-[13px] font-black ${tab === item.key ? "bg-navy text-white" : "text-navy"}`}
          >
            {item.label}
          </button>
        ))}
      </nav>

      <div className="container-page space-y-4">
        {tab === "gatilhos" ? (
          <TriggersSection triggers={triggers} setTriggers={setTriggers} templates={templates} onTest={testAnimation} />
        ) : null}
        {tab === "mensagens" ? (
          <MessagesSection triggers={triggers} templates={templates} setTemplates={setTemplates} onTest={testAnimation} />
        ) : null}
        {tab === "disparo" ? (
          <ManualDispatchSection brokers={brokers} triggers={triggers} templates={templates} onTest={testAnimation} />
        ) : null}
        {tab === "historico" ? <HistorySection brokers={brokers} /> : null}
      </div>

      {preview ? (
        <CelebrationOverlay message={preview.message} animation={preview.animation} previewMode onDismiss={() => setPreview(null)} />
      ) : null}
    </section>
  );
}

function TriggersSection({ triggers, setTriggers, templates, onTest }) {
  const baseline = useMemo(() => buildAllDrafts(triggers), [triggers]);
  const [drafts, setDrafts] = useState(baseline);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    setDrafts(baseline);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseline]);

  function isDirty(key) {
    return JSON.stringify(drafts[key]) !== JSON.stringify(baseline[key]);
  }
  const anyDirty = triggers.some((trigger) => isDirty(trigger.key));

  function updateDraft(key, patch) {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  function updateField(key, fieldKey, value) {
    setDrafts((current) => ({ ...current, [key]: { ...current[key], fields: { ...current[key].fields, [fieldKey]: value } } }));
  }

  function handleTest(trigger) {
    const message = sampleMessageForTrigger(trigger, templates);
    const animation = pickAnimationForTest(trigger, drafts[trigger.key]?.animationMode ?? trigger.animationMode);
    onTest(message, animation);
  }

  async function saveChanges() {
    setSaving(true);
    setError("");
    setNotice("");
    try {
      let latest = triggers;
      for (const trigger of triggers) {
        if (!isDirty(trigger.key)) continue;
        const draft = drafts[trigger.key];
        const config = parseTriggerConfig(trigger, draft.fields);
        const body = { key: trigger.key, enabled: draft.enabled, config };
        if (!trigger.animationLocked) body.animationMode = draft.animationMode;

        const response = await fetch("/api/celebrations/triggers", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body)
        });
        const payload = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(payload?.error || "Não foi possível salvar o gatilho.");
        latest = payload.triggers;
      }
      setTriggers(latest);
      setNotice("Gatilhos atualizados.");
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar os gatilhos.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Reconhecimentos</p>
          <h2 className="mt-2 text-2xl font-extrabold text-navy">Gatilhos e animações</h2>
        </div>
        <button
          type="button"
          onClick={saveChanges}
          disabled={!anyDirty || saving}
          className="premium-button-primary h-11 min-h-0 px-5 text-sm disabled:opacity-40"
        >
          {saving ? "Salvando..." : "Salvar alterações"}
        </button>
      </div>

      {error ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p> : null}
      {notice ? <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{notice}</p> : null}

      <div className="mt-6 divide-y divide-navy/5">
        {triggers.map((trigger) => {
          const draft = drafts[trigger.key] || buildTriggerDraft(trigger);
          return (
            <div key={trigger.key} className="flex flex-col gap-3 py-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="font-extrabold text-navy">{trigger.label}</p>
                  <p className="text-xs font-semibold text-slate-500">{trigger.description}</p>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => handleTest(trigger)} className="premium-button-secondary h-9 px-3 text-xs">
                    Testar
                  </button>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={draft.enabled}
                    aria-label={draft.enabled ? `Desativar ${trigger.label}` : `Ativar ${trigger.label}`}
                    onClick={() => updateDraft(trigger.key, { enabled: !draft.enabled })}
                    className={`relative h-7 w-12 shrink-0 rounded-full transition ${draft.enabled ? "bg-brand" : "bg-slate-300"}`}
                  >
                    <span className={`absolute top-1 h-5 w-5 rounded-full bg-white transition ${draft.enabled ? "left-6" : "left-1"}`} />
                  </button>
                </div>
              </div>

              {trigger.configFields?.length ? (
                <div className="flex flex-wrap gap-3">
                  {trigger.configFields.map((field) => (
                    <label key={field.key} className="text-xs font-black text-navy">
                      {field.label}
                      <input
                        type={field.type === "list" ? "text" : "number"}
                        value={draft.fields[field.key] ?? ""}
                        onChange={(event) => updateField(trigger.key, field.key, event.target.value)}
                        placeholder={field.type === "list" ? (Array.isArray(field.default) ? field.default : []).join(", ") : String(field.default ?? "")}
                        className="mt-1 h-10 w-40 rounded-xl border border-line bg-white px-3 text-sm font-bold outline-none focus:border-brand"
                      />
                    </label>
                  ))}
                </div>
              ) : null}

              <div className="flex flex-wrap items-center gap-2">
                <span className="text-xs font-black text-navy">Animação</span>
                {trigger.animationLocked ? (
                  <span className="rounded-full border border-navy/15 bg-mist px-3 py-1.5 text-xs font-black text-muted">Combo especial (fixo)</span>
                ) : (
                  <select
                    value={draft.animationMode}
                    onChange={(event) => updateDraft(trigger.key, { animationMode: event.target.value })}
                    className="h-10 rounded-xl border border-line bg-white px-3 text-sm font-bold outline-none focus:border-brand"
                  >
                    <option value="random">Aleatória</option>
                    {BASE_ANIMATIONS.map((animation) => (
                      <option key={animation} value={animation}>{ANIMATION_LABELS[animation]}</option>
                    ))}
                  </select>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </article>
  );
}

function MessagesSection({ triggers, templates, setTemplates, onTest }) {
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [editingId, setEditingId] = useState("");
  const [editText, setEditText] = useState("");
  const [newTexts, setNewTexts] = useState({});

  function templatesFor(key) {
    return templates.filter((item) => item.trigger_key === key);
  }

  function beginEdit(template) {
    setEditingId(template.id);
    setEditText(template.template);
  }

  async function toggleActive(template) {
    setBusyId(template.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/celebrations/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !template.active })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível atualizar a mensagem.");
      setTemplates((current) => current.map((item) => (item.id === template.id ? payload.template : item)));
    } catch (toggleError) {
      setError(toggleError.message);
    } finally {
      setBusyId("");
    }
  }

  async function saveEdit(template) {
    const text = editText.trim();
    if (!text || text.length > 140) return;
    setBusyId(template.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/celebrations/templates/${template.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ template: text })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível salvar a mensagem.");
      setTemplates((current) => current.map((item) => (item.id === template.id ? payload.template : item)));
      setEditingId("");
      setNotice("Mensagem atualizada.");
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusyId("");
    }
  }

  async function removeTemplate(template) {
    if (template.is_default) return;
    if (!window.confirm("Excluir esta variação de mensagem? Essa ação não pode ser desfeita.")) return;
    setBusyId(template.id);
    setError("");
    setNotice("");
    try {
      const response = await fetch(`/api/celebrations/templates/${template.id}`, { method: "DELETE" });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível excluir a mensagem.");
      setTemplates((current) => current.filter((item) => item.id !== template.id));
    } catch (removeError) {
      setError(removeError.message);
    } finally {
      setBusyId("");
    }
  }

  async function addVariation(triggerKey) {
    const text = (newTexts[triggerKey] || "").trim();
    if (!text || text.length > 140) return;
    setBusyId(`new:${triggerKey}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/celebrations/templates", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerKey, template: text })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível criar a mensagem.");
      setTemplates((current) => [...current, payload.template]);
      setNewTexts((current) => ({ ...current, [triggerKey]: "" }));
      setNotice("Variação adicionada.");
    } catch (addError) {
      setError(addError.message);
    } finally {
      setBusyId("");
    }
  }

  async function restoreDefault(triggerKey, label) {
    if (!window.confirm(`Restaurar os textos padrão de "${label}"? Isso desativa as variações personalizadas deste gatilho.`)) return;
    setBusyId(`restore:${triggerKey}`);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/celebrations/templates/restore-default", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ triggerKey })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível restaurar os textos padrão.");
      setTemplates((current) => [
        ...current.filter((item) => item.trigger_key !== triggerKey),
        ...payload.templates.filter((item) => item.trigger_key === triggerKey)
      ]);
      setNotice("Textos padrão restaurados.");
    } catch (restoreError) {
      setError(restoreError.message);
    } finally {
      setBusyId("");
    }
  }

  return (
    <div className="space-y-4">
      {error ? <p className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p> : null}
      {notice ? <p className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{notice}</p> : null}

      {triggers.map((trigger) => {
        const list = templatesFor(trigger.key);
        const hasName = list.some((item) => item.template.includes("[nome]"));
        return (
          <article key={trigger.key} className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <p className="font-extrabold text-navy">{trigger.label}</p>
                <p className="text-xs font-semibold text-slate-500">{trigger.description}</p>
              </div>
              <button
                type="button"
                onClick={() => restoreDefault(trigger.key, trigger.label)}
                disabled={busyId === `restore:${trigger.key}`}
                className="premium-button-secondary h-9 px-3 text-xs disabled:opacity-40"
              >
                Restaurar padrão
              </button>
            </div>

            {list.length && !hasName ? (
              <p className="mt-3 rounded-xl border border-amber-200 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                Nenhuma variação usa [nome] — a mensagem não vai se personalizar.
              </p>
            ) : null}

            <div className="mt-4 divide-y divide-navy/5">
              {!list.length ? <p className="py-3 text-sm font-semibold text-slate-500">Nenhuma mensagem cadastrada.</p> : null}
              {list.map((template) => (
                <div key={template.id} className="py-3">
                  {editingId === template.id ? (
                    <div className="space-y-2">
                      <textarea
                        value={editText}
                        onChange={(event) => setEditText(event.target.value)}
                        maxLength={200}
                        className="min-h-[70px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold outline-none focus:border-brand"
                      />
                      <div className="flex flex-wrap items-center gap-2">
                        <span className={`text-xs font-bold ${editText.trim().length > 140 ? "text-red-600" : "text-muted"}`}>
                          {editText.trim().length}/140
                        </span>
                        <button
                          type="button"
                          onClick={() => saveEdit(template)}
                          disabled={busyId === template.id || !editText.trim() || editText.trim().length > 140}
                          className="premium-button-primary h-9 px-3 text-xs disabled:opacity-40"
                        >
                          Salvar
                        </button>
                        <button type="button" onClick={() => setEditingId("")} className="premium-button-secondary h-9 px-3 text-xs">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0 flex-1">
                        <p className="font-bold text-navy">{template.template}</p>
                        {template.is_default ? <p className="mt-1 text-[11px] font-black uppercase tracking-wide text-slate-400">Texto padrão</p> : null}
                      </div>
                      <div className="flex shrink-0 flex-wrap items-center gap-2">
                        <button
                          type="button"
                          onClick={() => onTest(resolveSampleText(template.template), pickAnimationForTest(trigger, trigger.animationMode))}
                          className="premium-button-secondary h-9 px-3 text-xs"
                        >
                          Testar
                        </button>
                        <button type="button" onClick={() => beginEdit(template)} className="premium-button-secondary h-9 px-3 text-xs">
                          Editar
                        </button>
                        <button
                          type="button"
                          role="switch"
                          aria-checked={template.active}
                          aria-label={template.active ? "Desativar mensagem" : "Ativar mensagem"}
                          onClick={() => toggleActive(template)}
                          disabled={busyId === template.id}
                          className={`relative h-6 w-11 shrink-0 rounded-full transition ${template.active ? "bg-brand" : "bg-slate-300"}`}
                        >
                          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white transition ${template.active ? "left-5" : "left-0.5"}`} />
                        </button>
                        <button
                          type="button"
                          onClick={() => removeTemplate(template)}
                          disabled={template.is_default || busyId === template.id}
                          title={template.is_default ? "Textos padrão não podem ser excluídos — desative ou use 'Restaurar padrão'." : ""}
                          className="premium-button-secondary h-9 px-3 text-xs text-red-700 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                          Excluir
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>

            <div className="mt-4 rounded-2xl border border-line bg-mist p-4">
              <p className="text-xs font-black text-navy">+ Adicionar variação</p>
              <textarea
                value={newTexts[trigger.key] || ""}
                onChange={(event) => setNewTexts((current) => ({ ...current, [trigger.key]: event.target.value }))}
                maxLength={200}
                placeholder="Ex.: Mandou bem, [nome]! 🎉"
                className="mt-2 min-h-[60px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold outline-none focus:border-brand"
              />
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <span className={`text-xs font-bold ${(newTexts[trigger.key] || "").trim().length > 140 ? "text-red-600" : "text-muted"}`}>
                  {(newTexts[trigger.key] || "").trim().length}/140
                </span>
                <button
                  type="button"
                  onClick={() => addVariation(trigger.key)}
                  disabled={busyId === `new:${trigger.key}` || !(newTexts[trigger.key] || "").trim() || (newTexts[trigger.key] || "").trim().length > 140}
                  className="premium-button-primary h-9 px-3 text-xs disabled:opacity-40"
                >
                  Adicionar
                </button>
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ManualDispatchSection({ brokers, triggers, templates, onTest }) {
  const [brokerId, setBrokerId] = useState("");
  const [mode, setMode] = useState("template");
  const [templateId, setTemplateId] = useState("");
  const [freeText, setFreeText] = useState("");
  const [animation, setAnimation] = useState("confete");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const labelByKey = useMemo(() => Object.fromEntries(triggers.map((trigger) => [trigger.key, trigger.label])), [triggers]);
  const activeTemplates = useMemo(() => templates.filter((template) => template.active), [templates]);
  const selectedTemplate = useMemo(() => activeTemplates.find((template) => template.id === templateId) || null, [activeTemplates, templateId]);
  const isLocked = mode === "template" && selectedTemplate?.trigger_key === "daily_goal_200";

  function currentMessage() {
    if (mode === "template") return selectedTemplate ? resolveSampleText(selectedTemplate.template) : "";
    return freeText.trim();
  }

  function currentAnimation() {
    return isLocked ? "combo_200" : animation;
  }

  function handleTest() {
    const message = currentMessage();
    if (!message) return;
    onTest(message, currentAnimation());
  }

  function resetForm() {
    setBrokerId("");
    setMode("template");
    setTemplateId("");
    setFreeText("");
    setAnimation("confete");
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setNotice("");
    if (!brokerId) {
      setError("Selecione um corretor.");
      return;
    }
    if (mode === "template" && !templateId) {
      setError("Selecione uma mensagem cadastrada.");
      return;
    }
    if (mode === "free" && (!freeText.trim() || freeText.trim().length > 140)) {
      setError("Digite uma mensagem livre de até 140 caracteres.");
      return;
    }

    setSubmitting(true);
    try {
      const body = { brokerId, animation: currentAnimation() };
      if (mode === "template") body.templateId = templateId;
      else body.freeText = freeText.trim();

      const response = await fetch("/api/celebrations/manual-dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível enviar o reconhecimento.");
      setNotice("Reconhecimento enviado.");
      resetForm();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
      <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Reconhecimentos</p>
      <h2 className="mt-2 text-2xl font-extrabold text-navy">Disparo manual</h2>

      {error ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p> : null}
      {notice ? <p className="mt-4 rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{notice}</p> : null}

      <form onSubmit={submit} className="mt-6 grid gap-4 sm:grid-cols-2">
        <label className="text-sm font-extrabold text-navy">
          Corretor
          <select
            value={brokerId}
            onChange={(event) => setBrokerId(event.target.value)}
            className="mt-2 h-11 w-full rounded-2xl border border-navy/15 px-3 text-sm font-bold text-navy outline-none focus:border-brand"
          >
            <option value="">Selecione</option>
            {brokers.map((broker) => (
              <option key={broker.id} value={broker.id}>{broker.name}</option>
            ))}
          </select>
        </label>

        <label className="text-sm font-extrabold text-navy">
          Tipo de mensagem
          <select
            value={mode}
            onChange={(event) => { setMode(event.target.value); setError(""); }}
            className="mt-2 h-11 w-full rounded-2xl border border-navy/15 px-3 text-sm font-bold text-navy outline-none focus:border-brand"
          >
            <option value="template">Mensagem cadastrada</option>
            <option value="free">Mensagem livre</option>
          </select>
        </label>

        {mode === "template" ? (
          <label className="text-sm font-extrabold text-navy sm:col-span-2">
            Mensagem
            <select
              value={templateId}
              onChange={(event) => setTemplateId(event.target.value)}
              className="mt-2 h-11 w-full rounded-2xl border border-navy/15 px-3 text-sm font-bold text-navy outline-none focus:border-brand"
            >
              <option value="">Selecione</option>
              {activeTemplates.map((template) => (
                <option key={template.id} value={template.id}>
                  {`${labelByKey[template.trigger_key] || template.trigger_key} — ${template.template}`}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label className="text-sm font-extrabold text-navy sm:col-span-2">
            Mensagem livre
            <textarea
              value={freeText}
              onChange={(event) => setFreeText(event.target.value)}
              maxLength={200}
              placeholder="Ex.: Parabéns pelo esforço hoje!"
              className="mt-2 min-h-[70px] w-full rounded-2xl border border-navy/15 px-3 py-2 text-sm font-bold text-navy outline-none focus:border-brand"
            />
            <span className={`mt-1 block text-xs font-bold ${freeText.trim().length > 140 ? "text-red-600" : "text-muted"}`}>
              {freeText.trim().length}/140
            </span>
          </label>
        )}

        <div className="text-sm font-extrabold text-navy">
          Animação
          {isLocked ? (
            <p className="mt-2 rounded-2xl border border-navy/15 bg-mist px-3 py-2.5 text-sm font-bold text-muted">Combo especial (fixo)</p>
          ) : (
            <select
              value={animation}
              onChange={(event) => setAnimation(event.target.value)}
              className="mt-2 h-11 w-full rounded-2xl border border-navy/15 px-3 text-sm font-bold text-navy outline-none focus:border-brand"
            >
              {BASE_ANIMATIONS.map((item) => (
                <option key={item} value={item}>{ANIMATION_LABELS[item]}</option>
              ))}
            </select>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
          <button type="button" onClick={handleTest} disabled={!currentMessage()} className="premium-button-secondary h-11 min-h-0 px-5 text-sm disabled:opacity-40">
            Testar
          </button>
          <button type="submit" disabled={submitting} className="premium-button-primary h-11 min-h-0 px-5 text-sm disabled:opacity-40">
            {submitting ? "Enviando..." : "Enviar agora"}
          </button>
        </div>
      </form>
    </article>
  );
}

function HistorySection({ brokers }) {
  const [filters, setFilters] = useState({ brokerId: "", startDate: "", endDate: "" });
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  async function load(currentFilters) {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (currentFilters.brokerId) params.set("brokerId", currentFilters.brokerId);
      if (currentFilters.startDate) params.set("startDate", currentFilters.startDate);
      if (currentFilters.endDate) params.set("endDate", currentFilters.endDate);
      const response = await fetch(`/api/celebrations/history?${params.toString()}`);
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload?.error || "Não foi possível carregar o histórico.");
      setHistory(payload.history || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    load({ brokerId: "", startDate: "", endDate: "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
      <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Reconhecimentos</p>
      <h2 className="mt-2 text-2xl font-extrabold text-navy">Histórico</h2>

      <div className="mt-5 flex flex-wrap items-end gap-3">
        <label className="text-xs font-black text-navy">
          Corretor
          <select
            value={filters.brokerId}
            onChange={(event) => setFilters((current) => ({ ...current, brokerId: event.target.value }))}
            className="mt-1 h-10 rounded-xl border border-line bg-white px-3 text-sm font-bold outline-none focus:border-brand"
          >
            <option value="">Todos</option>
            {brokers.map((broker) => (
              <option key={broker.id} value={broker.id}>{broker.name}</option>
            ))}
          </select>
        </label>
        <label className="text-xs font-black text-navy">
          De
          <input
            type="date"
            value={filters.startDate}
            onChange={(event) => setFilters((current) => ({ ...current, startDate: event.target.value }))}
            className="mt-1 h-10 rounded-xl border border-line bg-white px-3 text-sm font-bold outline-none focus:border-brand"
          />
        </label>
        <label className="text-xs font-black text-navy">
          Até
          <input
            type="date"
            value={filters.endDate}
            onChange={(event) => setFilters((current) => ({ ...current, endDate: event.target.value }))}
            className="mt-1 h-10 rounded-xl border border-line bg-white px-3 text-sm font-bold outline-none focus:border-brand"
          />
        </label>
        <button type="button" onClick={() => load(filters)} disabled={loading} className="premium-button-secondary h-10 px-4 text-xs">
          Aplicar filtro
        </button>
      </div>

      {error ? <p className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4 text-sm font-bold text-red-700">{error}</p> : null}
      {loading ? <p className="mt-4 text-sm font-bold text-muted">Carregando...</p> : null}
      {!loading && !history.length ? <p className="mt-4 text-sm font-bold text-muted">Nenhum registro encontrado.</p> : null}

      {!loading && history.length ? (
        <>
          <div className="mt-4 hidden overflow-x-auto md:block">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="border-b border-navy/10 text-xs font-black uppercase tracking-wide text-slate-500">
                  <th className="py-2 pr-3">Corretor</th>
                  <th className="py-2 pr-3">Gatilho</th>
                  <th className="py-2 pr-3">Mensagem</th>
                  <th className="py-2 pr-3">Animação</th>
                  <th className="py-2 pr-3">Origem</th>
                  <th className="py-2 pr-3">Quando</th>
                  <th className="py-2 pr-3">Visto</th>
                </tr>
              </thead>
              <tbody>
                {history.map((item) => (
                  <tr key={item.id} className="border-b border-navy/5">
                    <td className="py-2 pr-3 font-bold text-navy">{item.brokerName}</td>
                    <td className="py-2 pr-3 text-slate-600">{item.triggerLabel}</td>
                    <td className="max-w-xs truncate py-2 pr-3 text-slate-600" title={item.message}>{item.message}</td>
                    <td className="py-2 pr-3 text-slate-600">{ANIMATION_LABELS[item.animation] || item.animation}</td>
                    <td className="py-2 pr-3 text-slate-600">{SOURCE_LABELS[item.source] || item.source}</td>
                    <td className="py-2 pr-3 text-slate-600">{formatDateTimeSP(item.created_at)}</td>
                    <td className="py-2 pr-3 text-slate-600">{item.status === "shown" ? "Sim" : "Não"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="mt-4 grid gap-3 md:hidden">
            {history.map((item) => (
              <article key={item.id} className="rounded-2xl border border-line bg-white p-4 shadow-sm">
                <p className="text-xs font-black uppercase tracking-[0.14em] text-brand">{item.brokerName} · {item.triggerLabel}</p>
                <p className="mt-2 font-bold text-navy">{item.message}</p>
                <p className="mt-2 text-xs font-semibold text-slate-500">
                  {ANIMATION_LABELS[item.animation] || item.animation} · {SOURCE_LABELS[item.source] || item.source}
                </p>
                <p className="mt-1 text-xs font-semibold text-slate-500">
                  {formatDateTimeSP(item.created_at)} · Visto: {item.status === "shown" ? "Sim" : "Não"}
                </p>
              </article>
            ))}
          </div>
        </>
      ) : null}
    </article>
  );
}
