"use client";

import { useEffect, useState } from "react";
import { History as HistoryIcon, LoaderCircle, Link2, RefreshCw } from "lucide-react";
import Avatar from "@/components/Avatar";
import { daysSince, ccaStatusDayColorKey } from "@/lib/cca-status-presentation.mjs";

const COLOR_CLASSES = {
  green: "bg-emerald-50 text-emerald-700",
  yellow: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700"
};

const date = (value) => (value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");

// Mostra a CCA (foto + nome) pra qual o cliente foi enviado, com "há X dias"
// colorido, e deixa trocar a CCA. Sem sub-status nem observação — o
// acompanhamento de etapa já existe na esteira principal do cliente
// (Documentação/Aprovação/Restrição/Blindagem etc.). Só aparece quando o
// cliente já foi vinculado a alguma CCA (busca sua própria linha aberta).
export default function CcaStatusCard({ clientId, canManage }) {
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [ccaList, setCcaList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) return;
    const controller = new AbortController();
    fetch(`/api/admin/client-cca-status/${clientId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error); setCurrent(data.current); setHistory(data.history || []); })
      .catch((e) => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, [clientId]);

  async function openForm() {
    setError("");
    setShowForm(true);
    if (ccaList.length) return;
    try {
      const response = await fetch("/api/admin/cca?onlyActive=1");
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error);
      setCcaList(data.cca || []);
    } catch (e) {
      setError(e.message || "Não foi possível carregar as CCAs.");
    }
  }

  async function handleSave({ ccaId }) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/client-cca-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, ccaId })
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error);
      const refreshed = await fetch(`/api/admin/client-cca-status/${clientId}`, { cache: "no-store" }).then((r) => r.json());
      setCurrent(refreshed.current);
      setHistory(refreshed.history || []);
      setShowForm(false);
    } catch (e) {
      setError(e.message || "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }

  if (!loaded) return null;

  // Cliente ainda sem nenhum vínculo (nunca passou pelo envio automático) —
  // vínculo manual, para os clientes que já estavam aguardando documentação
  // antes desta função existir.
  if (!current) {
    if (!canManage) return null;
    return (
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[10px] font-black text-navy hover:bg-mist" onClick={openForm}>
          <Link2 className="h-3 w-3" /> Vincular a uma CCA
        </button>
        {error ? <p className="w-full text-xs font-bold text-red-700">{error}</p> : null}
        {showForm ? <CcaLinkForm ccaId="" ccaList={ccaList} busy={busy} onCancel={() => setShowForm(false)} onSave={handleSave} /> : null}
      </div>
    );
  }

  const days = daysSince(current.enteredAt);
  const colorKey = ccaStatusDayColorKey(days);

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-2 rounded-full border border-line py-0.5 pl-0.5 pr-2.5">
        <Avatar name={current.cca?.name} photoUrl={current.cca?.photoUrl} size={24} />
        <span className="max-w-[120px] truncate text-[11px] font-black text-navy" title={current.cca?.name}>{current.cca?.name}</span>
      </div>
      <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[10px] font-black uppercase tracking-[0.06em] ${COLOR_CLASSES[colorKey]}`}>
        há {days} {days === 1 ? "dia" : "dias"}
      </span>
      {canManage ? (
        <button type="button" className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[10px] font-black text-navy hover:bg-mist" onClick={openForm}>
          <RefreshCw className="h-3 w-3" /> Trocar CCA
        </button>
      ) : null}
      {history.length ? (
        <button type="button" className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[10px] font-black text-navy hover:bg-mist" onClick={() => setShowHistory((v) => !v)}>
          <HistoryIcon className="h-3 w-3" /> Histórico
        </button>
      ) : null}

      {error ? <p className="w-full text-xs font-bold text-red-700">{error}</p> : null}

      {showForm ? <CcaLinkForm ccaId={current.cca?.id || ""} ccaList={ccaList} busy={busy} onCancel={() => setShowForm(false)} onSave={handleSave} /> : null}

      {showHistory ? (
        <ul className="mt-1 w-full space-y-1 rounded-2xl border border-line bg-mist/40 p-3">
          {history.map((entry) => (
            <li key={entry.id} className="flex items-center gap-2 text-xs font-bold text-navy/80">
              <Avatar name={entry.cca?.name} photoUrl={entry.cca?.photoUrl} size={20} />
              {entry.cca?.name || "—"}
              {" — "}{date(entry.enteredAt)}{entry.exitedAt ? ` até ${date(entry.exitedAt)}` : " (atual)"}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CcaLinkForm({ ccaId: initialCcaId, ccaList, busy, onCancel, onSave }) {
  const [ccaId, setCcaId] = useState(initialCcaId || "");

  function handleSubmit(event) {
    event.preventDefault();
    onSave({ ccaId });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1 flex w-full flex-wrap items-end gap-2 rounded-2xl border border-line bg-white p-3 shadow-soft">
      <label className="text-[11px] font-black text-navy">
        CCA
        <select className="mt-1 w-full min-w-[180px] rounded-lg border border-line p-2 text-sm font-normal" value={ccaId} onChange={(e) => setCcaId(e.target.value)} required>
          <option value="" disabled>Selecione...</option>
          {ccaList.map((cca) => (
            <option key={cca.id} value={cca.id}>{cca.name}</option>
          ))}
        </select>
      </label>
      <div className="flex gap-2">
        <button type="button" className="premium-button-secondary" onClick={onCancel}>Cancelar</button>
        <button type="submit" disabled={busy} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">
          {busy ? <LoaderCircle className="h-4 w-4 animate-spin" /> : null} Salvar
        </button>
      </div>
    </form>
  );
}
