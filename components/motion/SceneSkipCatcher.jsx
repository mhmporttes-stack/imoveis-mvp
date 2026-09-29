"use client";

import { useSyncExternalStore } from "react";
import { getActiveSnapshot, subscribeActive, requestSkip } from "./scene-transition-store";

// Um toque em qualquer lugar da tela durante a Cena 1 ou 2 pula direto pro
// estado final dessa cena (nunca aparece durante a Cena 3, que não usa esse
// mecanismo). Vive uma vez só no layout, ao lado de SceneTransitionRoot.
export default function SceneSkipCatcher() {
  const active = useSyncExternalStore(subscribeActive, getActiveSnapshot, () => false);
  if (!active) return null;
  return (
    <button
      type="button"
      aria-label="Pular animação"
      onClick={requestSkip}
      className="fixed inset-0 z-[500] cursor-pointer bg-transparent"
      style={{ WebkitTapHighlightColor: "transparent" }}
    />
  );
}
