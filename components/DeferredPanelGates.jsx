"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";

// Velocidade, etapa 3 (dono, 2026-10-22): Mensagem do Dia, Celebração, Supervisão e Central de Alertas saíram do JS
// inicial do painel (traziam o `motion` das cenas e os balões para toda tela, inclusive antes de qualquer aviso existir).
// Mesmos componentes, mesmas props, mesma ordem de montagem de sempre — só carregam quando a tela fica ociosa
// (requestIdleCallback, com teto de IDLE_TIMEOUT_MS; sem a API, logo depois da pintura). Um aviso pendente aparece
// ~1 s depois da tela abrir, e não junto com ela. Montados uma vez só (o layout persiste entre as telas).
const DailyMessageGate = dynamic(() => import("@/components/DailyMessageGate"), { ssr: false });
const BrokerCelebrationGate = dynamic(() => import("@/components/celebrations/BrokerCelebrationGate"), { ssr: false });
const SupervisionMessageGate = dynamic(() => import("@/components/supervision/SupervisionMessageGate"), { ssr: false });
const AlertCenterGate = dynamic(() => import("@/components/alerts/AlertCenterGate"), { ssr: false });
// Janelinha de cliente novo (CLI-16, dono 2026-10-24): mesmo carregamento ocioso; ao montar pede a consulta na hora.
const ClientPopupStack = dynamic(() => import("@/components/client-popups/ClientPopupStack"), { ssr: false });

export const IDLE_TIMEOUT_MS = 1500;

function useIdleReady() {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    if (typeof window.requestIdleCallback === "function") {
      const id = window.requestIdleCallback(() => setReady(true), { timeout: IDLE_TIMEOUT_MS });
      return () => window.cancelIdleCallback?.(id);
    }
    const timer = window.setTimeout(() => setReady(true), 200);
    return () => window.clearTimeout(timer);
  }, []);
  return ready;
}

// Cada prop é o objeto de props do gate (ou null quando o layout não monta aquele gate para esta conta).
export default function DeferredPanelGates({ daily = null, celebration = null, supervision = null, alerts = null, clientPopups = null }) {
  const ready = useIdleReady();
  if (!ready) return null;
  return (
    <>
      {daily ? <DailyMessageGate {...daily} /> : null}
      {celebration ? <BrokerCelebrationGate {...celebration} /> : null}
      {supervision ? <SupervisionMessageGate {...supervision} /> : null}
      {alerts ? <AlertCenterGate {...alerts} /> : null}
      {clientPopups ? <ClientPopupStack {...clientPopups} /> : null}
    </>
  );
}
