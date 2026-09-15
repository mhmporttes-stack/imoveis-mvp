"use client";
import { useEffect, useState } from "react";
import DailyMessageExperience from "./DailyMessageExperience";

function newIdempotencyKey() {
  return typeof crypto !== "undefined" && crypto.randomUUID ? crypto.randomUUID() : `dispatch-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

export default function DailyMessageDispatch({ defaultContentType = "alternate" }) {
  const [users, setUsers] = useState([]);
  const [audience, setAudience] = useState("all");
  const [selectedIds, setSelectedIds] = useState([]);
  const [selectionMode, setSelectionMode] = useState("automatic"); // automatic | manual
  const [contentType, setContentType] = useState(defaultContentType);
  const [card, setCard] = useState(null);
  const [cardLoading, setCardLoading] = useState(false);
  const [libraryQuery, setLibraryQuery] = useState("");
  const [libraryCards, setLibraryCards] = useState([]);
  const [confirming, setConfirming] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState(null);
  const [history, setHistory] = useState([]);
  const [idempotencyKey, setIdempotencyKey] = useState(newIdempotencyKey);
  const [previewOpen, setPreviewOpen] = useState(false);

  useEffect(() => {
    fetch("/api/daily-message/dispatch/recipients").then((response) => response.json()).then((data) => setUsers(data.users || [])).catch(() => {});
    loadHistory();
  }, []);

  async function loadHistory() {
    try {
      const response = await fetch("/api/daily-message/dispatch");
      const data = await response.json().catch(() => ({}));
      if (response.ok) setHistory(data.dispatches || []);
    } catch {
      // histórico é informativo; falha aqui não bloqueia o disparo
    }
  }

  useEffect(() => {
    if (selectionMode !== "manual" || !libraryQuery.trim()) {
      if (selectionMode === "manual") setLibraryCards([]);
      return;
    }
    const timeout = setTimeout(async () => {
      const params = new URLSearchParams({ search: libraryQuery, status: "active" });
      const response = await fetch(`/api/daily-message/cards?${params.toString()}`);
      const data = await response.json().catch(() => ({}));
      setLibraryCards(data.cards || []);
    }, 250);
    return () => clearTimeout(timeout);
  }, [libraryQuery, selectionMode]);

  async function pickAutomatic() {
    setCardLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/daily-message/cards/preview?type=${contentType}`);
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível selecionar um card.");
      if (!data.card) throw new Error("Nenhum card ativo disponível para este tipo.");
      setCard(data.card);
    } catch (pickError) {
      setError(pickError.message);
    } finally {
      setCardLoading(false);
    }
  }

  function pickManual(selected) {
    setCard(selected);
  }

  function resetFlow() {
    setCard(null);
    setConfirming(false);
    setResult(null);
    setError("");
    setIdempotencyKey(newIdempotencyKey());
  }

  async function confirmDispatch() {
    setSending(true);
    setError("");
    try {
      const response = await fetch("/api/daily-message/dispatch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          audience,
          recipientIds: audience === "selected" ? selectedIds : undefined,
          cardId: card.id,
          idempotencyKey
        })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível disparar a mensagem.");
      setResult(data);
      setConfirming(false);
      await loadHistory();
    } catch (confirmError) {
      setError(confirmError.message);
    } finally {
      setSending(false);
    }
  }

  const recipientCount = audience === "all" ? users.length : selectedIds.length;
  const canGoToConfirm = card && recipientCount > 0;

  return (
    <div className="space-y-5">
      <div className="rounded-[24px] border border-line bg-white p-6 shadow-soft">
        <h3 className="text-xl font-black text-navy">Disparar Mensagem Agora</h3>
        <p className="mt-1 text-sm text-muted">Disparo extraordinário, independente do ciclo automático — não altera o horário configurado.</p>

        {result ? (
          <div className="mt-5 rounded-2xl border border-emerald-100 bg-emerald-50 p-4">
            <p className="font-black text-emerald-800">Mensagem disparada.</p>
            <p className="mt-1 text-sm text-emerald-700">{result.recipients} destinatário{result.recipients === 1 ? "" : "s"}{result.reused ? " (disparo já havia sido criado — nenhuma duplicidade)" : ""}.</p>
            <button type="button" onClick={resetFlow} className="premium-button-secondary mt-3">Novo disparo</button>
          </div>
        ) : (
          <>
            <div className="mt-5">
              <p className="text-sm font-black text-navy">1. Público</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => { setAudience("all"); setCard(null); }} className={`h-10 rounded-full border px-4 text-sm font-black ${audience === "all" ? "border-brand bg-blue-50 text-brand" : "border-line text-muted"}`}>Todos os corretores</button>
                <button type="button" onClick={() => { setAudience("selected"); setCard(null); }} className={`h-10 rounded-full border px-4 text-sm font-black ${audience === "selected" ? "border-brand bg-blue-50 text-brand" : "border-line text-muted"}`}>Selecionar corretores</button>
              </div>
              {audience === "selected" ? (
                <div className="mt-3 grid max-h-56 gap-1 overflow-y-auto rounded-2xl border border-line bg-mist p-3">
                  {users.map((user) => (
                    <label key={user.id} className="flex items-center gap-2 rounded-xl px-2 py-1.5 text-sm font-bold text-navy hover:bg-white">
                      <input type="checkbox" className="h-4 w-4 accent-brand" checked={selectedIds.includes(user.id)} onChange={() => setSelectedIds((current) => current.includes(user.id) ? current.filter((id) => id !== user.id) : [...current, user.id])} />
                      {user.name}
                    </label>
                  ))}
                </div>
              ) : null}
              <p className="mt-2 text-xs font-bold text-muted">{recipientCount} destinatário{recipientCount === 1 ? "" : "s"} elegível(is).</p>
            </div>

            <div className="mt-6">
              <p className="text-sm font-black text-navy">2. Como escolher o card</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <button type="button" onClick={() => { setSelectionMode("automatic"); setCard(null); }} className={`h-10 rounded-full border px-4 text-sm font-black ${selectionMode === "automatic" ? "border-brand bg-blue-50 text-brand" : "border-line text-muted"}`}>Seleção automática</button>
                <button type="button" onClick={() => { setSelectionMode("manual"); setCard(null); }} className={`h-10 rounded-full border px-4 text-sm font-black ${selectionMode === "manual" ? "border-brand bg-blue-50 text-brand" : "border-line text-muted"}`}>Escolher card</button>
              </div>

              {selectionMode === "automatic" ? (
                <div className="mt-3 space-y-3">
                  <select className="h-10 rounded-xl border border-line bg-white px-3 text-sm font-bold" value={contentType} onChange={(event) => { setContentType(event.target.value); setCard(null); }}>
                    <option value="alternate">Alternar entre os dois</option>
                    <option value="biblical">Bíblicos</option>
                    <option value="reflection">Reflexivos</option>
                  </select>
                  <div>
                    <button type="button" onClick={pickAutomatic} disabled={cardLoading} className="premium-button-secondary disabled:cursor-not-allowed disabled:opacity-60">
                      {cardLoading ? "Selecionando..." : card ? "Escolher outro automaticamente" : "Selecionar card"}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="mt-3">
                  <input className="h-10 w-full rounded-xl border border-line bg-white px-4 text-sm font-bold" placeholder="Pesquisar por texto, autor/referência ou ID" value={libraryQuery} onChange={(event) => setLibraryQuery(event.target.value)} />
                  <div className="mt-2 grid max-h-56 gap-2 overflow-y-auto">
                    {libraryCards.map((item) => (
                      <button key={item.id} type="button" onClick={() => pickManual(item)} className={`rounded-xl border p-3 text-left text-sm ${card?.id === item.id ? "border-brand bg-blue-50" : "border-line bg-white"}`}>
                        <span className="font-black text-navy">{item.editorialId}</span> · <span className="text-muted">{item.type === "biblical" ? "Bíblico" : "Reflexivo"}</span>
                        <p className="mt-1 font-bold text-navy">{item.mainText}</p>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {card ? (
              <div className="mt-6 rounded-2xl border border-line bg-mist p-4">
                <p className="text-sm font-black text-navy">3. Preview do card selecionado</p>
                <p className="mt-2 font-bold text-navy">{card.mainText}</p>
                <p className="mt-1 text-sm text-muted">{card.sourceText}</p>
                <p className="mt-2 text-xs font-bold uppercase tracking-wide text-muted">{card.openingMessage}</p>
                <button type="button" onClick={() => setPreviewOpen(true)} className="premium-button-secondary mt-3">Ver experiência completa</button>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap gap-2">
              <button type="button" disabled={!canGoToConfirm} onClick={() => setConfirming(true)} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">Disparar Mensagem Agora</button>
            </div>
          </>
        )}

        {error ? <p className="mt-4 rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm font-bold text-red-700">{error}</p> : null}
      </div>

      {history.length ? (
        <div className="rounded-[24px] border border-line bg-white p-6 shadow-soft">
          <h4 className="text-sm font-black uppercase tracking-wide text-muted">Histórico de disparos</h4>
          <div className="mt-3 grid gap-2">
            {history.map((item) => (
              <div key={item.id} className="rounded-xl border border-line p-3 text-sm">
                <p className="font-black text-navy">{item.card.editorialId} · {formatDateTime(item.createdAt)}</p>
                <p className="text-muted">{item.card.mainText}</p>
                <p className="mt-1 text-xs font-bold text-muted">{item.recipients} destinatário{item.recipients === 1 ? "" : "s"} · {item.completed} concluído{item.completed === 1 ? "" : "s"}</p>
              </div>
            ))}
          </div>
        </div>
      ) : null}

      {confirming ? (
        <div className="fixed inset-0 z-[400] flex items-center justify-center bg-navy/40 p-4" role="dialog" aria-modal="true">
          <div className="w-full max-w-md rounded-[24px] bg-white p-6 shadow-2xl">
            <h4 className="text-lg font-black text-navy">Disparar Mensagem Agora?</h4>
            <p className="mt-2 text-sm text-muted">Esta ação fará esta mensagem aparecer para os corretores selecionados. O horário diário configurado não será alterado.</p>
            <p className="mt-3 text-sm font-bold text-navy">{recipientCount} destinatário{recipientCount === 1 ? "" : "s"} · card {card?.editorialId}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" onClick={confirmDispatch} disabled={sending} className="premium-button-primary disabled:cursor-not-allowed disabled:opacity-60">{sending ? "Disparando..." : "Confirmar disparo"}</button>
              <button type="button" onClick={() => setConfirming(false)} disabled={sending} className="premium-button-secondary">Cancelar</button>
            </div>
          </div>
        </div>
      ) : null}

      {previewOpen && card ? <DailyMessageExperience card={card} preview onComplete={() => setPreviewOpen(false)} /> : null}
    </div>
  );
}

function formatDateTime(value) {
  try {
    return new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(value));
  } catch {
    return "";
  }
}
