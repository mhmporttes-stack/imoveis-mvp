"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Ban, CircleHelp, Loader2, X } from "lucide-react";
import IntegrationStatusIcon, { whatsappTone } from "@/components/IntegrationStatusIcon";

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
  pairing_code_required: "Aguardando código",
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

// "551499998888" -> "55 14 9999-8888" — mais fácil de conferir enquanto
// digita do que os dígitos corridos.
function formatPhoneInput(digits) {
  const d = String(digits || "").replace(/\D/g, "");
  if (d.length <= 2) return d;
  if (d.length <= 4) return `${d.slice(0, 2)} ${d.slice(2)}`;
  if (d.length <= 8) return `${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4)}`;
  return `${d.slice(0, 2)} ${d.slice(2, 4)} ${d.slice(4, 8)}-${d.slice(8, 12)}`;
}

export default function WhatsappIndividualStatus({ align = "center" }) {
  const [status, setStatus] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  // Pareamento por número de telefone (pedido do dono, 2026-09-30):
  // alternativa ao QR. phoneMode alterna a tela; phoneInput guarda só os
  // dígitos (formatPhoneInput cuida da exibição).
  const [phoneMode, setPhoneMode] = useState(false);
  const [phoneInput, setPhoneInput] = useState("");
  const pollRef = useRef(null);
  // WhatsApp restringido: só status operacional informado pelo próprio corretor
  // (não libera Prospecção/Meta Diária/disparos — isso exige sessão conectada).
  const [restriction, setRestriction] = useState({ restricted: false, reportedAt: null, validationStatus: null });
  const [confirmingRestriction, setConfirmingRestriction] = useState(false);

  const loadRestriction = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/whatsapp-individual/restriction", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (response.ok) setRestriction({ restricted: Boolean(data.restricted), reportedAt: data.reportedAt || null, validationStatus: data.validationStatus || null });
    } catch { /* silencioso: o selo some, o resto da tela segue */ }
  }, []);

  const sendRestriction = useCallback(async (action) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-individual/restriction", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(action === "report" ? { action, confirm: true } : { action })
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível salvar.");
      setRestriction({ restricted: Boolean(data.restricted), reportedAt: data.reportedAt || null, validationStatus: data.validationStatus || null });
      setConfirmingRestriction(false);
    } catch (err) {
      setError(err.message || "Não foi possível salvar.");
    } finally {
      setBusy(false);
    }
  }, []);

  const loadStatus = useCallback(async () => {
    try {
      const response = await fetch("/api/admin/whatsapp-individual/status", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Falha ao consultar o status.");
      // Código de pareamento já exibido não some numa releitura que ainda não
      // o traga, enquanto a sessão não conectou/caiu (2026-10-02).
      setStatus((current) => (
        !data.pairingCode && current?.pairingCode && !["connected", "disconnected"].includes(data.status)
          ? { ...data, pairingCode: current.pairingCode }
          : data
      ));
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
    const shouldPoll = ["qr_required", "pairing_code_required", "connecting", "reconnecting"].includes(status?.status);
    if (!shouldPoll) return undefined;
    pollRef.current = setInterval(loadStatus, POLL_MS);
    return () => clearInterval(pollRef.current);
  }, [modalOpen, status?.status, loadStatus]);

  const handleConnect = useCallback(async (phoneNumber) => {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/admin/whatsapp-individual/connect", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(phoneNumber ? { phoneNumber } : {})
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível conectar.");
      // Pediu código e o WhatsApp não devolveu: mostra o motivo em vez de
      // ficar sem nada na tela (achado real, 2026-10-02).
      if (phoneNumber && !data.pairingCode) {
        throw new Error(data.pairingError ? `O WhatsApp não gerou o código: ${data.pairingError}` : "O WhatsApp não gerou o código. Confira o número (com DDD) e tente de novo em alguns segundos.");
      }
      setStatus((current) => ({ ...current, status: data.status, qr: data.qr || current?.qr || "", pairingCode: data.pairingCode || "" }));
      await loadStatus();
    } catch (connectError) {
      setError(connectError.message);
    } finally {
      setBusy(false);
    }
  }, [loadStatus]);

  const handleRequestPairingCode = useCallback(() => {
    const digits = phoneInput.replace(/\D/g, "");
    if (digits.length < 10) { setError("Informe o número completo, com DDD."); return; }
    handleConnect(digits);
  }, [phoneInput, handleConnect]);

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
    setPhoneMode(false);
    setModalOpen(true);
    setConfirmingRestriction(false);
    loadRestriction();
    if (!status || status.status === "disconnected" || status.status === "error") handleConnect();
  }, [status, handleConnect, loadRestriction]);

  // "Conectar WhatsApp" de outras telas (Prospecção/Meta Diária bloqueadas sem a sessão
  // conectada, 2026-10-02) abre este mesmo modal — não existe rota própria de conexão.
  useEffect(() => {
    const onRequest = () => openModal();
    window.addEventListener("crm:open-whatsapp-connect", onRequest);
    return () => window.removeEventListener("crm:open-whatsapp-connect", onRequest);
  }, [openModal]);

  const currentStatus = status?.status || "disconnected";

  return (
    <>
      <IntegrationStatusIcon
        kind="whatsapp"
        tone={whatsappTone(currentStatus)}
        label={`WhatsApp: ${currentStatus === "connected" && status?.phoneNumber ? formatPhone(status.phoneNumber) : STATUS_LABEL[currentStatus] || "Desconectado"}`}
        onClick={openModal}
        align={align}
      />

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
                    <button type="button" disabled={busy} onClick={() => handleConnect()} className="flex-1 rounded-full border border-navy/15 px-3 py-2 text-xs font-extrabold text-navy hover:border-brand disabled:opacity-50">Reconectar</button>
                    <button type="button" disabled={busy} onClick={handleDisconnect} className="flex-1 rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:border-red-300 disabled:opacity-50">Desconectar</button>
                  </div>
                </>
              ) : status?.pairingCode ? (
                <>
                  <div className="w-full rounded-2xl border border-line bg-mist/40 py-5 text-center">
                    <p className="font-mono text-3xl font-black tracking-[0.15em] text-navy">{status.pairingCode}</p>
                  </div>
                  <p className="text-xs text-navy/60">No celular: WhatsApp → Aparelhos conectados → Conectar com número de telefone → digite esse código.</p>
                </>
              ) : phoneMode ? (
                <div className="flex w-full flex-col gap-2">
                  <label className="text-xs font-bold text-navy/70" htmlFor="whatsapp-individual-phone">Seu número (com DDD)</label>
                  <input
                    id="whatsapp-individual-phone"
                    type="tel"
                    inputMode="numeric"
                    placeholder="14 99999-9999"
                    value={formatPhoneInput(phoneInput)}
                    onChange={(event) => setPhoneInput(event.target.value.replace(/\D/g, "").slice(0, 13))}
                    className="w-full rounded-xl border border-line px-3 py-2 text-sm font-bold text-navy focus:border-brand focus:outline-none"
                  />
                  <button type="button" disabled={busy} onClick={handleRequestPairingCode} className="w-full rounded-full bg-navy px-3 py-2 text-xs font-extrabold text-white hover:bg-navy/90 disabled:opacity-50">
                    {busy ? "Pedindo código…" : "Pedir código"}
                  </button>
                </div>
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

              {currentStatus !== "connected" && !phoneMode && !status?.pairingCode ? (
                <button type="button" disabled={busy} onClick={() => handleConnect()} className="w-full rounded-full bg-navy px-3 py-2 text-xs font-extrabold text-white hover:bg-navy/90 disabled:opacity-50">
                  {busy ? "Conectando…" : "Gerar novo QR"}
                </button>
              ) : null}

              {currentStatus !== "connected" ? (
                <button
                  type="button"
                  onClick={() => {
                    setError("");
                    const goingToPhone = !phoneMode;
                    setPhoneMode(goingToPhone);
                    // Voltar pro QR depois de já ter pedido um código: limpa o
                    // código guardado e pede um QR novo (o código antigo não
                    // serve mais pra nada nessa troca de método).
                    if (!goingToPhone && status?.pairingCode) {
                      setStatus((current) => ({ ...current, pairingCode: "" }));
                      handleConnect();
                    }
                  }}
                  className="text-xs font-bold text-brand underline-offset-2 hover:underline"
                >
                  {phoneMode ? "Prefere escanear o QR?" : "Prefere conectar com um código, sem QR?"}
                </button>
              ) : null}

              {currentStatus !== "connected" ? (
                <div className="w-full rounded-2xl border border-navy/15 bg-mist/40 p-3">
                  {restriction.restricted ? (
                    <>
                      {restriction.validationStatus === "validated"
                        ? <p className="flex items-center gap-1.5 text-xs font-black text-navy"><Ban aria-hidden="true" className="h-3.5 w-3.5" />Restrição validada</p>
                        : <p className="flex items-center gap-1.5 text-xs font-black text-navy"><CircleHelp aria-hidden="true" className="h-3.5 w-3.5" />Restrição informada — aguardando validação</p>}
                      <p className="mt-1 text-[11px] text-navy/70">Informado em {restriction.reportedAt ? new Date(restriction.reportedAt).toLocaleString("pt-BR", { timeZone: "America/Sao_Paulo" }) : "—"}. Seu gestor ou o administrador valida o aviso. A Prospecção e a Meta Diária continuam bloqueadas até o WhatsApp conectar.</p>
                      {restriction.validationStatus === "validated"
                        ? <p className="mt-2 rounded-xl bg-white px-3 py-2 text-[11px] font-bold text-navy/80">Restrição validada — só o administrador ou a gestora da equipe encerram. Se o WhatsApp voltar a conectar, ela se encerra sozinha.</p>
                        : <button type="button" disabled={busy} onClick={() => sendRestriction("resolve")} className="mt-2 w-full rounded-full border border-navy/20 bg-white px-3 py-2 text-xs font-extrabold text-navy hover:border-brand disabled:opacity-50">Restrição resolvida</button>}
                    </>
                  ) : confirmingRestriction ? (
                    <>
                      <p className="text-xs font-bold text-navy">Confirma que o seu WhatsApp foi restringido ou bloqueado pelo WhatsApp?</p>
                      <p className="mt-1 text-[11px] text-navy/70">Isso apenas avisa seu gestor. Não libera a Prospecção nem a Meta Diária.</p>
                      <div className="mt-2 flex gap-2">
                        <button type="button" disabled={busy} onClick={() => sendRestriction("report")} className="flex-1 rounded-full bg-navy px-3 py-2 text-xs font-extrabold text-white hover:bg-navy/90 disabled:opacity-50">Sim, confirmo</button>
                        <button type="button" disabled={busy} onClick={() => setConfirmingRestriction(false)} className="flex-1 rounded-full border border-navy/15 px-3 py-2 text-xs font-extrabold text-navy disabled:opacity-50">Cancelar</button>
                      </div>
                    </>
                  ) : (
                    <button type="button" disabled={busy} onClick={() => setConfirmingRestriction(true)} className="flex w-full items-center justify-center gap-1.5 rounded-full border border-navy/20 bg-white px-3 py-2 text-xs font-extrabold text-navy hover:border-brand disabled:opacity-50">
                      <Ban aria-hidden="true" className="h-3.5 w-3.5" />Meu WhatsApp está restringido
                    </button>
                  )}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
