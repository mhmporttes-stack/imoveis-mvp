"use client";

import { useEffect, useState } from "react";
import dynamic from "next/dynamic";
import { getMmApp } from "@/components/pwaHome";
import { gatesForApp } from "@/components/panel-gates-by-app.mjs";

// Velocidade, etapa 3 (dono, 2026-10-22): Mensagem do Dia, Celebração, Supervisão e Central de Alertas saíram do JS
// inicial do painel (traziam o `motion` das cenas e os balões para toda tela, inclusive antes de qualquer aviso existir).
// Mesmos componentes, mesmas props, mesma ordem de montagem de sempre — só carregam quando a tela fica ociosa
// (requestIdleCallback, com teto de IDLE_TIMEOUT_MS; sem a API, logo depois da pintura). Um aviso pendente aparece
// ~1 s depois da tela abrir, e não junto com ela. Montados uma vez só (o layout persiste entre as telas).
const DailyMessageGate = dynamic(() => import("@/components/DailyMessageGate"), { ssr: false });
const BrokerCelebrationGate = dynamic(() => import("@/components/celebrations/BrokerCelebrationGate"), { ssr: false });
const SupervisionMessageGate = dynamic(() => import("@/components/supervision/SupervisionMessageGate"), { ssr: false });
const AlertCenterGate = dynamic(() => import("@/components/alerts/AlertCenterGate"), { ssr: false });

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
// App da tela inicial (dono, 2026-10-24): Financeiro sem avisos; Chat só com os bloqueios (Importante + esfriado) —
// regra única em components/panel-gates-by-app.mjs. O app é lido quando a tela fica ociosa (data-mm-app já marcado).
export default function DeferredPanelGates(props) {
  const ready = useIdleReady();
  if (!ready) return null;
  const { daily, celebration, supervision, alerts } = gatesForApp(getMmApp(), props);
  return (
    <>
      {daily ? <DailyMessageGate {...daily} /> : null}
      {celebration ? <BrokerCelebrationGate {...celebration} /> : null}
      {supervision ? <SupervisionMessageGate {...supervision} /> : null}
      {alerts ? <AlertCenterGate {...alerts} /> : null}
    </>
  );
}
