"use client";

import { createContext, useContext, useSyncExternalStore } from "react";
import { getSceneReadySnapshot, subscribeSceneReady } from "./scene-transition-store";

// `true` enquanto a Cena 2 (entrada) ainda toca: as peças da Cena 3 (RevealCard, StaggerContainer, MetaRing) ficam
// paradas no quadro inicial e só começam quando ela termina. Fora de um SceneGate é sempre `false` (nada muda).
const SceneHoldContext = createContext(false);
export function useSceneHeld() {
  return useContext(SceneHoldContext);
}

// Envolve o conteúdo (ex.: <DailyGoalDashboard/>) de uma tela com coreografia de cenas.
// Velocidade (2026-10-22, etapa 2): antes o conteúdo só era MONTADO quando a Cena 2 terminava (2 s), e a montagem
// (render, foto do corretor, painel automático) somava-se depois disso. Agora ele monta junto com a Cena 2, invisível
// (visibility: hidden — a Cena 2 continua mostrando a área vazia, como antes), e só o INÍCIO da Cena 3 espera a Cena 2
// terminar. As três cenas continuam iguais.
// Fora de uma transição controlada (nav direta, refresh, voltar do navegador, reduced-motion), `sceneReady` já
// começa `true` e isso nunca atrasa nada.
export default function SceneGate({ children }) {
  const ready = useSyncExternalStore(subscribeSceneReady, getSceneReadySnapshot, () => true);
  return (
    <SceneHoldContext.Provider value={!ready}>
      <div style={{ display: "contents", visibility: ready ? undefined : "hidden" }}>{children}</div>
    </SceneHoldContext.Provider>
  );
}
