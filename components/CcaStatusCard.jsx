"use client";

import { useEffect, useState } from "react";
import { Clock, History as HistoryIcon, LoaderCircle, Pencil } from "lucide-react";
import { daysSince, ccaStatusDayColorKey, ccaStatusBadgeLabel } from "@/lib/cca-status-presentation.mjs";

const COLOR_CLASSES = {
  green: "bg-emerald-50 text-emerald-700",
  yellow: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700"
};

const date = (value) => (value ? new Date(value).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "");

// Selo + contador de dias + seletor de sub-status do acompanhamento na CCA.
// Só aparece quando o cliente já foi enviado a alguma CCA (busca sua própria
// linha aberta) — cliente nunca enviado não mostra nada aqui.
export default function CcaStatusCard({ clientId, canManage }) {
  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const [stages, setStages] = useState([]);
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
    if (stages.length && ccaList.length) return;
    try {
      const [stagesRes, ccaRes] = await Promise.all([
        fetch("/api/admin/cca-status-stages?onlyActive=1"),
        fetch("/api/admin/cca?onlyActive=1")
      ]);
      const stagesData = await stagesRes.json().catch(() => ({}));
      const ccaData = await ccaRes.json().catch(() => ({}));
      if (!stagesRes.ok) throw new Error(stagesData.error);
      if (!ccaRes.ok) throw new Error(ccaData.error);
      setStages(stagesData.stages || []);
      setCcaList(ccaData.cca || []);
    } catch (e) {
      setError(e.message || "Não foi possível carregar as opções.");
    }
  }

  async function handleSave({ statusId, ccaId, observation }) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/client-cca-status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ clientId, statusId, ccaId, observation })
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

  if (!loaded || !current) return null;

  const days = daysSince(current.enteredAt);
  const colorKey = ccaStatusDayColorKey(days);
  const badge = ccaStatusBadgeLabel({ statusKey: current.status?.key, statusLabel: current.status?.label, ccaName: current.cca?.name });

  return (
    <div className="mt-2 flex flex-wrap items-center gap-2">
      <span className={`inline-flex h-6 items-center rounded-full px-2.5 text-[10px] font-black uppercase tracking-[0.06em] ${COLOR_CLASSES[colorKey]}`}>
        <Clock className="mr-1 h-3 w-3" /> {badge} · há {days} {days === 1 ? "dia" : "dias"}
      </span>
      {canManage ? (
        <button type="button" className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[10px] font-black text-navy hover:bg-mist" onClick={openForm}>
          <Pencil className="h-3 w-3" /> Mudar status
        </button>
      ) : null}
      {history.length ? (
        <button type="button" className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[10px] font-black text-navy hover:bg-mist" onClick={() => setShowHistory((v) => !v)}>
          <HistoryIcon className="h-3 w-3" /> Histórico
        </button>
      ) : null}

      {error ? <p className="w-full text-xs font-bold text-red-700">{error}</p> : null}

      {showForm ? (
        <CcaStatusForm
          current={current}
          stages={stages}
          ccaList={ccaList}
          busy={busy}
          onCancel={() => setShowForm(false)}
          onSave={handleSave}
        />
      ) : null}

      {showHistory ? (
        <ul className="mt-1 w-full space-y-1 rounded-2xl border border-line bg-mist/40 p-3">
          {history.map((entry) => (
            <li key={entry.id} className="text-xs font-bold text-navy/80">
              {ccaStatusBadgeLabel({ statusKey: entry.status?.key, statusLabel: entry.status?.label, ccaName: entry.cca?.name })}
              {" — "}{date(entry.enteredAt)}{entry.exitedAt ? ` até ${date(entry.exitedAt)}` : " (atual)"}
              {entry.observation ? <span className="block text-[11px] font-normal text-muted">{entry.observation}</span> : null}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function CcaStatusForm({ current, stages, ccaList, busy, onCancel, onSave }) {
  const [statusId, setStatusId] = useState(current.status?.id || "");
  const [ccaId, setCcaId] = useState(current.cca?.id || "");
  const [observation, setObservation] = useState("");

  function handleSubmit(event) {
    event.preventDefault();
    onSave({ statusId, ccaId, observation });
  }

  return (
    <form onSubmit={handleSubmit} className="mt-1 w-full space-y-2 rounded-2xl border border-line bg-white p-3 shadow-soft">
      <div className="grid gap-2 sm:grid-cols-2">
        <label className="text-[11px] font-black text-navy">
          Status
          <select className="mt-1 w-full rounded-lg border border-line p-2 text-sm font-normal" value={statusId} onChange={(e) => setStatusId(e.target.value)} required>
            <option value="" disabled>Selecione...</option>
            {stages.map((stage) => (
              <option key={stage.id} value={stage.id}>{stage.label}</option>
            ))}
          </select>
        </label>
        <label className="text-[11px] font-black text-navy">
          CCA
          <select className="mt-1 w-full rounded-lg border border-line p-2 text-sm font-normal" value={ccaId} onChange={(e) => setCcaId(e.target.value)} required>
            <option value="" disabled>Selecione...</option>
            {ccaList.map((cca) => (
              <option key={cca.id} value={cca.id}>{cca.name}</option>
            ))}
          </select>
        </label>
      </div>
      <label className="block text-[11px] font-black text-navy">
        Observação
        <textarea className="mt-1 w-full rounded-lg border border-line p-2 text-sm font-normal" rows={2} value={observation} onChange={(e) => setObservation(e.target.value)} placeholder="O que a CCA pediu, de quem falta a carta, motivo da reprovação..." />
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
