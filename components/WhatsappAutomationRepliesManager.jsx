"use client";

import { useState } from "react";
import { LoaderCircle, Plus, Save, Trash2 } from "lucide-react";

const EMPTY_DRAFT = { keyword: "", responseMessage: "", forwardToRoleta: false, active: true };

export default function WhatsappAutomationRepliesManager({ initialRules }) {
  const [rules, setRules] = useState(initialRules || []);
  const [busyId, setBusyId] = useState(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [newRule, setNewRule] = useState(EMPTY_DRAFT);
  const [creating, setCreating] = useState(false);

  function updateLocalRule(id, patch) {
    setRules((current) => current.map((rule) => (rule.id === id ? { ...rule, ...patch } : rule)));
  }

  async function saveRule(rule) {
    setBusyId(rule.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-master/automation-replies/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          keyword: rule.keyword,
          responseMessage: rule.responseMessage,
          forwardToRoleta: rule.forwardToRoleta,
          active: rule.active
        })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao salvar a regra.");
      updateLocalRule(rule.id, payload.rule);
      setMessage(`Regra "${payload.rule.keyword}" salva.`);
    } catch (saveError) {
      setError(saveError.message);
    } finally {
      setBusyId(null);
    }
  }

  async function toggleActive(rule) {
    const nextActive = !rule.active;
    updateLocalRule(rule.id, { active: nextActive });
    setBusyId(rule.id);
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-master/automation-replies/${rule.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: nextActive })
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao atualizar a regra.");
    } catch (toggleError) {
      updateLocalRule(rule.id, { active: rule.active });
      setError(toggleError.message);
    } finally {
      setBusyId(null);
    }
  }

  async function deleteRule(rule) {
    setBusyId(rule.id);
    setMessage("");
    setError("");
    try {
      const response = await fetch(`/api/admin/whatsapp-master/automation-replies/${rule.id}`, { method: "DELETE" });
      if (!response.ok) {
        const payload = await response.json().catch(() => ({}));
        throw new Error(payload.error || "Falha ao excluir a regra.");
      }
      setRules((current) => current.filter((item) => item.id !== rule.id));
      setMessage(`Regra "${rule.keyword}" excluída.`);
    } catch (deleteError) {
      setError(deleteError.message);
    } finally {
      setBusyId(null);
    }
  }

  async function createRule(event) {
    event.preventDefault();
    setCreating(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-master/automation-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRule)
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.error || "Falha ao criar a regra.");
      setRules((current) => [...current, payload.rule]);
      setNewRule(EMPTY_DRAFT);
      setMessage(`Regra "${payload.rule.keyword}" criada.`);
    } catch (createError) {
      setError(createError.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <section className="container-page mt-6 space-y-6 rounded-[28px] border border-line bg-white p-6 shadow-soft">
      <div>
        <p className="text-sm font-black uppercase tracking-[0.12em] text-navy">Respostas automáticas do WhatsApp</p>
        <p className="mt-1 text-sm text-muted">
          Quando um cliente responde uma mensagem de Disparo, o sistema compara o texto recebido com a palavra-chave de
          cada regra ativa (nessa ordem) e responde automaticamente. Use{" "}
          <code className="rounded bg-mist px-1.5 py-0.5 text-xs font-bold text-navy">{"{{link_simulacao}}"}</code> na
          mensagem pra inserir o link de simulação — se a regra encaminhar pra roleta, o link já sai apontando pro
          corretor que recebeu o cliente.
        </p>
      </div>

      {message ? <p className="rounded-2xl bg-emerald-50 px-4 py-3 font-bold text-emerald-800">{message}</p> : null}
      {error ? <p className="rounded-2xl bg-red-50 px-4 py-3 font-bold text-red-700">{error}</p> : null}

      <div className="space-y-4">
        {rules.length === 0 ? <p className="text-sm text-muted">Nenhuma regra cadastrada ainda.</p> : null}
        {rules.map((rule) => (
          <RuleRow
            key={rule.id}
            rule={rule}
            busy={busyId === rule.id}
            onChange={(patch) => updateLocalRule(rule.id, patch)}
            onSave={() => saveRule(rule)}
            onToggleActive={() => toggleActive(rule)}
            onDelete={() => deleteRule(rule)}
          />
        ))}
      </div>

      <form onSubmit={createRule} className="space-y-3 rounded-2xl border border-dashed border-line p-4">
        <p className="text-sm font-black text-navy">Nova regra</p>
        <div className="grid gap-3 md:grid-cols-[220px_1fr]">
          <label className="text-sm font-bold text-navy">
            Palavra-chave
            <input
              className="mt-1 w-full rounded-lg border border-line p-3 font-normal"
              value={newRule.keyword}
              onChange={(event) => setNewRule((current) => ({ ...current, keyword: event.target.value }))}
              placeholder="ex.: sim"
              required
            />
          </label>
          <label className="text-sm font-bold text-navy">
            Mensagem de resposta
            <textarea
              className="mt-1 w-full rounded-lg border border-line p-3 font-normal"
              rows={2}
              value={newRule.responseMessage}
              onChange={(event) => setNewRule((current) => ({ ...current, responseMessage: event.target.value }))}
              placeholder="ex.: Perfeito! Segue o link: {{link_simulacao}}"
              required
            />
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-bold text-navy">
            <input
              type="checkbox"
              checked={newRule.forwardToRoleta}
              onChange={(event) => setNewRule((current) => ({ ...current, forwardToRoleta: event.target.checked }))}
            />
            Encaminhar pra roleta
          </label>
          <button type="submit" disabled={creating} className="premium-button-primary">
            {creating ? <LoaderCircle className="h-5 w-5 animate-spin" /> : <Plus className="h-5 w-5" />}
            Criar regra
          </button>
        </div>
      </form>
    </section>
  );
}

function RuleRow({ rule, busy, onChange, onSave, onToggleActive, onDelete }) {
  return (
    <div className={`space-y-3 rounded-2xl border p-4 ${rule.active ? "border-line" : "border-line bg-mist/60 opacity-70"}`}>
      <div className="grid gap-3 md:grid-cols-[220px_1fr]">
        <label className="text-sm font-bold text-navy">
          Palavra-chave
          <input
            className="mt-1 w-full rounded-lg border border-line p-3 font-normal"
            value={rule.keyword}
            onChange={(event) => onChange({ keyword: event.target.value })}
          />
        </label>
        <label className="text-sm font-bold text-navy">
          Mensagem de resposta
          <textarea
            className="mt-1 w-full rounded-lg border border-line p-3 font-normal"
            rows={2}
            value={rule.responseMessage}
            onChange={(event) => onChange({ responseMessage: event.target.value })}
          />
        </label>
      </div>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex flex-wrap items-center gap-4">
          <label className="flex items-center gap-2 text-sm font-bold text-navy">
            <input type="checkbox" checked={rule.forwardToRoleta} onChange={(event) => onChange({ forwardToRoleta: event.target.checked })} />
            Encaminhar pra roleta
          </label>
          <label className="flex items-center gap-2 text-sm font-bold text-navy">
            <input type="checkbox" checked={rule.active} onChange={onToggleActive} disabled={busy} />
            Ativa
          </label>
          <span className="text-xs text-muted">Disparada {rule.triggeredCount || 0}x</span>
        </div>
        <div className="flex items-center gap-2">
          <button type="button" onClick={onSave} disabled={busy} className="premium-button-secondary">
            {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
            Salvar
          </button>
          <button type="button" onClick={onDelete} disabled={busy} className="premium-button-secondary text-red-700">
            <Trash2 className="h-4 w-4" />
            Excluir
          </button>
        </div>
      </div>
    </div>
  );
}
