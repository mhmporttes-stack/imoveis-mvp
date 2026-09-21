"use client";

import { useState } from "react";
import { LoaderCircle, Pencil, Plus, Power, Trash2 } from "lucide-react";

export default function CcaManager({ initialCca }) {
  const [list, setList] = useState(initialCca || []);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");

  async function reload() {
    const response = await fetch("/api/admin/cca");
    const data = await response.json().catch(() => ({}));
    if (response.ok) setList(data.cca || []);
  }

  async function handleSave(payload) {
    setBusy("save");
    setError("");
    try {
      const url = editing ? `/api/admin/cca/${editing.id}` : "/api/admin/cca";
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

  async function toggleActive(cca) {
    setBusy(cca.id);
    try {
      const response = await fetch(`/api/admin/cca/${cca.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ active: !cca.active })
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

  async function handleDelete(cca) {
    if (!confirm(`Remover "${cca.name}"? Se já houver envios registrados, ela só será desativada.`)) return;
    setBusy(cca.id);
    try {
      const response = await fetch(`/api/admin/cca/${cca.id}`, { method: "DELETE" });
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
            <h2 className="text-xl font-black text-navy">Correspondentes bancárias (CCA)</h2>
            <p className="mt-1 text-sm font-bold text-muted">Usadas para receber a documentação de clientes para análise. Nunca entram em ranking, meta diária, roleta ou funil.</p>
          </div>
          <button
            type="button"
            className="premium-button-primary"
            onClick={() => { setEditing(null); setShowForm(true); }}
          >
            <Plus className="h-4 w-4" /> Nova CCA
          </button>
        </div>

        {error ? <p className="mt-4 rounded-2xl bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {list.map((cca) => (
            <div key={cca.id} className={`rounded-2xl border p-4 ${cca.active ? "border-line" : "border-line bg-mist/40 opacity-70"}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-black text-navy">{cca.name}</p>
                  {cca.companyName ? <p className="text-xs font-bold text-muted">{cca.companyName}</p> : null}
                </div>
                <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-black ${cca.active ? "bg-emerald-50 text-emerald-700" : "bg-mist text-muted"}`}>
                  {cca.active ? "Ativa" : "Inativa"}
                </span>
              </div>
              <p className="mt-2 text-sm font-bold text-navy">{cca.whatsapp}</p>
              {cca.email ? <p className="text-xs text-muted">{cca.email}</p> : null}
              {cca.notes ? <p className="mt-1 text-xs text-muted">{cca.notes}</p> : null}
              <div className="mt-3 flex flex-wrap gap-2">
                <button type="button" disabled={busy === cca.id} className="client-action-button" onClick={() => { setEditing(cca); setShowForm(true); }}>
                  <Pencil className="h-4 w-4" /> Editar
                </button>
                <button type="button" disabled={busy === cca.id} className="client-action-button" onClick={() => toggleActive(cca)}>
                  <Power className="h-4 w-4" /> {cca.active ? "Desativar" : "Ativar"}
                </button>
                <button type="button" disabled={busy === cca.id} className="client-action-button text-red-700" onClick={() => handleDelete(cca)}>
                  <Trash2 className="h-4 w-4" /> Remover
                </button>
              </div>
            </div>
          ))}
          {!list.length ? <p className="rounded-2xl border border-line p-6 text-center text-sm font-bold text-muted sm:col-span-2">Nenhuma CCA cadastrada ainda.</p> : null}
        </div>
      </div>

      {showForm ? (
        <CcaForm
          initial={editing}
          busy={busy === "save"}
          onCancel={() => { setShowForm(false); setEditing(null); }}
          onSave={handleSave}
        />
      ) : null}
    </section>
  );
}

function CcaForm({ initial, busy, onCancel, onSave }) {
  const [name, setName] = useState(initial?.name || "");
  const [companyName, setCompanyName] = useState(initial?.companyName || "");
  const [whatsapp, setWhatsapp] = useState(initial?.whatsapp || "");
  const [email, setEmail] = useState(initial?.email || "");
  const [notes, setNotes] = useState(initial?.notes || "");

  function handleSubmit(event) {
    event.preventDefault();
    onSave({ name, companyName, whatsapp, email, notes });
  }

  return (
    <form onSubmit={handleSubmit} className="rounded-[28px] border border-line bg-white p-6 shadow-soft">
      <h3 className="text-lg font-black text-navy">{initial ? "Editar CCA" : "Nova CCA"}</h3>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <label className="text-sm font-bold text-navy">
          Nome da correspondente
          <input className="mt-1 w-full rounded-lg border border-line p-3 font-normal" value={name} onChange={(e) => setName(e.target.value)} required />
        </label>
        <label className="text-sm font-bold text-navy">
          Empresa/CCA (opcional)
          <input className="mt-1 w-full rounded-lg border border-line p-3 font-normal" value={companyName} onChange={(e) => setCompanyName(e.target.value)} />
        </label>
        <label className="text-sm font-bold text-navy">
          WhatsApp
          <input className="mt-1 w-full rounded-lg border border-line p-3 font-normal" placeholder="(00) 00000-0000" value={whatsapp} onChange={(e) => setWhatsapp(e.target.value)} required />
        </label>
        <label className="text-sm font-bold text-navy">
          E-mail (opcional)
          <input className="mt-1 w-full rounded-lg border border-line p-3 font-normal" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
        </label>
      </div>
      <label className="mt-3 block text-sm font-bold text-navy">
        Observações
        <textarea className="mt-1 w-full rounded-lg border border-line p-3 font-normal" rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
      </label>
      <div className="mt-4 flex gap-2">
        <button type="button" className="premium-button-secondary" onClick={onCancel}>Cancelar</button>
        <button type="submit" disabled={busy} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} Salvar
        </button>
      </div>
    </form>
  );
}
