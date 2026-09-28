"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Loader2, Smartphone, X } from "lucide-react";

// Indicador discreto de conexão da sessão INDIVIDUAL de WhatsApp (Baileys,
// QR Code) do usuário logado — camada de transporte nova por cima do Chat já
// existente (número oficial banido pela Meta em 28/09/2026). Só mostra
// estado e deixa conectar/reconectar/desconectar; não mexe em conversa,
// cliente nem histórico nenhum.

const POLL_MS = 3000;
const STATUS_LABEL = {
  disconnected: "Desconectado",
  connecting: "Conectando…",
  qr_required: "Aguardando QR",
  connected: "Conectado",
  reconnecting: "Reconectando…",
  error: "Erro"
};

function formatPhone(phone) {
  const digits = String(phone || "").replace(/\D/g, "");
  const national = digits.startsWith("55") && digits.length > 11 ? digits.slice(2) : digits;
  if (national.length === 11) return `+55 (${national.slice(0, 2)}) ${national.slice(2, 7)}-${national.slice(7)}`;
  return phone ? `+${digits}` : "";
}

function badgeTone(status) {
  if (status === "connected") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (status === "qr_required" || status === "connecting" || status === "reconnecting") return "border-amber-200 bg-amber-50 text-amber-700";
  return "border-line bg-white text-navy/70";
}

export default function WhatsappIndividualStatus() {
  const [status, setStatus] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pollRef = useRef(null);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/whatsapp-individual/status", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Falha ao consultar o status.");
      setStatus(data);
      return data;
    } catch {
      // Melhor esforço: o badge some silenciosamente se a checagem falhar, não
      // trava o resto do Chat.
      return null;
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  // Polling só enquanto o modal está aberto e a sessão está em transição —
  // não fica batendo na API o tempo todo com o modal fechado.
  useEffect(() => {
    if (!modalOpen) return undefined;
    const shouldPoll = ["qr_required", "connecting", "reconnecting"].includes(status?.status);
    if (!shouldPoll) return undefined;
    pollRef.current = setInterval(loadStatus, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [modalOpen, status?.status, loadStatus]);

  const handleConnect = useCallback(async () => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-individual/connect", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível conectar.");
      setStatus((current) => ({ ...current, status: data.status, qr: data.qr || current?.qr || "" }));
      await loadStatus();
    } catch (connectError) {
      setError(connectError.message);
    } finally {
      setBusy(false);
    }
  }, [loadStatus]);

  const handleDisconnect = useCallback(async () => {
    if (!window.confirm("Desconectar este WhatsApp? Será preciso escanear o QR de novo para reconectar.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-individual/disconnect", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível desconectar.");
      await loadStatus();
    } catch (disconnectError) {
      setError(disconnectError.message);
    } finally {
      setBusy(false);
    }
  }, [loadStatus]);

  const openModal = useCallback(() => {
    setError("");
    setModalOpen(true);
    if (!status || status.status === "disconnected" || status.status === "error") handleConnect();
  }, [status, handleConnect]);

  const currentStatus = status?.status || "disconnected";

  return (
    <>
      <button
        type="button"
        onClick={openModal}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-2 text-xs font-extrabold transition hover:border-brand ${badgeTone(currentStatus)}`}
        title="Sessão pessoal de WhatsApp (QR Code)"
      >
        <Smartphone className="h-3.5 w-3.5" />
        WhatsApp • {currentStatus === "connected" && status?.phoneNumber ? formatPhone(status.phoneNumber) : STATUS_LABEL[currentStatus] || "Desconectado"}
      </button>

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModalOpen(false)}>
          <div className="w-full max-w-sm rounded-3xl border border-line bg-white p-5 shadow-soft" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-navy">WhatsApp individual</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Fechar"><X className="h-5 w-5 text-navy/60" /></button>
            </div>
            <p className="mt-1 text-xs text-navy/60">Conecte o SEU WhatsApp pessoal escaneando o QR (como o WhatsApp Web). Só as conversas atribuídas a você usam esta sessão.</p>

            {error ? <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p> : null}

            <div className="mt-4 flex flex-col items-center gap-3">
              {currentStatus === "connected" ? (
                <>
                  <div className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
                    <p className="text-sm font-black text-emerald-700">Conectado</p>
                    <p className="text-xs text-emerald-700/80">{formatPhone(status.phoneNumber) || "Número não identificado"}</p>
                  </div>
                  <div className="flex w-full gap-2">
                    <button type="button" disabled={busy} onClick={handleConnect} className="flex-1 rounded-full border border-navy/15 px-3 py-2 text-xs font-extrabold text-navy hover:border-brand disabled:opacity-50">Reconectar</button>
                    <button type="button" disabled={busy} onClick={handleDisconnect} className="flex-1 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:border-red-300 disabled:opacity-50">Desconectar</button>
                  </div>
                </>
              ) : status?.qr ? (
                <>
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={status.qr} alt="QR Code do WhatsApp" className="h-56 w-56 rounded-2xl border border-line object-contain" />
                  <p className="text-xs text-navy/60">Abra o WhatsApp no celular → Aparelhos conectados → Conectar um aparelho.</p>
                </>
              ) : (
                <div className="flex h-56 w-56 flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-line text-navy/50">
                  <Loader2 className="h-6 w-6 animate-spin" />
                  <span className="text-xs font-bold">{STATUS_LABEL[currentStatus] || "Gerando QR…"}</span>
                </div>
              )}

              {currentStatus !== "connected" ? (
                <button type="button" disabled={busy} onClick={handleConnect} className="w-full rounded-full bg-navy px-3 py-2 text-xs font-extrabold text-white hover:bg-navy/90 disabled:opacity-50">
                  {busy ? "Conectando…" : "Gerar novo QR"}
                </button>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
