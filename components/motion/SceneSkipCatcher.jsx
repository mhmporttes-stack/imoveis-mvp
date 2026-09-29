"use client";

import { useSyncExternalStore } from "react";
import { LoaderCircle } from "lucide-react";
import { getLoadingSnapshot, subscribeLoading } from "./scene-transition-store";

// Só mostra um indicador de carregamento — nunca bloqueia toque/clique. No
// intervalo entre o fim da Cena 1 e a página de destino terminar de montar,
// quando isso demora mais que a própria animação de saída, mostra o
// indicador em vez de deixar a tela em branco parada.
//
// Antes disso ser um pedido do dono (2026-09-29), este componente também
// cobria a tela inteira com um botão invisível durante toda a Cena 1/2,
// exigindo um toque manual pra "pular" a animação — a duração das cenas
// (scene-transition-constants.js) continua exatamente a mesma, só que agora
// a tela de baixo fica interativa o tempo todo, sem precisar tocar em nada.
export default function SceneSkipCatcher() {
  const loading = useSyncExternalStore(subscribeLoading, getLoadingSnapshot, () => false);
  if (!loading) return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-0 z-[500] flex items-center justify-center">
      <LoaderCircle className="h-9 w-9 animate-spin text-brand" />
    </div>
  );
}
