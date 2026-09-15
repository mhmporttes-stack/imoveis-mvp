"use client";
import { useEffect, useState } from "react";

const TYPE_FILTERS = [
  { key: "all", label: "Todos" },
  { key: "biblical", label: "Bíblicos" },
  { key: "reflection", label: "Reflexivos" }
];
const STATUS_FILTERS = [
  { key: "all", label: "Todos" },
  { key: "active", label: "Ativos" },
  { key: "inactive", label: "Inativos" }
];
const EMPTY_FORM = { editorialId: "", type: "biblical", mainText: "", sourceText: "", openingMessage: "" };

export default function DailyMessageLibrary() {
  const [cards, setCards] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("all");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState("");
  const [form, setForm] = useState(EMPTY_FORM);
  const [busy, setBusy] = useState(false);

  async function load() {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ search, type: typeFilter, status: statusFilter });
      const response = await fetch(`/api/daily-message/cards?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível carregar os cards.");
      setCards(data.cards || []);
    } catch (loadError) {
      setError(loadError.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const timeout = setTimeout(load, 250);
    return () => clearTimeout(timeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [search, typeFilter, statusFilter]);

  function beginCreate() {
    setEditingId("");
    setForm(EMPTY_FORM);
    setShowForm(true);
  }

  function beginEdit(card) {
    setEditingId(card.id);
    setForm({ editorialId: card.editorialId, type: card.type, mainText: card.mainText, sourceText: card.sourceText, openingMessage: card.openingMessage });
    setShowForm(true);
  }

  async function submitForm(event) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const response = editingId
        ? await fetch(`/api/daily-message/cards/${editingId}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) })
        : await fetch("/api/daily-message/cards", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(form) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar o card.");
      setMessage(editingId ? "Card atualizado." : "Card criado.");
      setShowForm(false);
      await load();
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive(card) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(`/api/daily-message/cards/${card.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ active: !card.active }) });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível atualizar o card.");
      setCards((current) => current.map((item) => (item.id === card.id ? data.card : item)));
    } catch (toggleError) {
      setError(toggleError.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-[24px] border border-line bg-white p-6 shadow-soft">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-xl font-black text-navy">Biblioteca de cards</h3>
          <p className="text-sm text-muted">{cards.length} card{cards.length === 1 ? "" : "s"} nesta seleção.</p>
        </div>
        <button type="button" onClick={beginCreate} className="premium-button-primary">Novo card</button>
      </div>

      <div className="mt-5 flex flex-wrap gap-2">
        <input
          className="h-10 min-w-[220px] flex-1 rounded-xl border border-line bg-white px-4 text-sm font-bold outline-none focus:border-brand"
          placeholder="Pesquisar por texto, autor/referência ou ID"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        {TYPE_FILTERS.map((filter) => (
          <button key={filter.key} type="button" onClick={() => setTypeFilter(filter.key)} className={`h-10 rounded-full border px-3 text-xs font-black ${typeFilter === filter.key ? "border-brand bg-blue-50 text-brand" : "border-line text-muted"}`}>{filter.label}</button>
        ))}
        {STATUS_FILTERS.map((filter) => (
          <button key={filter.key} type="button" onClick={() => setStatusFilter(filter.key)} className={`h-10 rounded-full border px-3 text-xs font-black ${statusFilter === filter.key ? "border-brand bg-blue-50 text-brand" : "border-line text-muted"}`}>{filter.label}</button>
        ))}
      </div>

      {message ? <p className="mt-4 rounded-2xl border border-blue-100 bg-blue-50 px-4 py-3 text-sm font-bold text-brand">{message}</p> : null}
      {error ? <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}

      {showForm ? (
        <form onSubmit={submitForm} className="mt-5 rounded-2xl border border-brand/20 bg-mist p-4">
          <h4 className="text-sm font-black text-navy">{editingId ? "Editar card" : "Novo card"}</h4>
          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <label className="text-xs font-black text-navy">ID editorial
              <input className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold" value={form.editorialId} onChange={(event) => setForm((current) => ({ ...current, editorialId: event.target.value }))} placeholder="BIB-151" required />
            </label>
            <label className="text-xs font-black text-navy">Tipo
              <select className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold" value={form.type} onChange={(event) => setForm((current) => ({ ...current, type: event.target.value }))}>
                <option value="biblical">Bíblico</option>
                <option value="reflection">Reflexivo</option>
              </select>
            </label>
            <label className="text-xs font-black text-navy sm:col-span-2">Texto principal
              <textarea className="mt-1 min-h-[70px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold" value={form.mainText} onChange={(event) => setForm((current) => ({ ...current, mainText: event.target.value }))} required />
            </label>
            <label className="text-xs font-black text-navy">Autor / referência
              <input className="mt-1 h-10 w-full rounded-xl border border-line bg-white px-3 text-sm font-bold" value={form.sourceText} onChange={(event) => setForm((current) => ({ ...current, sourceText: event.target.value }))} required />
            </label>
            <label className="text-xs font-black text-navy sm:col-span-2">Mensagem de início da jornada
              <textarea className="mt-1 min-h-[70px] w-full rounded-xl border border-line bg-white px-3 py-2 text-sm font-bold" value={form.openingMessage} onChange={(event) => setForm((current) => ({ ...current, openingMessage: event.target.value }))} required />
            </label>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            <button type="submit" disabled={busy} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">{busy ? "Salvando..." : "Salvar"}</button>
            <button type="button" onClick={() => setShowForm(false)} className="premium-button-secondary">Cancelar</button>
          </div>
        </form>
      ) : null}

      <div className="mt-5 grid gap-3">
        {loading ? <p className="text-sm font-bold text-muted">Carregando...</p> : null}
        {!loading && !cards.length ? <p className="text-sm font-bold text-muted">Nenhum card encontrado para este filtro.</p> : null}
        {cards.map((card) => (
          <article key={card.id} className={`rounded-2xl border p-4 ${card.active ? "border-line bg-white" : "border-line bg-mist opacity-70"}`}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="rounded-full bg-mist px-2 py-0.5 text-[11px] font-black text-navy">{card.editorialId}</span>
                  <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[11px] font-black text-brand">{card.type === "biblical" ? "Bíblico" : "Reflexivo"}</span>
                  {!card.active ? <span className="rounded-full bg-red-50 px-2 py-0.5 text-[11px] font-black text-red-700">Inativo</span> : null}
                </div>
                <p className="mt-2 font-bold text-navy">{card.mainText}</p>
                <p className="mt-1 text-sm text-muted">{card.sourceText}</p>
                <p className="mt-2 text-xs font-bold uppercase tracking-wide text-muted">{card.openingMessage}</p>
              </div>
              <div className="flex shrink-0 flex-col gap-2">
                <button type="button" onClick={() => beginEdit(card)} className="premium-button-secondary h-9 px-3 text-xs">Editar</button>
                <button type="button" onClick={() => toggleActive(card)} disabled={busy} className="premium-button-secondary h-9 px-3 text-xs disabled:cursor-not-allowed disabled:opacity-60">{card.active ? "Desativar" : "Ativar"}</button>
              </div>
            </div>
          </article>
        ))}
      </div>
    </div>
  );
}
