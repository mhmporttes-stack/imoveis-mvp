"use client";

import { useEffect, useState } from "react";
import { Pencil, Plus, Trash2 } from "lucide-react";
import { residencePolicyInstruction } from "@/lib/document-ai-rule-core.mjs";

const categories = ["Identificação", "Renda", "Comprovante de residência", "Estado civil", "FGTS", "IR", "PIS", "Financiamento", "Outras"];
const policyLabels = { titular_only: "Somente titular", third_party_allowed: "Terceiro permitido", validation: "Validar manualmente" };

export default function DocumentAiRulesManager({ initialRules }) {
  const [rules, setRules] = useState(initialRules);
  const [editing, setEditing] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const empty = () => ({ category: "", title: "", instruction: new URLSearchParams(window.location.search).get("interpretation") || "", active: true });

  useEffect(() => {
    if (new URLSearchParams(window.location.search).has("interpretation")) setEditing(empty());
  }, []);

  async function request(url, method, body) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method, headers: { "Content-Type": "application/json" }, ...(body ? { body: JSON.stringify(body) } : {}) });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      const refresh = await fetch("/api/admin/document-ai-rules");
      if (!refresh.ok) throw new Error("Não foi possível atualizar as regras.");
      setRules((await refresh.json()).rules);
      setEditing(null);
    } catch (caught) { setError(caught.message); }
    finally { setBusy(false); }
  }

  function save(event) {
    event.preventDefault();
    const payload = editing.ruleKey === "residence_income_ownership" ? { ...editing, instruction: residencePolicyInstruction(editing.policy) } : editing;
    request(editing.id ? `/api/admin/document-ai-rules/${editing.id}` : "/api/admin/document-ai-rules", editing.id ? "PATCH" : "POST", payload);
  }

  return <section className="container-page pb-12">
    <div className="rounded-2xl border border-line bg-white p-4 shadow-sm sm:p-6">
      <div className="flex items-center justify-between gap-3"><p className="text-sm text-muted">As regras ativas entram na próxima análise documental.</p><button type="button" className="premium-button-primary px-4 py-2 text-sm" onClick={() => setEditing(empty())}><Plus className="h-4 w-4" /> Nova regra</button></div>
      {error ? <p role="alert" className="mt-3 text-sm text-red-700">{error}</p> : null}
      {editing ? <form onSubmit={save} className="mt-5 grid gap-3 rounded-xl border border-line bg-mist/50 p-4">
        <h2 className="font-black text-navy">{editing.id ? "Editar regra" : "Nova regra"}</h2>
        <label className="text-sm font-bold text-navy">Categoria<input list="document-ai-categories" required maxLength={100} className="mt-1 w-full rounded-lg border border-line bg-white p-2" value={editing.category} onChange={(event) => setEditing({ ...editing, category: event.target.value })} /></label>
        <datalist id="document-ai-categories">{categories.map((category) => <option key={category} value={category} />)}</datalist>
        <label className="text-sm font-bold text-navy">Título<input required maxLength={120} className="mt-1 w-full rounded-lg border border-line bg-white p-2" value={editing.title} onChange={(event) => setEditing({ ...editing, title: event.target.value })} /></label>
        {editing.ruleKey === "residence_income_ownership" ? <div className="grid gap-2 sm:grid-cols-3">{[["self_employed_unregistered", "Renda informal"], ["registered_employment", "CLT"], ["income_tax_declarant", "Declara IR"]].map(([key, label]) => <label key={key} className="text-sm font-bold text-navy">{label}<select className="mt-1 w-full rounded-lg border border-line bg-white p-2" value={editing.policy?.[key] || "validation"} onChange={(event) => setEditing({ ...editing, policy: { ...editing.policy, [key]: event.target.value } })}>{Object.entries(policyLabels).map(([value, text]) => <option key={value} value={value}>{text}</option>)}</select></label>)}</div> : <label className="text-sm font-bold text-navy">Instrução para a IA<textarea required rows={4} maxLength={3000} className="mt-1 w-full rounded-lg border border-line bg-white p-2" value={editing.instruction} onChange={(event) => setEditing({ ...editing, instruction: event.target.value })} /></label>}
        <label className="flex items-center gap-2 text-sm font-bold text-navy"><input type="checkbox" checked={editing.active} onChange={(event) => setEditing({ ...editing, active: event.target.checked })} /> Ativa</label>
        <div className="flex gap-2"><button disabled={busy} className="premium-button-primary px-4 py-2 text-sm">Salvar</button><button type="button" className="premium-button-secondary px-4 py-2 text-sm" onClick={() => setEditing(null)}>Cancelar</button></div>
      </form> : null}
      <div className="mt-5 space-y-4">{[...new Set(rules.map((rule) => rule.category))].map((category) => <div key={category}><h2 className="mb-2 text-sm font-black text-navy">{category}</h2><div className="space-y-2">{rules.filter((rule) => rule.category === category).map((rule) => <div key={rule.id} className="flex flex-wrap items-center gap-3 rounded-xl border border-line p-3"><div className="min-w-0 flex-1"><p className="font-bold text-navy">{rule.title} <span className={`ml-1 text-xs ${rule.active ? "text-emerald-700" : "text-muted"}`}>{rule.active ? "Ativa" : "Inativa"}</span></p><p className="text-xs text-muted">{rule.instruction}</p></div><button type="button" disabled={busy} className="client-action-button" onClick={() => request(`/api/admin/document-ai-rules/${rule.id}`, "PATCH", { ...rule, active: !rule.active })}>{rule.active ? "Desativar" : "Ativar"}</button><button type="button" className="client-action-button" aria-label={`Editar ${rule.title}`} onClick={() => setEditing({ ...rule })}><Pencil className="h-4 w-4" /></button><button type="button" className="client-action-button text-red-700" aria-label={`Excluir ${rule.title}`} onClick={() => { if (confirm(`Excluir a regra ${rule.title}?`)) request(`/api/admin/document-ai-rules/${rule.id}`, "DELETE"); }}><Trash2 className="h-4 w-4" /></button></div>)}</div></div>)}</div>
    </div>
  </section>;
}
