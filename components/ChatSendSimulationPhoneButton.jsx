"use client";

import { useState } from "react";
import { Loader2, Send } from "lucide-react";
import { buildExternalWhatsappUrl, detectDevice } from "@/lib/client-card-whatsapp-core.mjs";
import { chatSendSimulationState } from "@/lib/chat-send-simulation-core.mjs";
import { withWhatsappText } from "@/lib/documents-forecast-core.mjs";

// Botão "Enviar simulação pelo meu WhatsApp" do Chat (dono, 2026-11-02). Quando o Chat não deixa responder (cliente ainda não
// escreveu, janela do oficial fechada, WhatsApp do CRM fora do ar), abre o WhatsApp do PRÓPRIO celular do corretor (app/PWA no celular,
// WhatsApp Web no computador) com SÓ o link da apresentação (sem texto junto: com texto a prévia não carrega — dono, 2026-10-11).
// Nada sai pelo serviço do WhatsApp do CRM. Usa a MESMA rota do "Simulação › Enviar simulação" (enviar-preparar / enviar-registrar);
// o escopo é validado por ela no servidor. Regras do botão: lib/chat-send-simulation-core.mjs.
export default function ChatSendSimulationPhoneButton({ conversation, className = "" }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const client = conversation?.client || null;
  // sendSimulationId === null = o servidor não conseguiu consultar a simulação: não mostra o botão (e o erro fica no log do servidor).
  if (!client || conversation.sendSimulationId == null) return null;
  const phone = client.phone || conversation.phone || "";
  const state = chatSendSimulationState({
    client,
    simulationId: conversation.sendSimulationId,
    phone,
    isGroup: conversation.isGroup === true,
    isPrivate: Boolean(conversation.private),
    archivedReadOnly: conversation.archivedReadOnly === true
  });
  if (!state.visible) return null;

  async function send() {
    if (busy) return;
    if (state.needsSimulation) {
      setError(state.hint);
      return;
    }
    setBusy(true);
    setError("");
    const device = detectDevice({
      userAgent: navigator.userAgent || "",
      standalone: navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true,
      maxTouchPoints: navigator.maxTouchPoints || 0
    });
    // No computador a aba do WhatsApp Web abre ao lado (o Chat e o texto digitado ficam); precisa ser aberta no toque, antes de esperar a rede.
    const tab = device === "desktop" ? window.open("", "_blank") : null;
    try {
      const endpoint = `/api/admin/simulacoes/${encodeURIComponent(conversation.sendSimulationId)}/apresentacao`;
      const post = (action) => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
      const response = await post("enviar-preparar");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.message) throw new Error(data.error || "Não foi possível preparar a simulação.");
      // SÓ o link, sem texto junto.
      const url = withWhatsappText(buildExternalWhatsappUrl(phone, device), data.link || data.message);
      if (!url) throw new Error("Este cliente não tem um WhatsApp válido.");
      // Mesmo registro do fluxo do painel (linha do tempo "Apresentação da simulação enviada"), sem pontuação nova.
      await post("enviar-registrar").catch(() => null);
      if (tab) tab.location.href = url;
      else window.location.assign(url);
    } catch (failure) {
      tab?.close();
      setError(failure?.message || "Não foi possível abrir o WhatsApp. Tente de novo.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={send}
        disabled={busy}
        aria-disabled={state.needsSimulation || undefined}
        data-chat-send-simulation-phone=""
        className={`inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl bg-[#25D366] px-4 text-sm font-extrabold text-white shadow-sm hover:bg-[#1fb857] disabled:opacity-60 sm:w-auto ${state.needsSimulation ? "opacity-70" : ""}`}
      >
        {busy ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <Send className="h-4 w-4" aria-hidden="true" />}
        Enviar simulação pelo meu WhatsApp
      </button>
      {error ? <p role="alert" className="mt-1.5 text-xs font-bold text-red-700">{error}</p> : null}
    </div>
  );
}
