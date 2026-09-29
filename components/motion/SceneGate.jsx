"use client";

import { useSyncExternalStore } from "react";
import { getSceneReadySnapshot, subscribeSceneReady } from "./scene-transition-store";

// Segura o conteúdo (ex.: <DailyGoalDashboard/>) até a Cena 2 (entrada)
// terminar — só então monta de verdade, e a Cena 3 (já existente, sem
// nenhuma alteração aqui) começa sozinha no mount dela, sem setTimeout.
// Fora de uma transição controlada (nav direta, refresh, voltar do
// navegador, reduced-motion), `sceneReady` já começa `true` e isso nunca
// atrasa nada.
export default function SceneGate({ children }) {
  const ready = useSyncExternalStore(subscribeSceneReady, getSceneReadySnapshot, () => true);
  if (!ready) return null;
  return children;
}
