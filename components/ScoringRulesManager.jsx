"use client";

import { useMemo, useState } from "react";
import { ChevronDown, ChevronUp, Minus, Plus } from "lucide-react";

const DATE_TIME_FORMATTER = new Intl.DateTimeFormat("pt-BR", {
  timeZone: "America/Sao_Paulo",
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit"
});

export default function ScoringRulesManager({
  canEdit = false,
  initialAdjustments = [],
  initialBrokers = [],
  initialError = "",
  initialHistory = [],
  initialRules = []
}) {
  const [rules, setRules] = useState(initialRules);
  const [draft, setDraft] = useState(() => buildDraft(initialRules));
  const [history, setHistory] = useState(initialHistory);
  const [adjustments, setAdjustments] = useState(initialAdjustments);
  const [error, setError] = useState(initialError);
  const [notice, setNotice] = useState("");
  const [saving, setSaving] = useState(false);
  const [showRuleHistory, setShowRuleHistory] = useState(false);
  const [showAdjustments, setShowAdjustments] = useState(false);

  const [adjustBrokerId, setAdjustBrokerId] = useState("");
  const [adjustType, setAdjustType] = useState("add");
  const [adjustPoints, setAdjustPoints] = useState("");
  const [adjustReason, setAdjustReason] = useState("");
  const [pendingRemoval, setPendingRemoval] = useState(null);
  const [adjustSubmitting, setAdjustSubmitting] = useState(false);

  const dirty = useMemo(() => (
    rules.some((rule) => {
      const value = draft[rule.key];
      return value && (value.points !== rule.points || value.active !== rule.active);
    })
  ), [rules, draft]);

  const summary = useMemo(() => {
    const activeCount = rules.filter((rule) => rule.active).length;
    const top = [...rules].sort((a, b) => b.points - a.points)[0];
    const lastChange = rules
      .map((rule) => rule.effectiveFrom)
      .filter(Boolean)
      .sort()
      .at(-1);
    return { activeCount, top, lastChange };
  }, [rules]);

  function updateDraft(key, patch) {
    setDraft((current) => ({ ...current, [key]: { ...current[key], ...patch } }));
  }

  function adjustPointsValue(key, delta) {
    const current = draft[key]?.points ?? 0;
    updateDraft(key, { points: Math.max(0, current + delta) });
  }

  function handlePointsInput(key, rawValue) {
    const parsed = Number(rawValue);
    if (rawValue === "" || Number.isNaN(parsed)) {
      updateDraft(key, { points: 0 });
      return;
    }
    updateDraft(key, { points: Math.max(0, Math.trunc(parsed)) });
  }

  async function saveChanges() {
    setSaving(true);
    setError("");
    setNotice("");

    const changed = rules.filter((rule) => {
      const value = draft[rule.key];
      return value && (value.points !== rule.points || value.active !== rule.active);
    });

    try {
      let latestRules = rules;
      for (const rule of changed) {
        const response = await fetch("/api/scoring-rules", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ ruleKey: rule.key, points: draft[rule.key].points, active: draft[rule.key].active })
        });
        const payload = await response.json();
        if (!response.ok) throw new Error(payload?.error || "Não foi possível salvar a pontuação.");
        latestRules = payload.rules;
      }

      setRules(latestRules);
      setDraft(buildDraft(latestRules));
      setNotice("Configuração de pontuação atualizada.");
      refreshHistory();
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar a pontuação.");
    } finally {
      setSaving(false);
    }
  }

  async function refreshHistory() {
    try {
      const response = await fetch("/api/scoring-rules/history");
      const payload = await response.json();
      if (response.ok) setHistory(payload.history);
    } catch {
      // silencioso: histórico é auxiliar, não bloqueia o fluxo principal
    }
  }

  async function refreshAdjustments() {
    try {
      const response = await fetch("/api/scoring-adjustments");
      const payload = await response.json();
      if (response.ok) setAdjustments(payload.adjustments);
    } catch {
      // idem
    }
  }

  function submitAdjustment(event) {
    event.preventDefault();
    if (!adjustBrokerId || !adjustPoints || !adjustReason.trim()) return;

    if (adjustType === "remove") {
      setPendingRemoval({ brokerId: adjustBrokerId, points: Math.abs(Number(adjustPoints)), reason: adjustReason.trim() });
      return;
    }

    confirmAdjustment({ brokerId: adjustBrokerId, type: "add", points: Math.abs(Number(adjustPoints)), reason: adjustReason.trim() });
  }

  async function confirmAdjustment({ brokerId, type, points, reason }) {
    setAdjustSubmitting(true);
    setError("");
    setNotice("");

    try {
      const response = await fetch("/api/scoring-adjustments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ brokerId, type, points, reason })
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload?.error || "Não foi possível registrar o ajuste.");

      setNotice("Ajuste manual registrado.");
      setAdjustBrokerId("");
      setAdjustPoints("");
      setAdjustReason("");
      setPendingRemoval(null);
      refreshAdjustments();
    } catch (adjustError) {
      setError(adjustError.message || "Não foi possível registrar o ajuste.");
    } finally {
      setAdjustSubmitting(false);
    }
  }

  return (
    <section className="container-page space-y-6">
      {error && (
        <div className="rounded-3xl border border-red-200 bg-red-50 p-5 text-sm font-bold text-red-700">{error}</div>
      )}
      {notice && (
        <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-4 text-sm font-bold text-emerald-700">{notice}</div>
      )}

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Regras ativas" value={summary.activeCount} />
        <SummaryCard
          label="Maior pontuação"
          value={summary.top ? `${summary.top.points} pts` : "—"}
          hint={summary.top?.label}
        />
        <SummaryCard
          label="Última alteração"
          value={summary.lastChange ? formatDateTime(summary.lastChange) : "—"}
        />
      </div>

      <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Configuração de pontos</p>
            <h2 className="mt-2 text-2xl font-extrabold text-navy">Defina quantos pontos cada atividade gera no ranking</h2>
          </div>
          {canEdit && (
            <button
              type="button"
              onClick={saveChanges}
              disabled={!dirty || saving}
              className="inline-flex min-h-11 items-center rounded-full bg-navy px-5 text-sm font-extrabold text-white transition disabled:opacity-40"
            >
              {saving ? "Salvando..." : "Salvar alterações"}
            </button>
          )}
        </div>

        <div className="mt-6 divide-y divide-navy/5">
          {rules.map((rule) => {
            const value = draft[rule.key] || { points: rule.points, active: rule.active };
            return (
              <div key={rule.key} className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="min-w-0">
                  <p className="font-extrabold text-navy">{rule.label}</p>
                  <p className="text-xs font-semibold text-slate-500">{rule.description}</p>
                </div>

                <div className="flex items-center gap-3">
                  <div className="flex items-center gap-1 rounded-2xl border border-navy/10 px-1">
                    <button
                      type="button"
                      onClick={() => adjustPointsValue(rule.key, -1)}
                      disabled={!canEdit}
                      className="grid size-8 place-items-center rounded-xl text-navy transition hover:bg-blue-50 disabled:opacity-30"
                      aria-label={`Diminuir pontos de ${rule.label}`}
                    >
                      <Minus size={14} />
                    </button>
                    <input
                      type="number"
                      min={0}
                      step={1}
                      value={value.points}
                      onChange={(event) => handlePointsInput(rule.key, event.target.value)}
                      disabled={!canEdit}
                      className="w-16 border-0 bg-transparent text-center text-lg font-black text-navy outline-none disabled:opacity-70"
                    />
                    <button
                      type="button"
                      onClick={() => adjustPointsValue(rule.key, 1)}
                      disabled={!canEdit}
                      className="grid size-8 place-items-center rounded-xl text-navy transition hover:bg-blue-50 disabled:opacity-30"
                      aria-label={`Aumentar pontos de ${rule.label}`}
                    >
                      <Plus size={14} />
                    </button>
                  </div>

                  <button
                    type="button"
                    onClick={() => canEdit && updateDraft(rule.key, { active: !value.active })}
                    disabled={!canEdit}
                    className={`min-h-9 rounded-full border px-4 text-xs font-extrabold uppercase tracking-[0.08em] transition disabled:cursor-default ${
                      value.active ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-100 text-slate-500"
                    }`}
                  >
                    {value.active ? "Ativa" : "Inativa"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      </article>

      {canEdit && (
        <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
          <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Ajuste manual</p>
          <h2 className="mt-2 text-2xl font-extrabold text-navy">Adicionar ou remover pontos de um corretor</h2>

          <form onSubmit={submitAdjustment} className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <label className="text-sm font-extrabold text-navy">
              Corretor
              <select
                value={adjustBrokerId}
                onChange={(event) => setAdjustBrokerId(event.target.value)}
                className="mt-2 h-11 w-full rounded-2xl border border-navy/15 px-3 text-sm font-bold text-navy outline-none focus:border-brand"
              >
                <option value="">Selecione</option>
                {initialBrokers.map((broker) => (
                  <option key={broker.id} value={broker.id}>{broker.name}</option>
                ))}
              </select>
            </label>

            <label className="text-sm font-extrabold text-navy">
              Tipo
              <select
                value={adjustType}
                onChange={(event) => setAdjustType(event.target.value)}
                className="mt-2 h-11 w-full rounded-2xl border border-navy/15 px-3 text-sm font-bold text-navy outline-none focus:border-brand"
              >
                <option value="add">Adicionar pontos</option>
                <option value="remove">Remover pontos</option>
              </select>
            </label>

            <label className="text-sm font-extrabold text-navy">
              Quantidade
              <input
                type="number"
                min={1}
                step={1}
                value={adjustPoints}
                onChange={(event) => setAdjustPoints(event.target.value)}
                className="mt-2 h-11 w-full rounded-2xl border border-navy/15 px-3 text-sm font-bold text-navy outline-none focus:border-brand"
              />
            </label>

            <label className="text-sm font-extrabold text-navy xl:col-span-1">
              Motivo
              <input
                type="text"
                value={adjustReason}
                onChange={(event) => setAdjustReason(event.target.value)}
                placeholder="Ex.: Campanha de prospecção especial"
                className="mt-2 h-11 w-full rounded-2xl border border-navy/15 px-3 text-sm font-bold text-navy outline-none focus:border-brand"
              />
            </label>

            <div className="sm:col-span-2 xl:col-span-4">
              <button
                type="submit"
                disabled={adjustSubmitting || !adjustBrokerId || !adjustPoints || !adjustReason.trim()}
                className="inline-flex min-h-11 items-center rounded-full bg-navy px-5 text-sm font-extrabold text-white transition disabled:opacity-40"
              >
                Confirmar ajuste
              </button>
            </div>
          </form>

          {pendingRemoval && (
            <div className="mt-4 rounded-2xl border border-red-200 bg-red-50 p-4">
              <p className="font-extrabold text-red-800">
                Remover {pendingRemoval.points} pontos de {brokerName(initialBrokers, pendingRemoval.brokerId)}?
              </p>
              <p className="mt-1 text-sm text-red-700">Motivo: {pendingRemoval.reason}</p>
              <div className="mt-3 flex gap-3">
                <button
                  type="button"
                  onClick={() => setPendingRemoval(null)}
                  className="min-h-9 rounded-full border border-red-200 bg-white px-4 text-sm font-extrabold text-red-700"
                >
                  Cancelar
                </button>
                <button
                  type="button"
                  onClick={() => confirmAdjustment({ ...pendingRemoval, type: "remove" })}
                  disabled={adjustSubmitting}
                  className="min-h-9 rounded-full bg-red-700 px-4 text-sm font-extrabold text-white disabled:opacity-50"
                >
                  Confirmar remoção
                </button>
              </div>
            </div>
          )}
        </article>
      )}

      <article className="rounded-[28px] border border-navy/10 bg-white p-5 shadow-soft md:p-7">
        <p className="text-xs font-extrabold uppercase tracking-[0.35em] text-brand">Histórico</p>

        <CollapsibleSection
          title="Alterações das regras"
          open={showRuleHistory}
          onToggle={() => setShowRuleHistory((current) => !current)}
        >
          {!history.length && <EmptyRow>Nenhuma alteração registrada.</EmptyRow>}
          {history.map((entry) => (
            <div key={entry.id} className="flex flex-col gap-1 border-b border-navy/5 py-3 text-sm last:border-0 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-extrabold text-navy">{entry.ruleLabel}</p>
                <p className="text-xs font-semibold text-slate-500">{entry.changedByName} · {formatDateTime(entry.effectiveFrom)}</p>
              </div>
              <p className="font-extrabold text-brand">{entry.active ? `${entry.points} pts` : "Desativada"}</p>
            </div>
          ))}
        </CollapsibleSection>

        <CollapsibleSection
          title="Ajustes manuais"
          open={showAdjustments}
          onToggle={() => setShowAdjustments((current) => !current)}
        >
          {!adjustments.length && <EmptyRow>Nenhum ajuste manual registrado.</EmptyRow>}
          {adjustments.map((adjustment) => (
            <div key={adjustment.id} className="flex flex-col gap-1 border-b border-navy/5 py-3 text-sm last:border-0 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <p className="font-extrabold text-navy">{adjustment.brokerName}</p>
                <p className="text-xs font-semibold text-slate-500">{adjustment.reason}</p>
                <p className="text-xs font-semibold text-slate-400">{formatDateTime(adjustment.createdAt)} · por {adjustment.createdByName}</p>
              </div>
              <p className={`font-extrabold ${adjustment.points >= 0 ? "text-emerald-700" : "text-red-700"}`}>
                {adjustment.points >= 0 ? "+" : ""}{adjustment.points} pts
              </p>
            </div>
          ))}
        </CollapsibleSection>
      </article>
    </section>
  );
}

function buildDraft(rules) {
  return Object.fromEntries(rules.map((rule) => [rule.key, { points: rule.points, active: rule.active }]));
}

function brokerName(brokers, id) {
  return brokers.find((broker) => broker.id === id)?.name || "corretor selecionado";
}

function SummaryCard({ label, value, hint = "" }) {
  return (
    <article className="rounded-2xl border border-navy/10 bg-white p-4 shadow-soft">
      <p className="text-xs font-extrabold uppercase tracking-[0.1em] text-slate-500">{label}</p>
      <p className="mt-2 text-2xl font-extrabold text-navy">{value}</p>
      {hint && <p className="text-xs font-semibold text-slate-500">{hint}</p>}
    </article>
  );
}

function CollapsibleSection({ title, open, onToggle, children }) {
  return (
    <div className="mt-4 border-t border-navy/5 pt-4 first:mt-2 first:border-0 first:pt-0">
      <button
        type="button"
        onClick={onToggle}
        className="flex w-full items-center justify-between text-left text-sm font-extrabold text-navy"
      >
        {title}
        {open ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
      </button>
      {open && <div className="mt-2">{children}</div>}
    </div>
  );
}

function EmptyRow({ children }) {
  return <p className="py-3 text-sm font-semibold text-slate-500">{children}</p>;
}

function formatDateTime(value) {
  if (!value) return "";
  return DATE_TIME_FORMATTER.format(new Date(value));
}
