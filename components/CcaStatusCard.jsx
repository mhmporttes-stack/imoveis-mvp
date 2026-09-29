"use client";

import { useEffect, useState } from "react";
import { LoaderCircle, Link2 } from "lucide-react";
import Avatar from "@/components/Avatar";

// Mostra a CCA (foto + nome) pra qual o cliente foi enviado — clicável pra
// trocar. Sem sub-status, sem observação, sem contador de dias e sem
// histórico próprio: tudo isso já existe na esteira principal do cliente
// (Documentação/Aprovação/Restrição/Blindagem) e no ícone de histórico/
// jornada do card (ClientJourneyActions, que já registra toda troca de
// CCA). Renderiza direto no `flex flex-wrap` do card do cliente (sem <div>
// de wrapper própria), na frente do selo de status principal. Só aparece
// quando o cliente já foi vinculado a alguma CCA (busca sua própria linha
// aberta).
export default function CcaStatusCard({ clientId, canManage }) {
  const [current, setCurrent] = useState(null);
  const [loaded, setLoaded] = useState(false);
  const [showForm, setShowForm] = useState(false);
  const [ccaList, setCcaList] = useState([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!clientId) return;
    const controller = new AbortController();
    fetch(`/api/admin/client-cca-status/${clientId}`, { signal: controller.signal, cache: "no-store" })
      .then(async (r) => { const data = await r.json(); if (!r.ok) throw new Error(data.error); setCurrent(data.current); })
      .catch((e) => { if (e.name !== "AbortError") setError(e.message); })
      .finally(() => setLoaded(true));
    return () => controller.abort();
  }, [clientId]);

  async function openForm() {
    if (!canManage) return;
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
      <>
        <button type="button" className="inline-flex h-6 items-center gap-1 rounded-full border border-line px-2 text-[10px] font-black text-navy hover:bg-mist" onClick={openForm}>
          <Link2 className="h-3 w-3" /> Vincular a uma CCA
        </button>
        {error ? <p className="w-full text-xs font-bold text-red-700">{error}</p> : null}
        {showForm ? <CcaLinkForm ccaId="" ccaList={ccaList} busy={busy} onCancel={() => setShowForm(false)} onSave={handleSave} /> : null}
      </>
    );
  }

  return (
    <>
      <button
        type="button"
        disabled={!canManage}
        className="inline-flex items-center gap-1.5 rounded-full border border-line py-0.5 pl-0.5 pr-2.5 disabled:cursor-default enabled:hover:bg-mist"
        onClick={openForm}
        title={canManage ? "Clique para trocar a CCA" : current.cca?.name}
      >
        <Avatar name={current.cca?.name} photoUrl={current.cca?.photoUrl} size={24} />
        <span className="max-w-[120px] truncate text-[11px] font-black text-navy">{current.cca?.name}</span>
      </button>

      {error ? <p className="w-full text-xs font-bold text-red-700">{error}</p> : null}

      {showForm ? <CcaLinkForm ccaId={current.cca?.id || ""} ccaList={ccaList} busy={busy} onCancel={() => setShowForm(false)} onSave={handleSave} /> : null}
    </>
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
