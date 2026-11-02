"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Send } from "lucide-react";
import Button from "@/components/ui/Button";
import { cx } from "@/components/ui/cx";
import { buildCrmChatUrl, buildExternalWhatsappUrl, detectDevice } from "@/lib/client-card-whatsapp-core.mjs";
import { SEND_SIM_CHANNEL_CRM_CHAT, SEND_SIM_CHANNEL_OFFICIAL, decideSendSimulationChannel, sendSimulationButtonState } from "@/lib/client-card-send-simulation-core.mjs";
import { withWhatsappText } from "@/lib/documents-forecast-core.mjs";
import { PRINTED_LIST_MODE_CODE } from "@/lib/whatsapp-manual-disconnect-core.mjs";

// Botão "Enviar simulação" do card (dono, 2026-11-02): mesmo tamanho e peso visual (primário) do "WhatsApp" (className = COMPACT_BUTTON do card).
// Faz o MESMO que "Simulação › Enviar simulação" (SimulationGenerator.sendPresentationToWhatsApp): rota
// /api/admin/simulacoes/<id>/apresentacao ("enviar-preparar" → link /s/<token>; "enviar-registrar" → presentation_sent).
// Confirma antes de enviar. Canal pela regra pura de lib/client-card-send-simulation-core.mjs.
export default function ClientCardSendSimulationButton({ client, list, confirmAction, whatsappBlocked = false, busy = false, className = "" }) {
  const router = useRouter();
  const [sending, setSending] = useState(false);
  const state = sendSimulationButtonState({ client, whatsappBlocked });
  if (!state.visible) return null;
  const name = client.name || client.registration?.fullName || "este cliente";
  const notify = list.notify || (() => {});

  async function send() {
    if (state.needsSimulation) {
      notify(state.hint, "warning");
      return;
    }
    const ok = await confirmAction({
      title: `Enviar a simulação para ${name}?`,
      description: "O cliente recebe o link da apresentação da simulação.",
      confirmLabel: "Enviar",
      cancelLabel: "Cancelar"
    });
    if (!ok) return;
    setSending(true);
    const registrationId = client.registration.id;
    const phone = client.registration?.phoneNormalized || client.registration?.phone;
    const endpoint = `/api/admin/simulacoes/${encodeURIComponent(client.simulation.id)}/apresentacao`;
    const post = (action) => fetch(endpoint, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }) });
    try {
      const response = await post("enviar-preparar");
      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.message) {
        notify(data.error || "Não foi possível preparar a simulação.", "danger");
        return;
      }
      const device = detectDevice({
        userAgent: navigator.userAgent || "",
        standalone: navigator.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true,
        maxTouchPoints: navigator.maxTouchPoints || 0
      });
      const link = data.link || data.message;
      const openExternal = async () => {
        const url = withWhatsappText(buildExternalWhatsappUrl(phone, device), link);
        if (!url) {
          notify("Este cliente não tem um WhatsApp válido.", "danger");
          return;
        }
        await post("enviar-registrar").catch(() => null);
        window.location.assign(url);
      };

      const channel = decideSendSimulationChannel({ officialConversationId: data.officialConversationId, waState: list.waState, client, phone, device });
      if (channel === SEND_SIM_CHANNEL_OFFICIAL) {
        const sendResponse = await fetch(`/api/admin/whatsapp-chat/conversations/${encodeURIComponent(data.officialConversationId)}/messages`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ text: data.message })
        }).catch(() => null);
        if (sendResponse?.ok) {
          const logged = await post("enviar-registrar").catch(() => null);
          notify(logged?.ok ? "Simulação enviada." : "Simulação enviada, mas o registro na linha do tempo falhou.", logged?.ok ? undefined : "danger");
          list.fetchClients?.({ silent: true });
          return;
        }
        const failure = sendResponse ? await sendResponse.json().catch(() => ({})) : {};
        if (failure?.code === PRINTED_LIST_MODE_CODE) {
          await openExternal();
          return;
        }
        // Mesmo tratamento do gerador: não joga para o WhatsApp pessoal; abre a conversa com o link pronto.
        notify(failure?.error ? `Não deu para enviar sozinho: ${failure.error} Abri a conversa com o link pronto.` : "Não deu para enviar sozinho. Abri a conversa com o link pronto.", "danger");
        router.push(buildCrmChatUrl(registrationId, data.message));
        return;
      }
      if (channel === SEND_SIM_CHANNEL_CRM_CHAT) {
        await post("enviar-registrar").catch(() => null);
        router.push(buildCrmChatUrl(registrationId, link));
        return;
      }
      await openExternal();
    } catch {
      notify("Não foi possível enviar a simulação. Tente de novo.", "danger");
    } finally {
      setSending(false);
    }
  }

  const disabled = state.disabled || busy;
  return (
    <Button
      size="sm"
      className={cx(className, state.needsSimulation && "opacity-60")}
      onClick={send}
      disabled={disabled}
      loading={sending}
      aria-disabled={state.needsSimulation || undefined}
      title={state.hint || "Enviar a simulação ao cliente"}
      data-card-send-simulation=""
    >
      <Send className="h-3.5 w-3.5" aria-hidden="true" /> Enviar simulação
    </Button>
  );
}
