"use client";

import { useState } from "react";
import { LoaderCircle, Pencil, Plus, Power, Trash2 } from "lucide-react";

export default function CcaStatusStagesManager({ initialStages }) {
  const [list, setList] = useState(initialStages || []);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function reload() {
    const response = await fetch("/api/admin/cca-status-stages");
    const data = await response.json().catch(() => ({}));
    if (response.ok) setList(data.stages || []);
  }

  async function handleSave(payload) {
    setBusy("save");
    setError("");
    try {
      const url = editing ? `/api/admin/cca-status-stages/${editing.id}` : "/api/admin/cca-status-stages";
      const response = await fetch(url, {
        method: editing ? "PATCH" : "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      setShowForm(false);
      setEditing(null);
      await reload();
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar.");
    } finally {
      setBusy("");
    }
  }

  async function toggleActive(stage) {
    setBusy(stage.id);
    try {
      const response = await fetch(`/api/admin/cca-status-stages/${stage.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !stage.active })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      await reload();
    } catch (toggleError) {
      setError(toggleError.message || "Não foi possível atualizar.");
    } finally {
      setBusy("");
    }
  }

  async function handleDelete(stage) {
    if (!confirm(`Remover "${stage.label}"? Se já houver histórico usando esse status, ele só será desativado.`)) return;
    setBusy(stage.id);
    try {
      const response = await fetch(`/api/admin/cca-status-stages/${stage.id}`, { method: "DELETE" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      await reload();
    } catch (deleteError) {
      setError(deleteError.message || "Não foi possível remover.");
    } finally {
      setBusy("");
    }
  }

  return (
    <section className="container-page space-y-6">
      <div className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-xl font-black text-navy">Status de acompanhamento na CCA</h2>
            <p className="mt-1 text-sm font-bold text-muted">Lista de sub-status usada no acompanhamento de aprovação depois do envio à CCA. Adicione novos sem precisar de código.</p>
          </div>
          <button
            type="button"
            className="premium-button-primary"
            onClick={() => { setEditing(null); setShowForm(true); }}
          >
            <Plus className="h-4 w-4" /> Novo status
          </button>
        </div>

        {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {list.map((stage) => (
            <div key={stage.id} className={`rounded-2xl border p-4 ${stage.active ? "border-line" : "border-line bg-mist/40 opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-black text-navy">{stage.label}</p>
                  <p className="text-xs font-bold text-muted">Ordem: {stage.sortOrder}</p>
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${stage.active ? "bg-emerald-50 text-emerald-700" : "bg-mist text-muted"}`}>
                  {stage.active ? "Ativo" : "Inativo"}
                </span>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy === stage.id} className="client-action-button" onClick={() => { setEditing(stage); setShowForm(true); }}>
                  <Pencil className="h-4 w-4" /> Editar
                </button>
                <button type="button" disabled={busy === stage.id} className="client-action-button" onClick={() => toggleActive(stage)}>
                  <Power className="h-4 w-4" /> {stage.active ? "Desativar" : "Ativar"}
                </button>
                <button type="button" disabled={busy === stage.id} className="client-action-button text-red-700" onClick={() => handleDelete(stage)}>
                  <Trash2 className="h-4 w-4" /> Remover
                </button>
              </div>
            </div>
          ))}
          {!list.length ? <p className="rounded-2xl border border-line p-6 text-center text-sm font-bold text-muted sm:col-span-2">Nenhum status cadastrado ainda.</p> : null}
        </div>
      </div>

      {showForm ? (
        <StageForm
          initial={editing}
          busy={busy === "save"}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSave={handleSave}
        />
      ) : null}
    </section>
  );
}

function StageForm({ initial, busy, onCancel, onSave }) {
  const [label, setLabel] = useState(initial?.label || "");
  const [sortOrder, setSortOrder] = useState(initial?.sortOrder ?? 100);

  function handleSubmit(event) {
    event.preventDefault();
    onSave({ label, sortOrder: Number(sortOrder) || 100 });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
      <h3 className="text-lg font-black text-navy">{initial ? "Editar status" : "Novo status"}</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold text-navy">
          Nome do status
          <input className="mt-1 w-full rounded-lg border border-line p-3 font-normal" value={label} onChange={(e) => setLabel(e.target.value)} required />
        </label>
        <label className="text-sm font-bold text-navy">
          Ordem de exibição
          <input className="mt-1 w-full rounded-lg border border-line p-3 font-normal" type="number" value={sortOrder} onChange={(e) => setSortOrder(e.target.value)} />
        </label>
      </div>
      <div className="mt-4 flex gap-2">
        <button type="button" className="premium-button-secondary" onClick={onCancel}>Cancelar</button>
        <button type="submit" disabled={busy} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} Salvar
        </button>
      </div>
    </form>
  );
}
