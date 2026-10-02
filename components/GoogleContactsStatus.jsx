"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import IntegrationStatusIcon, { googleContactsTone } from "@/components/IntegrationStatusIcon";

// Indicador discreto da integração INDIVIDUAL de Google Contacts (People
// API) do usuário logado — pedido do dono, 2026-10-01. Mesmo padrão visual
// de components/WhatsappIndividualStatus.jsx (badge no cabeçalho + modal),
// mas 100% independente: nunca lê nem escreve nada da sessão WhatsApp. Antes
// de um disparo automático, se esta integração estiver conectada e com
// sincronização ativa, o cliente é salvo na agenda Google deste corretor
// (ver lib/google-contacts.js / hook em lib/daily-goal-auto.js).

const QUERY_MESSAGES = {
  conectado: { tone: "emerald", text: "Google Contacts conectado com sucesso." },
  erro: { tone: "red", text: "Não foi possível conectar o Google Contacts. Tente novamente." },
  cancelado: { tone: "amber", text: "Conexão com o Google cancelada." },
  nao_configurado: { tone: "amber", text: "Google Contacts ainda não foi configurado pelo administrador." }
};

const STATUS_LABEL = {
  disconnected: "Não conectado",
  connected: "Conectado",
  expired: "Requer reconexão",
  error: "Requer reconexão"
};

export default function GoogleContactsStatus({ align = "center" }) {
  const [status, setStatus] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [queryMessage, setQueryMessage] = useState(null);

  const loadStatus = async () => {
    try {
      const response = await fetch("/api/google-contacts/status", { cache: "no-store" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Falha ao consultar o status.");
      setStatus(data);
    } catch {
      // Melhor esforço, mesmo padrão do badge do WhatsApp individual: some
      // silenciosamente se a checagem falhar, nunca trava o resto da tela.
    }
  };

  useEffect(() => {
    loadStatus();
    const params = new URLSearchParams(window.location.search);
    const flag = params.get("googleContacts");
    if (flag && QUERY_MESSAGES[flag]) {
      setQueryMessage(QUERY_MESSAGES[flag]);
      setModalOpen(true);
      params.delete("googleContacts");
      const next = `${window.location.pathname}${params.toString() ? `?${params.toString()}` : ""}`;
      window.history.replaceState({}, "", next);
    }
  }, []);

  const handleDisconnect = async () => {
    if (!window.confirm("Desconectar o Google Contacts? Os contatos já criados na sua agenda Google NÃO serão apagados.")) return;
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/google-contacts/disconnect", { method: "POST" });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || "Não foi possível desconectar.");
      await loadStatus();
    } catch (disconnectError) {
      setError(disconnectError.message);
    } finally {
      setBusy(false);
    }
  };

  if (!status) return null;
  // Se nunca foi configurado no ambiente (faltam as credenciais do Google) e
  // nunca foi conectado, não polui o cabeçalho com um badge sem utilidade —
  // some silenciosamente (pedido do dono: "deploy não deve quebrar nada").
  if (!status.configured && status.status === "disconnected") return null;

  const currentStatus = status.status || "disconnected";

  return (
    <>
      <IntegrationStatusIcon
        kind="google"
        tone={googleContactsTone(currentStatus)}
        label={`Google Contacts: ${STATUS_LABEL[currentStatus] || "Não conectado"}`}
        onClick={() => setModalOpen(true)}
        align={align}
      />

      {modalOpen ? (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setModalOpen(false)}>
          <div className="w-full max-w-sm rounded-3xl border border-line bg-white p-5 shadow-soft" onClick={(event) => event.stopPropagation()}>
            <div className="flex items-center justify-between">
              <h2 className="text-base font-black text-navy">Google Contacts</h2>
              <button type="button" onClick={() => setModalOpen(false)} aria-label="Fechar"><X className="h-5 w-5 text-navy/60" /></button>
            </div>
            <p className="mt-1 text-xs text-navy/60">
              Antes de cada mensagem automática da Meta Diária, salva o cliente na SUA agenda Google. Independente do WhatsApp — desconectar aqui não afeta sua sessão de WhatsApp.
            </p>

            {queryMessage ? (
              <p className={`mt-3 rounded-xl border px-3 py-2 text-xs font-bold ${
                queryMessage.tone === "emerald" ? "border-emerald-200 bg-emerald-50 text-emerald-700"
                  : queryMessage.tone === "red" ? "border-red-200 bg-red-50 text-red-700"
                  : "border-amber-200 bg-amber-50 text-amber-700"
              }`}>{queryMessage.text}</p>
            ) : null}
            {error ? <p className="mt-3 rounded-xl border border-red-100 bg-red-50 px-3 py-2 text-xs font-bold text-red-700">{error}</p> : null}
            {!status.configured ? (
              <p className="mt-3 rounded-xl border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-bold text-amber-700">
                Ainda não configurado pelo administrador (credenciais do Google pendentes).
              </p>
            ) : null}

            <div className="mt-4 flex flex-col items-center gap-3">
              {currentStatus === "connected" ? (
                <>
                  <div className="w-full rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-center">
                    <p className="text-sm font-black text-emerald-700">Conectado</p>
                    <p className="text-xs text-emerald-700/80">{status.email || "Conta Google"}</p>
                    <p className="mt-1 text-xs font-bold text-emerald-700/80">Sincronização automática: {status.syncEnabled ? "ATIVA" : "desligada"}</p>
                  </div>
                  {status.syncCounts ? (
                    <p className="text-xs font-bold text-navy/60">
                      Contatos sincronizados: {status.syncCounts.synced}
                      {status.syncCounts.pending ? ` · pendentes: ${status.syncCounts.pending}` : ""}
                      {status.syncCounts.failed ? ` · com erro: ${status.syncCounts.failed}` : ""}
                    </p>
                  ) : null}
                  <button type="button" disabled={busy} onClick={handleDisconnect} className="w-full rounded-full border border-red-200 bg-red-50 px-3 py-2 text-xs font-extrabold text-red-700 hover:border-red-300 disabled:opacity-50">
                    Desconectar
                  </button>
                </>
              ) : currentStatus === "error" || currentStatus === "expired" ? (
                <>
                  <div className="w-full rounded-2xl border border-amber-200 bg-amber-50 px-4 py-3 text-center">
                    <p className="text-sm font-black text-amber-700">Requer reconexão</p>
                    {status.email ? <p className="text-xs text-amber-700/80">{status.email}</p> : null}
                    {status.lastError ? <p className="mt-1 text-[11px] text-amber-700/70">{status.lastError}</p> : null}
                  </div>
                  <a
                    href={status.configured ? "/api/google-contacts/connect" : undefined}
                    aria-disabled={!status.configured}
                    className={`w-full rounded-full px-3 py-2 text-center text-xs font-extrabold text-white ${status.configured ? "bg-navy hover:bg-navy/90" : "bg-navy/30 pointer-events-none"}`}
                  >
                    Reconectar
                  </a>
                </>
              ) : (
                <>
                  <div className="w-full rounded-2xl border border-dashed border-line px-4 py-5 text-center text-navy/50">
                    <p className="text-sm font-bold">Não conectado</p>
                  </div>
                  <a
                    href={status.configured ? "/api/google-contacts/connect" : undefined}
                    aria-disabled={!status.configured}
                    className={`w-full rounded-full px-3 py-2 text-center text-xs font-extrabold text-white ${status.configured ? "bg-navy hover:bg-navy/90" : "bg-navy/30 pointer-events-none"}`}
                  >
                    Conectar Google
                  </a>
                </>
              )}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
