"use client";

import { useLayoutEffect, useRef } from "react";
import { usePathname } from "next/navigation";
import { animate } from "motion/react";
import { usePrefersReducedMotion } from "./usePrefersReducedMotion";
import { beginScene, markSceneDone, releaseSceneReady, consumePendingDirection, stopLoadingIndicator } from "./scene-transition-store";
import { ENTER_DURATION, REVERSE_DURATION, ROOT_ID, STAGGER_GAP } from "./scene-transition-constants";

// Vive uma vez só no layout compartilhado (app/admin/layout.jsx), envolvendo
// {children} com o id que SceneTransitionLink usa para achar os blocos da
// tela. Ao detectar a chegada numa página nova (pathname mudou):
//  - se veio de um SceneTransitionLink (direção pendente) e sem
//    prefers-reduced-motion, toca a Cena 2 (entrada: blocos entram da
//    lateral oposta, em stagger) e só então libera `sceneReady` — é isso
//    que faz a Cena 3 (já existente, ex.: DailyGoalDashboard atrás de
//    SceneGate) começar sozinha quando a Cena 2 termina, sem setTimeout.
//  - em qualquer outra navegação (link direto, refresh, voltar do
//    navegador, ou reduced-motion) não anima nada — comportamento normal,
//    igual a antes, `sceneReady` nunca fica bloqueado.
export default function SceneTransitionRoot({ children }) {
  const pathname = usePathname();
  const reducedMotion = usePrefersReducedMotion();
  const rootRef = useRef(null);
  const firstRender = useRef(true);

  useLayoutEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    // A página de destino já montou — se o indicador de carregamento
    // (mostrado quando a Cena 1 termina antes dos dados chegarem) estava
    // ligado, desliga agora, com ou sem Cena 2 pela frente.
    stopLoadingIndicator();
    const direction = consumePendingDirection();
    if (!direction || reducedMotion || !rootRef.current) {
      releaseSceneReady();
      return;
    }
    const blocks = Array.from(rootRef.current.children);
    if (!blocks.length) {
      releaseSceneReady();
      return;
    }

    const fromX = direction === "forward" ? "15%" : "-15%";
    const duration = direction === "forward" ? ENTER_DURATION : REVERSE_DURATION;
    for (const block of blocks) {
      block.style.opacity = "0";
      block.style.transform = `translateX(${fromX})`;
    }

    const controls = animate(blocks, { x: 0, opacity: 1 }, { duration, delay: (i) => i * STAGGER_GAP, ease: [0.16, 1, 0.3, 1] });
    const finish = () => {
      markSceneDone();
      releaseSceneReady();
      for (const block of blocks) {
        block.style.transform = "";
      }
    };
    beginScene({ controls, onFinish: finish });
    controls.then(finish);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  return (
    <div id={ROOT_ID} ref={rootRef}>
      {children}
    </div>
  );
}
