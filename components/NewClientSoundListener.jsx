"use client";

import { useEffect, useRef } from "react";
import { isNewClientSoundEnabled, playNewClientSound } from "@/lib/new-client-sound";

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

    async function poll() {
      if (cancelled || !sinceRef.current) return;
      try {
        const response = await fetch(`/api/crm-notifications/new-client-alerts?since=${encodeURIComponent(sinceRef.current)}`);
        if (!response.ok) return;
        const data = await response.json().catch(() => null);
        if (!data?.ok) return;

        if (data.serverTime) sinceRef.current = data.serverTime;
        if (data.clients?.length && isNewClientSoundEnabled(userId)) {
          playNewClientSound().catch(() => {
            // Autoplay bloqueado silenciosamente (usuário nunca clicou em
            // "Testar som" neste dispositivo) — não há UI aqui para avisar,
            // e não deve interromper a navegação do corretor.
          });
        }
      } catch {
        // Falha de rede pontual — tenta de novo no próximo ciclo.
      }
    }

    const intervalId = setInterval(poll, POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(intervalId);
    };
  }, [userId]);

  return null;
}
