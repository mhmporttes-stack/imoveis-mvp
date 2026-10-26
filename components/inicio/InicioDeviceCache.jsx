"use client";

import { useEffect, useState } from "react";
import AdminRouteLoading from "@/components/AdminRouteLoading";
import DeviceCacheRefreshing, { useViewerKey } from "@/components/DeviceCacheRefreshing";
import { readViewerData, restoreViewerData, saveViewerData } from "@/components/chat-view-cache";
import { INICIO_DAY_CACHE_NAME, INICIO_MONTH_CACHE_NAME, INICIO_OWNER_CACHE_NAME } from "@/components/panel-cache-names";
import PainelInicio, { InicioAssistente, InicioDono, InicioDonoCarregando, InicioFunil, InicioFunilCarregando, InicioKpisMes, InicioKpisMesCarregando } from "@/components/inicio/PainelInicio";

// Início que abre na hora (dono, 2026-10-26: "Sim, quero que guarde"): o que a tela mostrou por último NESTA conta fica
// guardado (memória + aparelho, components/chat-view-cache.js) e aparece no carregamento da tela, com "Atualizando…",
// enquanto o servidor monta a tela nova — que substitui tudo assim que chega. Só exibição: nada aqui grava no servidor.

// Guarda um bloco do Início que o servidor acabou de montar (dados prontos de lib/painel-inicio*.js).
export function InicioCacheSaver({ name, value }) {
  const viewerKey = useViewerKey();
  useEffect(() => {
    if (viewerKey && name && value) saveViewerData(viewerKey, name, value);
  }, [viewerKey, name, value]);
  return null;
}

// app/admin/inicio/loading.jsx: o último Início desta conta (memória ou aparelho) ou o esqueleto de sempre.
export function InicioCachedLoading() {
  const viewerKey = useViewerKey();
  // Na 1ª pintura só a memória (igual à do servidor quando o app abre do zero: vazia); o aparelho entra logo depois.
  const [cached, setCached] = useState(() => readCached(viewerKey));
  useEffect(() => {
    if (cached || !viewerKey) return undefined;
    let alive = true;
    Promise.all([
      restoreViewerData(viewerKey, INICIO_DAY_CACHE_NAME),
      restoreViewerData(viewerKey, INICIO_MONTH_CACHE_NAME),
      restoreViewerData(viewerKey, INICIO_OWNER_CACHE_NAME)
    ]).then(([day, month, owner]) => {
      if (alive && day?.value?.data) setCached({ day: day.value, month: month?.value || null, owner: owner?.value || null });
    });
    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewerKey]);

  if (!cached) return <AdminRouteLoading />;
  const { data, owner: isOwner } = cached.day;
  const month = cached.month;
  const owner = isOwner ? cached.owner : null;
  return (
    // data-admin-route-loading: a entrada por rolagem continua esperando a tela de verdade (components/AdminRouteLoading.jsx).
    <div data-admin-route-loading="" data-no-reveal="" className="min-h-screen bg-mist pb-14 pt-3 md:pt-6">
      <PainelInicio
        data={data}
        monthKpis={month ? <InicioKpisMes month={month} /> : <InicioKpisMesCarregando />}
        funnel={month ? <InicioFunil month={month} /> : <InicioFunilCarregando />}
        ownerSummary={isOwner ? <InicioAssistente assistant={data.assistant} chatAvailable={data.chatAvailable} showActions={false} text={owner?.text ?? null} /> : null}
        ownerDetail={isOwner ? (owner ? <InicioDono owner={owner} /> : <InicioDonoCarregando />) : null}
      />
      <DeviceCacheRefreshing show />
    </div>
  );
}

function readCached(viewerKey) {
  const day = readViewerData(viewerKey, INICIO_DAY_CACHE_NAME);
  if (!day?.data) return null;
  return { day, month: readViewerData(viewerKey, INICIO_MONTH_CACHE_NAME), owner: readViewerData(viewerKey, INICIO_OWNER_CACHE_NAME) };
}
