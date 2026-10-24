"use client";

import { useEffect, useRef } from "react";
import { isNewClientSoundEnabled, playNewClientSound } from "@/lib/new-client-sound";
import { isPageHidden, onPageVisibilityChange } from "@/components/page-visibility";
import { clientPopupCursor, hasClientPopupConsumer, publishClientPopups, setClientPopupPollRequester } from "@/components/client-popups/client-popup-bus";

const POLL_INTERVAL_MS = 20000;

// Componente global (montado em app/admin/layout.jsx, fora de Gestão) — só
// ele precisa funcionar para QUALQUER usuário autenticado, inclusive quem
// não tem acesso a Gestão > Automações: lá é onde se CONFIGURA o alerta,
// aqui é onde ele é EXECUTADO para o corretor destinatário. Sem UI própria.
//
// Detecta direto em simulation_registrations (não via crm_notifications/
// crm_automation_rules) para não depender de nenhuma regra específica estar
// ativa/configurada de um jeito particular — o alerta é sobre o evento
// "cliente novo pelo formulário atribuído a mim", não sobre o sistema de
// notificações em si.
export default function NewClientSoundListener({ userId }) {
  const sinceRef = useRef(null);

  useEffect(() => {
    sinceRef.current = new Date().toISOString();

    let cancelled = false;
    let inFlight = false;
    let again = false;

    async function poll() {
      if (cancelled || !sinceRef.current || inFlight) return;
      inFlight = true;
      try {
        // Janelinha de cliente novo (CLI-16, dono 2026-10-24): pedida no MESMO ciclo, só com a página visível e a
        // janelinha montada (components/client-popups/ClientPopupStack.jsx). Oculta: só o som, como sempre.
        const withPopups = hasClientPopupConsumer() && !isPageHidden();
        const params = new URLSearchParams({ since: sinceRef.current });
        if (withPopups) {
          params.set("popups", "1");
          const popupsSince = clientPopupCursor();
          if (popupsSince) params.set("popupsSince", popupsSince);
        }
        const response = await fetch(`/api/crm-notifications/new-client-alerts?${params.toString()}`);
        if (!response.ok) return;
        const data = await response.json().catch(() => null);
        if (!data?.ok) return;

        if (data.serverTime) sinceRef.current = data.serverTime;
        if (withPopups && Array.isArray(data.popups)) publishClientPopups(data.popups, data.popupsCursor || "");
        if (data.popupsError) console.warn("Janelinha de cliente novo:", data.popupsError);
        if (data.clients?.length && isNewClientSoundEnabled(userId)) {
          playNewClientSound().catch(() => {
            // Autoplay bloqueado silenciosamente (usuário nunca clicou em
            // "Testar som" neste dispositivo) — não há UI aqui para avisar,
            // e não deve interromper a navegação do corretor.
          });
        }
      } catch {
        // Falha de rede pontual — tenta de novo no próximo ciclo.
      } finally {
        inFlight = false;
        if (again && !cancelled) {
          again = false;
          poll();
        }
      }
    }

    // Continua consultando com a aba oculta (de propósito): o som avisa o corretor de cliente novo da roleta, que tem
    // prazo curto de atendimento — pausar faria o aviso só tocar quando ele voltasse ao CRM. Ao voltar a ficar
    // visível também checa na hora (2026-10-20; desde 2026-10-24 pelo sinal único de visibilidade, que inclui a janela do
    // app de desktop). A janelinha de cliente novo pode pedir uma consulta na hora ao montar.
    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    const stopVisibility = onPageVisibilityChange(() => {
      if (!isPageHidden()) poll();
    });
    // Pedido da janelinha durante uma consulta em andamento: consulta de novo logo depois (o ciclo comum não acumula).
    const stopRequester = setClientPopupPollRequester(() => {
      if (inFlight) again = true;
      else poll();
    });
    if (hasClientPopupConsumer()) poll();
    return () => {
      cancelled = true;
      clearInterval(intervalId);
      stopVisibility();
      stopRequester();
    };
  }, [userId]);

  return null;
}
