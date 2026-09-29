"use client";

import { useSyncExternalStore } from "react";
import { LoaderCircle } from "lucide-react";
import { getActiveSnapshot, subscribeActive, requestSkip, getLoadingSnapshot, subscribeLoading } from "./scene-transition-store";

// Um toque em qualquer lugar da tela durante a Cena 1 ou 2 pula direto pro
// estado final dessa cena (nunca aparece durante a Cena 3, que não usa esse
// mecanismo). Vive uma vez só no layout, ao lado de SceneTransitionRoot.
//
// Entre o fim da Cena 1 e a página de destino terminar de carregar (quando
// isso leva mais que a duração da própria animação de saída), mostra um
// indicador em vez de deixar a tela em branco parada — sem isso a espera
// parecia travada/quebrada.
export default function SceneSkipCatcher() {
  const active = useSyncExternalStore(subscribeActive, getActiveSnapshot, () => false);
  const loading = useSyncExternalStore(subscribeLoading, getLoadingSnapshot, () => false);
  if (!active && !loading) return null;
  return (
    <button
      type="button"
      aria-label="Pular animação"
      onClick={requestSkip}
      className="fixed inset-0 z-[500] flex cursor-pointer items-center justify-center bg-transparent"
      style={{ WebkitTapHighlightColor: "transparent" }}
    >
      {loading ? <LoaderCircle className="h-9 w-9 animate-spin text-brand" aria-hidden="true" /> : null}
    </button>
  );
}
